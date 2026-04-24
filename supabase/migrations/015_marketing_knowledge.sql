-- 011_marketing_knowledge.sql
-- 소상공인 정부 지원사업 및 마케팅 관련 법령 지식베이스

-- ── 1. 지원사업 테이블 ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subsidy_programs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id   TEXT UNIQUE,                -- 기업마당 원본 ID
    title         TEXT NOT NULL,
    organization  TEXT,
    region        TEXT,
    program_kind  TEXT,                       -- 창업 / 소상공인 / 중소기업 등
    sub_kind      TEXT,
    target        TEXT,
    start_date    DATE,
    end_date      DATE,
    period_raw    TEXT,
    is_ongoing    BOOLEAN DEFAULT FALSE,
    description   TEXT,
    detail_url    TEXT,
    external_url  TEXT,
    hashtags      TEXT,
    raw           JSONB DEFAULT '{}',
    fetched_at    TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 2. 마케팅 법령·지식 청크 테이블 ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.marketing_knowledge_chunks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category      TEXT NOT NULL,             -- subsidy_law | privacy_law | strategy
    source        TEXT NOT NULL,             -- 법령명/출처명
    chunk_index   INT  DEFAULT 0,
    content       TEXT NOT NULL,
    embedding     vector(1024),
    fts           tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    metadata      JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- ── 3. 인덱스 ─────────────────────────────────────────────────────────────

-- subsidy_programs
CREATE INDEX IF NOT EXISTS idx_subsidy_programs_kind    ON public.subsidy_programs (program_kind);
CREATE INDEX IF NOT EXISTS idx_subsidy_programs_region  ON public.subsidy_programs (region);
CREATE INDEX IF NOT EXISTS idx_subsidy_programs_ongoing ON public.subsidy_programs (is_ongoing);

-- marketing_knowledge_chunks
CREATE INDEX IF NOT EXISTS idx_mktknow_category ON public.marketing_knowledge_chunks (category);
CREATE INDEX IF NOT EXISTS idx_mktknow_source   ON public.marketing_knowledge_chunks (source);
CREATE INDEX IF NOT EXISTS idx_mktknow_fts      ON public.marketing_knowledge_chunks USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_mktknow_embed
    ON public.marketing_knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);

-- ── 4. RLS ────────────────────────────────────────────────────────────────
-- 지식베이스는 공개 읽기 (인증 필요 없음)

ALTER TABLE public.subsidy_programs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subsidy_programs_read_all"
    ON public.subsidy_programs FOR SELECT
    USING (true);

CREATE POLICY "marketing_knowledge_read_all"
    ON public.marketing_knowledge_chunks FOR SELECT
    USING (true);

-- service_role은 RLS bypass이므로 INSERT/UPDATE는 별도 정책 불필요
