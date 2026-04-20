-- ============================================================
-- 012_contract_knowledge_search.sql
-- 3-way RRF 하이브리드 검색 RPC 3종
--   search_law_contract_knowledge
--   search_pattern_contract_knowledge
--   search_acceptable_contract_knowledge
--
-- 각 RPC 는 (vector cos / FTS simple / trigram word_similarity) 세 랭커를
-- Reciprocal Rank Fusion 으로 병합해 정렬한다. query_embedding 은 text 로
-- 받아 내부에서 ::vector 캐스팅 (PostgREST 직렬화 우회).
-- ============================================================

-- ── 1. law ────────────────────────────────────────────────────────────────
create or replace function public.search_law_contract_knowledge(
  query_text       text,
  query_embedding  text,
  match_count      integer           default 6,
  filter_category  text              default null,
  rrf_k            integer           default 60,
  min_score        double precision  default 0.3,
  min_trgm_score   double precision  default 0.5,
  min_content_len  integer           default 40
)
returns table (
  id             bigint,
  content        text,
  metadata       jsonb,
  chunk_type     text,
  paragraph_no   integer,
  paragraph_char text,
  parent_doc_id  bigint,
  score          double precision,
  similarity     double precision
)
language sql stable as $$
  with q as (select query_embedding::vector as vec),
  vector_ranked as (
    select
      lc.id,
      1 - (lc.embedding <=> q.vec) as cos_sim,
      row_number() over (order by lc.embedding <=> q.vec) as rnk
    from public.law_contract_knowledge_chunks lc, q
    where (filter_category is null or lc.category = filter_category)
      and 1 - (lc.embedding <=> q.vec) >= min_score
      and char_length(lc.content) > min_content_len
    order by lc.embedding <=> q.vec
    limit match_count * 3
  ),
  fts_ranked as (
    select
      lc.id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', lc.content), plainto_tsquery('simple', query_text)) desc
      ) as rnk
    from public.law_contract_knowledge_chunks lc
    where (filter_category is null or lc.category = filter_category)
      and to_tsvector('simple', lc.content) @@ plainto_tsquery('simple', query_text)
      and char_length(lc.content) > min_content_len
    limit match_count * 3
  ),
  trgm_ranked as (
    select
      lc.id,
      row_number() over (order by word_similarity(query_text, lc.content) desc) as rnk
    from public.law_contract_knowledge_chunks lc
    where (filter_category is null or lc.category = filter_category)
      and word_similarity(query_text, lc.content) >= min_trgm_score
      and char_length(lc.content) > min_content_len
    order by word_similarity(query_text, lc.content) desc
    limit match_count * 3
  ),
  rrf_combined as (
    select
      v.id,
      v.cos_sim,
      (1.0 / (rrf_k + v.rnk)) +
      coalesce(1.0 / (rrf_k + f.rnk), 0.0) +
      coalesce(1.0 / (rrf_k + t.rnk), 0.0) as rrf
    from vector_ranked v
    left join fts_ranked  f on v.id = f.id
    left join trgm_ranked t on v.id = t.id
  )
  select
    lc.id, lc.content, lc.metadata, lc.chunk_type,
    lc.paragraph_no, lc.paragraph_char, lc.parent_doc_id,
    r.rrf      as score,
    r.cos_sim  as similarity
  from rrf_combined r
  join public.law_contract_knowledge_chunks lc on lc.id = r.id
  order by r.rrf desc
  limit match_count;
$$;

-- ── 2. pattern ─────────────────────────────────────────────────────────────
create or replace function public.search_pattern_contract_knowledge(
  query_text           text,
  query_embedding      text,
  match_count          integer           default 4,
  filter_risk_level    text              default null,
  filter_contract_type text              default null,
  rrf_k                integer           default 60,
  min_score            double precision  default 0.25,
  min_trgm_score       double precision  default 0.35,
  min_content_len      integer           default 30
)
returns table (
  id             bigint,
  content        text,
  metadata       jsonb,
  category       text,
  source         text,
  risk_level     text,
  pattern_name   text,
  contract_type  text,
  score          double precision,
  similarity     double precision
)
language sql stable as $$
  with q as (select query_embedding::vector as vec),
  vector_ranked as (
    select
      pc.id,
      1 - (pc.embedding <=> q.vec) as cos_sim,
      row_number() over (order by pc.embedding <=> q.vec) as rnk
    from public.pattern_contract_knowledge_chunks pc, q
    where (filter_risk_level    is null or pc.risk_level    = filter_risk_level)
      and (filter_contract_type is null or pc.contract_type = filter_contract_type)
      and 1 - (pc.embedding <=> q.vec) >= min_score
      and char_length(pc.content) > min_content_len
    order by pc.embedding <=> q.vec
    limit match_count * 3
  ),
  fts_ranked as (
    select
      pc.id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', pc.content), plainto_tsquery('simple', query_text)) desc
      ) as rnk
    from public.pattern_contract_knowledge_chunks pc
    where (filter_risk_level    is null or pc.risk_level    = filter_risk_level)
      and (filter_contract_type is null or pc.contract_type = filter_contract_type)
      and to_tsvector('simple', pc.content) @@ plainto_tsquery('simple', query_text)
      and char_length(pc.content) > min_content_len
    limit match_count * 3
  ),
  trgm_ranked as (
    select
      pc.id,
      row_number() over (order by word_similarity(query_text, pc.content) desc) as rnk
    from public.pattern_contract_knowledge_chunks pc
    where (filter_risk_level    is null or pc.risk_level    = filter_risk_level)
      and (filter_contract_type is null or pc.contract_type = filter_contract_type)
      and word_similarity(query_text, pc.content) >= min_trgm_score
      and char_length(pc.content) > min_content_len
    order by word_similarity(query_text, pc.content) desc
    limit match_count * 3
  ),
  rrf_combined as (
    select
      v.id,
      v.cos_sim,
      (1.0 / (rrf_k + v.rnk)) +
      coalesce(1.0 / (rrf_k + f.rnk), 0.0) +
      coalesce(1.0 / (rrf_k + t.rnk), 0.0) as rrf
    from vector_ranked v
    left join fts_ranked  f on v.id = f.id
    left join trgm_ranked t on v.id = t.id
  )
  select
    pc.id, pc.content, pc.metadata, pc.category, pc.source,
    pc.risk_level, pc.pattern_name, pc.contract_type,
    r.rrf      as score,
    r.cos_sim  as similarity
  from rrf_combined r
  join public.pattern_contract_knowledge_chunks pc on pc.id = r.id
  order by r.rrf desc
  limit match_count;
$$;

-- ── 3. acceptable ──────────────────────────────────────────────────────────
create or replace function public.search_acceptable_contract_knowledge(
  query_text           text,
  query_embedding      text,
  match_count          integer           default 4,
  filter_contract_type text              default null,
  rrf_k                integer           default 60,
  min_score            double precision  default 0.25,
  min_trgm_score       double precision  default 0.35,
  min_content_len      integer           default 30
)
returns table (
  id             bigint,
  content        text,
  metadata       jsonb,
  category       text,
  source         text,
  clause_name    text,
  legal_basis    text,
  contract_type  text,
  score          double precision,
  similarity     double precision
)
language sql stable as $$
  with q as (select query_embedding::vector as vec),
  vector_ranked as (
    select
      ac.id,
      1 - (ac.embedding <=> q.vec) as cos_sim,
      row_number() over (order by ac.embedding <=> q.vec) as rnk
    from public.acceptable_contract_knowledge_chunks ac, q
    where (filter_contract_type is null or ac.contract_type = filter_contract_type)
      and 1 - (ac.embedding <=> q.vec) >= min_score
      and char_length(ac.content) > min_content_len
    order by ac.embedding <=> q.vec
    limit match_count * 3
  ),
  fts_ranked as (
    select
      ac.id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', ac.content), plainto_tsquery('simple', query_text)) desc
      ) as rnk
    from public.acceptable_contract_knowledge_chunks ac
    where (filter_contract_type is null or ac.contract_type = filter_contract_type)
      and to_tsvector('simple', ac.content) @@ plainto_tsquery('simple', query_text)
      and char_length(ac.content) > min_content_len
    limit match_count * 3
  ),
  trgm_ranked as (
    select
      ac.id,
      row_number() over (order by word_similarity(query_text, ac.content) desc) as rnk
    from public.acceptable_contract_knowledge_chunks ac
    where (filter_contract_type is null or ac.contract_type = filter_contract_type)
      and word_similarity(query_text, ac.content) >= min_trgm_score
      and char_length(ac.content) > min_content_len
    order by word_similarity(query_text, ac.content) desc
    limit match_count * 3
  ),
  rrf_combined as (
    select
      v.id,
      v.cos_sim,
      (1.0 / (rrf_k + v.rnk)) +
      coalesce(1.0 / (rrf_k + f.rnk), 0.0) +
      coalesce(1.0 / (rrf_k + t.rnk), 0.0) as rrf
    from vector_ranked v
    left join fts_ranked  f on v.id = f.id
    left join trgm_ranked t on v.id = t.id
  )
  select
    ac.id, ac.content, ac.metadata, ac.category, ac.source,
    ac.clause_name, ac.legal_basis, ac.contract_type,
    r.rrf      as score,
    r.cos_sim  as similarity
  from rrf_combined r
  join public.acceptable_contract_knowledge_chunks ac on ac.id = r.id
  order by r.rrf desc
  limit match_count;
$$;
