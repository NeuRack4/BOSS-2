-- 026: Instagram DM 자동 발송 캠페인
-- instagram_dm_campaigns  — 캠페인 (게시물 + 트리거 키워드 + DM 템플릿)
-- instagram_dm_sent        — 발송 이력 (중복 방지)

-- ── 캠페인 테이블 ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instagram_dm_campaigns (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id          TEXT        NOT NULL,          -- Instagram 미디어 ID
  post_url         TEXT        NOT NULL,          -- 게시물 permalink
  post_thumbnail   TEXT        DEFAULT '',        -- 썸네일 URL (선택)
  trigger_keyword  TEXT        NOT NULL,          -- 댓글 트리거 키워드 (예: "신청")
  dm_template      TEXT        NOT NULL,          -- 자동 DM 내용
  is_active        BOOLEAN     DEFAULT true,
  sent_count       INTEGER     DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ── 발송 이력 테이블 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS instagram_dm_sent (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id      UUID        NOT NULL REFERENCES instagram_dm_campaigns(id) ON DELETE CASCADE,
  commenter_ig_id  TEXT        NOT NULL,   -- Instagram scoped user ID
  commenter_name   TEXT        DEFAULT '',
  sent_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (campaign_id, commenter_ig_id)    -- 동일 사용자에게 중복 발송 방지
);

-- ── 인덱스 ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dm_campaigns_account ON instagram_dm_campaigns(account_id);
CREATE INDEX IF NOT EXISTS idx_dm_sent_campaign     ON instagram_dm_sent(campaign_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE instagram_dm_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_dm_sent      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own dm campaigns" ON instagram_dm_campaigns
  FOR ALL USING (account_id = auth.uid());

CREATE POLICY "own dm sent" ON instagram_dm_sent
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM instagram_dm_campaigns WHERE account_id = auth.uid()
    )
  );

-- ── updated_at 자동 갱신 ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_dm_campaign_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dm_campaigns_updated_at
  BEFORE UPDATE ON instagram_dm_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_dm_campaign_updated_at();
