-- 028_subsidy_cache.sql
-- 계정별 지원사업 추천 캐시 (24h TTL)

CREATE TABLE IF NOT EXISTS subsidy_cache (
  account_id   uuid        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  results      jsonb       NOT NULL DEFAULT '[]',
  computed_at  timestamptz NOT NULL DEFAULT now(),
  is_computing boolean     NOT NULL DEFAULT false
);

ALTER TABLE subsidy_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own subsidy cache"
  ON subsidy_cache FOR SELECT
  USING (auth.uid() = account_id);
