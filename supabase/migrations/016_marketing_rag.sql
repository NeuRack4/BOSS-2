-- 012_marketing_rag.sql
-- subsidy_programs 임베딩 + FTS 추가, 마케팅 하이브리드 서치 RPC

-- ── 1. subsidy_programs 임베딩 + FTS ──────────────────────────────────────

ALTER TABLE public.subsidy_programs
    ADD COLUMN IF NOT EXISTS embedding vector(1024),
    ADD COLUMN IF NOT EXISTS fts tsvector
        GENERATED ALWAYS AS (
            to_tsvector('simple',
                coalesce(title, '') || ' ' ||
                coalesce(description, '') || ' ' ||
                coalesce(hashtags, '') || ' ' ||
                coalesce(organization, '') || ' ' ||
                coalesce(region, '')
            )
        ) STORED;

CREATE INDEX IF NOT EXISTS idx_subsidy_programs_fts
    ON public.subsidy_programs USING GIN (fts);

-- ── 2. search_marketing_knowledge RPC (BGE-M3 + RRF) ─────────────────────

DROP FUNCTION IF EXISTS public.search_marketing_knowledge(vector, text, integer);

CREATE OR REPLACE FUNCTION public.search_marketing_knowledge(
    query_embedding vector(1024),
    query_text      text,
    match_count     int DEFAULT 6
)
RETURNS TABLE (
    source_table text,
    row_id       uuid,
    category     text,
    source_name  text,
    content      text,
    score        double precision
)
LANGUAGE sql
STABLE
AS $$
    WITH rrf_k(k) AS (SELECT 60),
    kc_vec AS (
        SELECT 'knowledge'::text AS tbl, mkc.id AS rid, mkc.category AS cat, mkc.source AS src, mkc.content AS cnt,
               ROW_NUMBER() OVER (ORDER BY mkc.embedding <=> query_embedding) AS rn
        FROM public.marketing_knowledge_chunks mkc
        WHERE mkc.embedding IS NOT NULL
        LIMIT match_count * 3
    ),
    kc_fts AS (
        SELECT 'knowledge'::text AS tbl, mkc.id AS rid, mkc.category AS cat, mkc.source AS src, mkc.content AS cnt,
               ROW_NUMBER() OVER (ORDER BY ts_rank(mkc.fts, websearch_to_tsquery('simple', query_text)) DESC) AS rn
        FROM public.marketing_knowledge_chunks mkc
        WHERE mkc.fts @@ websearch_to_tsquery('simple', query_text)
        LIMIT match_count * 3
    ),
    sp_vec AS (
        SELECT 'subsidy'::text AS tbl, sp.id AS rid, sp.program_kind AS cat, sp.organization AS src,
               (sp.title || E'\n' || coalesce(sp.description,'') || E'\n태그: ' || coalesce(sp.hashtags,'')) AS cnt,
               ROW_NUMBER() OVER (ORDER BY sp.embedding <=> query_embedding) AS rn
        FROM public.subsidy_programs sp
        WHERE sp.embedding IS NOT NULL
        LIMIT match_count * 3
    ),
    sp_fts AS (
        SELECT 'subsidy'::text AS tbl, sp.id AS rid, sp.program_kind AS cat, sp.organization AS src,
               (sp.title || E'\n' || coalesce(sp.description,'') || E'\n태그: ' || coalesce(sp.hashtags,'')) AS cnt,
               ROW_NUMBER() OVER (ORDER BY ts_rank(sp.fts, websearch_to_tsquery('simple', query_text)) DESC) AS rn
        FROM public.subsidy_programs sp
        WHERE sp.fts @@ websearch_to_tsquery('simple', query_text)
        LIMIT match_count * 3
    ),
    combined AS (
        SELECT tbl, rid, cat, src, cnt, rn FROM kc_vec
        UNION ALL
        SELECT tbl, rid, cat, src, cnt, rn FROM kc_fts
        UNION ALL
        SELECT tbl, rid, cat, src, cnt, rn FROM sp_vec
        UNION ALL
        SELECT tbl, rid, cat, src, cnt, rn FROM sp_fts
    ),
    rrf AS (
        SELECT tbl, rid, cat, src, cnt,
               SUM(1.0 / ((SELECT k FROM rrf_k) + rn)) AS rrf_score
        FROM combined
        GROUP BY tbl, rid, cat, src, cnt
    )
    SELECT tbl, rid, cat, src, cnt, rrf_score
    FROM rrf
    ORDER BY rrf_score DESC
    LIMIT match_count;
$$;
