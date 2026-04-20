-- ============================================================
-- 019_legal_knowledge_search.sql
-- Legal 지식베이스 3-way RRF 검색 RPC.
--
-- search_legal_knowledge: vector / FTS / trigram 세 랭커를 RRF 로 병합.
-- filter_domain 으로 'labor' | 'privacy' | ... 제한 가능.
-- ============================================================

create or replace function public.search_legal_knowledge(
  query_text       text,
  query_embedding  text,
  match_count      integer           default 6,
  filter_domain    text              default null,
  rrf_k            integer           default 60,
  min_score        double precision  default 0.2,
  min_trgm_score   double precision  default 0.15,
  min_content_len  integer           default 40
)
returns table (
  id             bigint,
  content        text,
  metadata       jsonb,
  source         text,
  domain         text,
  chunk_type     text,
  article_no     text,
  article_title  text,
  paragraph_no   integer,
  paragraph_char text,
  parent_doc_id  bigint,
  score          double precision,
  similarity     double precision
)
language sql stable as $$
  -- 3-way RRF: vector / FTS / trgm 세 랭커의 **후보 집합을 UNION** 해 합산.
  -- (이전 버전은 vector LEFT JOIN fts/trgm 이라 벡터에 안 잡힌 id 는 버려지는 버그가 있었음.)
  with q as (select query_embedding::vector as vec),
  vector_ranked as (
    select
      lk.id,
      row_number() over (order by lk.embedding <=> q.vec) as rnk
    from public.legal_knowledge_chunks lk, q
    where (filter_domain is null or lk.domain = filter_domain)
      and 1 - (lk.embedding <=> q.vec) >= min_score
      and char_length(lk.content) > min_content_len
    order by lk.embedding <=> q.vec
    limit match_count * 4
  ),
  fts_ranked as (
    select
      lk.id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', lk.content), plainto_tsquery('simple', query_text)) desc
      ) as rnk
    from public.legal_knowledge_chunks lk
    where (filter_domain is null or lk.domain = filter_domain)
      and to_tsvector('simple', lk.content) @@ plainto_tsquery('simple', query_text)
      and char_length(lk.content) > min_content_len
    limit match_count * 4
  ),
  trgm_ranked as (
    select
      lk.id,
      row_number() over (order by word_similarity(query_text, lk.content) desc) as rnk
    from public.legal_knowledge_chunks lk
    where (filter_domain is null or lk.domain = filter_domain)
      and word_similarity(query_text, lk.content) >= min_trgm_score
      and char_length(lk.content) > min_content_len
    order by word_similarity(query_text, lk.content) desc
    limit match_count * 4
  ),
  rrf_combined as (
    select id, sum(contrib) as rrf
    from (
      select id, 1.0 / (rrf_k + rnk) as contrib from vector_ranked
      union all
      select id, 1.0 / (rrf_k + rnk) from fts_ranked
      union all
      select id, 1.0 / (rrf_k + rnk) from trgm_ranked
    ) u
    group by id
  )
  select
    lk.id, lk.content, lk.metadata, lk.source, lk.domain, lk.chunk_type,
    lk.article_no, lk.article_title, lk.paragraph_no, lk.paragraph_char,
    lk.parent_doc_id,
    r.rrf                              as score,
    1 - (lk.embedding <=> q.vec)       as similarity
  from rrf_combined r
  join public.legal_knowledge_chunks lk on lk.id = r.id
  cross join q
  order by r.rrf desc
  limit match_count;
$$;
