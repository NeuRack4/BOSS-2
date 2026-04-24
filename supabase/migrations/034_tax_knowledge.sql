-- ============================================================
-- 034_tax_knowledge.sql
-- 세무 자문 전용 RAG 지식 테이블 + 3-way RRF 검색 함수.
--
-- 3축 데이터:
--   statute : 세법 조문         (law.go.kr DRF API)
--   ruling  : 국세청 예규·고시  (taxlaw.nts.go.kr)
--   case    : 조세심판원 심판례  (ttax.go.kr)
--
-- BAAI/bge-m3 (1024dim) 임베딩.
-- 청킹: article / paragraph (statute), section (ruling / case)
-- ============================================================

create table if not exists public.tax_knowledge_chunks (
  id             bigserial primary key,
  source_type    text not null,   -- 'statute' | 'ruling' | 'case'
  tax_category   text not null,   -- 'vat' | 'income_tax' | 'corporate_tax' |
                                  -- 'national_tax_basic' | 'special_tax' |
                                  -- 'local_tax' | 'inheritance_tax' | 'other'
  source         text not null,   -- 법령명 / 예규번호 / 심판결정번호
  chunk_index    int  not null default 0,
  chunk_type     text,            -- 'article' | 'paragraph' | 'section'
  article_no     text,
  article_title  text,
  paragraph_no   int,
  paragraph_char text,
  parent_doc_id  bigint references public.tax_knowledge_chunks(id),
  content        text not null,
  embedding      vector(1024),
  metadata       jsonb,
  created_at     timestamptz default now(),
  unique (source, chunk_type, article_no, paragraph_no)
);

create index if not exists tax_kc_embedding_idx
  on public.tax_knowledge_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists tax_kc_trgm_idx
  on public.tax_knowledge_chunks using gin (content gin_trgm_ops);

create index if not exists tax_kc_fts_idx
  on public.tax_knowledge_chunks using gin (to_tsvector('simple', content));

create index if not exists tax_kc_source_type_idx
  on public.tax_knowledge_chunks (source_type);

create index if not exists tax_kc_category_idx
  on public.tax_knowledge_chunks (tax_category);

alter table public.tax_knowledge_chunks enable row level security;
create policy "tax_kc_read" on public.tax_knowledge_chunks for select using (true);


-- ============================================================
-- search_tax_knowledge: 3-way RRF
--   축 1 : 세법 조문  (statute)  — 법령 원문 검색
--   축 2 : 예규·고시  (ruling)   — 국세청 해석 검색
--   축 3 : 심판례     (case)     — 불복 결정례 검색
--
-- filter_source_type 이 주어지면 해당 축만 활성화.
-- filter_tax_category 로 부가세/소득세 등 세목 한정 가능.
-- ============================================================

create or replace function public.search_tax_knowledge(
  query_text         text,
  query_embedding    text,
  match_count        integer          default 8,
  filter_source_type text             default null,
  filter_tax_category text            default null,
  rrf_k              integer          default 60,
  min_score          double precision default 0.2,
  min_trgm_score     double precision default 0.15,
  min_content_len    integer          default 40
)
returns table (
  id             bigint,
  content        text,
  metadata       jsonb,
  source         text,
  source_type    text,
  tax_category   text,
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
  with q as (select query_embedding::vector as vec),

  -- 축 1: 세법 조문 (statute) — 벡터 랭킹
  statute_vec as (
    select tc.id,
      row_number() over (order by tc.embedding <=> q.vec) as rnk
    from public.tax_knowledge_chunks tc, q
    where (filter_source_type is null or filter_source_type = 'statute')
      and tc.source_type = 'statute'
      and (filter_tax_category is null or tc.tax_category = filter_tax_category)
      and 1 - (tc.embedding <=> q.vec) >= min_score
      and char_length(tc.content) > min_content_len
    order by tc.embedding <=> q.vec
    limit match_count * 4
  ),
  -- 축 1: 세법 조문 (statute) — FTS 랭킹
  statute_fts as (
    select tc.id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', tc.content), plainto_tsquery('simple', query_text)) desc
      ) as rnk
    from public.tax_knowledge_chunks tc
    where (filter_source_type is null or filter_source_type = 'statute')
      and tc.source_type = 'statute'
      and (filter_tax_category is null or tc.tax_category = filter_tax_category)
      and to_tsvector('simple', tc.content) @@ plainto_tsquery('simple', query_text)
      and char_length(tc.content) > min_content_len
    limit match_count * 4
  ),

  -- 축 2: 예규·고시 (ruling) — 벡터 랭킹
  ruling_vec as (
    select tc.id,
      row_number() over (order by tc.embedding <=> q.vec) as rnk
    from public.tax_knowledge_chunks tc, q
    where (filter_source_type is null or filter_source_type = 'ruling')
      and tc.source_type = 'ruling'
      and (filter_tax_category is null or tc.tax_category = filter_tax_category)
      and 1 - (tc.embedding <=> q.vec) >= min_score
      and char_length(tc.content) > min_content_len
    order by tc.embedding <=> q.vec
    limit match_count * 4
  ),
  -- 축 2: 예규·고시 (ruling) — FTS 랭킹
  ruling_fts as (
    select tc.id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', tc.content), plainto_tsquery('simple', query_text)) desc
      ) as rnk
    from public.tax_knowledge_chunks tc
    where (filter_source_type is null or filter_source_type = 'ruling')
      and tc.source_type = 'ruling'
      and (filter_tax_category is null or tc.tax_category = filter_tax_category)
      and to_tsvector('simple', tc.content) @@ plainto_tsquery('simple', query_text)
      and char_length(tc.content) > min_content_len
    limit match_count * 4
  ),

  -- 축 3: 심판결정례 (case) — 벡터 랭킹
  case_vec as (
    select tc.id,
      row_number() over (order by tc.embedding <=> q.vec) as rnk
    from public.tax_knowledge_chunks tc, q
    where (filter_source_type is null or filter_source_type = 'case')
      and tc.source_type = 'case'
      and (filter_tax_category is null or tc.tax_category = filter_tax_category)
      and 1 - (tc.embedding <=> q.vec) >= min_score
      and char_length(tc.content) > min_content_len
    order by tc.embedding <=> q.vec
    limit match_count * 4
  ),
  -- 축 3: 심판결정례 (case) — FTS 랭킹
  case_fts as (
    select tc.id,
      row_number() over (
        order by ts_rank(to_tsvector('simple', tc.content), plainto_tsquery('simple', query_text)) desc
      ) as rnk
    from public.tax_knowledge_chunks tc
    where (filter_source_type is null or filter_source_type = 'case')
      and tc.source_type = 'case'
      and (filter_tax_category is null or tc.tax_category = filter_tax_category)
      and to_tsvector('simple', tc.content) @@ plainto_tsquery('simple', query_text)
      and char_length(tc.content) > min_content_len
    limit match_count * 4
  ),

  rrf_combined as (
    select id, sum(contrib) as rrf
    from (
      select id, 1.0 / (rrf_k + rnk) as contrib from statute_vec
      union all
      select id, 1.0 / (rrf_k + rnk) from statute_fts
      union all
      select id, 1.0 / (rrf_k + rnk) from ruling_vec
      union all
      select id, 1.0 / (rrf_k + rnk) from ruling_fts
      union all
      select id, 1.0 / (rrf_k + rnk) from case_vec
      union all
      select id, 1.0 / (rrf_k + rnk) from case_fts
    ) u
    group by id
  )
  select
    tc.id, tc.content, tc.metadata, tc.source, tc.source_type, tc.tax_category,
    tc.chunk_type, tc.article_no, tc.article_title, tc.paragraph_no, tc.paragraph_char,
    tc.parent_doc_id,
    r.rrf                              as score,
    1 - (tc.embedding <=> q.vec)       as similarity
  from rrf_combined r
  join public.tax_knowledge_chunks tc on tc.id = r.id
  cross join q
  order by r.rrf desc
  limit match_count;
$$;
