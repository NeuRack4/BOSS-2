-- 034_platform_credentials.sql
-- 사용자별 외부 플랫폼 자격증명 저장 (네이버 블로그 쿠키 등)

CREATE TABLE IF NOT EXISTS platform_credentials (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id  uuid        NOT NULL,
  platform    text        NOT NULL,  -- 'naver_blog'
  credentials jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (account_id, platform)
);

ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all" ON platform_credentials
  FOR ALL USING (account_id = auth.uid());
