-- 027_search_subsidy_programs.sql
-- subsidy_programs.embedding 전용 하이브리드 검색 RPC

CREATE OR REPLACE FUNCTION public.search_subsidy_programs(
    query_embedding vector(1024),
    query_text      text,
    match_count     int DEFAULT 20
)
RETURNS TABLE (
    row_id  uuid,
    score   float
)
LANGUAGE sql
STABLE
AS $$
    WITH vector_ranked AS (
        SELECT
            id AS row_id,
            ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
        FROM public.subsidy_programs
        WHERE embedding IS NOT NULL
        LIMIT match_count * 3
    ),
    fts_ranked AS (
        SELECT
            id AS row_id,
            ROW_NUMBER() OVER (
                ORDER BY to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(organization,'') || ' ' || coalesce(region,''))
                         @@ plainto_tsquery('simple', query_text) DESC,
                         id
            ) AS rank
        FROM public.subsidy_programs
        WHERE
            query_text IS NOT NULL
            AND query_text <> ''
            AND (
                to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(organization,'') || ' ' || coalesce(region,''))
                @@ plainto_tsquery('simple', query_text)
            )
        LIMIT match_count * 3
    ),
    rrf AS (
        SELECT
            COALESCE(v.row_id, f.row_id) AS row_id,
            COALESCE(1.0 / (60 + v.rank), 0.0) + COALESCE(1.0 / (60 + f.rank), 0.0) AS score
        FROM vector_ranked v
        FULL OUTER JOIN fts_ranked f ON v.row_id = f.row_id
    )
    SELECT row_id, score
    FROM rrf
    ORDER BY score DESC
    LIMIT match_count;
$$;
