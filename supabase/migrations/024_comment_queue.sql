-- 댓글 자동 관리 큐
CREATE TABLE IF NOT EXISTS public.comment_queue (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform       TEXT        NOT NULL CHECK (platform IN ('youtube', 'instagram')),
    media_id       TEXT        NOT NULL,
    media_title    TEXT        NOT NULL DEFAULT '',
    comment_id     TEXT        NOT NULL,
    commenter_name TEXT        NOT NULL DEFAULT '',
    comment_text   TEXT        NOT NULL,
    ai_reply       TEXT        NOT NULL DEFAULT '',
    status         TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'posted', 'ignored')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_at      TIMESTAMPTZ,
    UNIQUE (account_id, platform, comment_id)
);

ALTER TABLE public.comment_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own comment_queue"
    ON public.comment_queue FOR ALL
    USING (auth.uid() = account_id);

CREATE INDEX idx_comment_queue_account_status
    ON public.comment_queue (account_id, status, created_at DESC);
