-- ============================================================
-- 025_memory_long_rrf_digest.sql
-- Long-term memory 구조 전면 개편 (v1.3):
--   (a) 도메인 × 날짜(KST) 단위 digest 저장 (domain + digest_date 컬럼 + partial unique)
--   (b) FTS 컬럼 추가 — vector + FTS RRF 하이브리드
--   (c) memory_search RPC 재작성 — RRF × importance 가중, 7일 recency 필터
--   (d) upsert_memory_long RPC 신규 — (account_id, domain, digest_date) conflict 처리
--   (e) 기존 memory_long 데이터 리셋 (스키마 전환)
-- ============================================================

-- ------------------------------------------------------------
-- 1. 기존 데이터 리셋 (스키마 전환)
-- ------------------------------------------------------------
delete from public.memory_long;

-- ------------------------------------------------------------
-- 2. 컬럼 추가
-- ------------------------------------------------------------
alter table public.memory_long
  add column if not exists domain      text,
  add column if not exists digest_date date,
  add column if not exists fts         tsvector;

-- domain 값 CHECK (nullable — compressor/evaluations 는 domain 없이 저장)
alter table public.memory_long drop constraint if exists memory_long_domain_check;
alter table public.memory_long add constraint memory_long_domain_check
  check (domain is null or domain = any(array['recruitment','marketing','sales','documents']));

-- ------------------------------------------------------------
-- 3. Partial unique — (account_id, domain, digest_date) 둘 다 NOT NULL 일 때만 unique
-- ------------------------------------------------------------
create unique index if not exists memory_long_account_domain_date_uniq
  on public.memory_long(account_id, domain, digest_date)
  where domain is not null and digest_date is not null;

-- ------------------------------------------------------------
-- 4. FTS GIN 인덱스
-- ------------------------------------------------------------
create index if not exists memory_long_fts_idx
  on public.memory_long using gin(fts);

-- ------------------------------------------------------------
-- 5. created_at recency 인덱스 (7일 필터용)
-- ------------------------------------------------------------
create index if not exists memory_long_account_created_idx
  on public.memory_long(account_id, created_at desc);

-- ------------------------------------------------------------
-- 6. upsert_memory_long RPC — 도메인 daily digest 전용
-- ------------------------------------------------------------
create or replace function public.upsert_memory_long(
  p_account_id  uuid,
  p_domain      text,
  p_digest_date date,
  p_content     text,
  p_embedding   vector,
  p_importance  double precision default 2.0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.memory_long (
    account_id, content, embedding, importance, domain, digest_date, fts
  ) values (
    p_account_id, p_content, p_embedding, p_importance, p_domain, p_digest_date,
    to_tsvector('simple', p_content)
  )
  on conflict (account_id, domain, digest_date) where domain is not null and digest_date is not null
  do update set
    content    = excluded.content,
    embedding  = excluded.embedding,
    importance = greatest(public.memory_long.importance, excluded.importance),
    fts        = excluded.fts
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 7. memory_search RPC 재작성 — RRF × importance + 7일 recency
--    (시그니처 변경: p_query_text 추가)
-- ------------------------------------------------------------
drop function if exists public.memory_search(uuid, vector, integer);

create or replace function public.memory_search(
  p_account_id uuid,
  p_embedding  vector,
  p_query_text text,
  p_limit      integer default 5
)
returns table (
  id          uuid,
  content     text,
  importance  double precision,
  similarity  double precision,
  rrf_score   double precision,
  domain      text,
  digest_date date,
  created_at  timestamptz
)
language sql
stable
as $$
  with recent as (
    select
      m.id,
      m.content,
      m.importance,
      m.domain,
      m.digest_date,
      m.created_at,
      1 - (m.embedding <=> p_embedding) as similarity,
      m.embedding,
      m.fts
    from public.memory_long m
    where m.account_id = p_account_id
      and m.created_at > now() - interval '7 days'
  ),
  vec_rank as (
    select id, row_number() over (order by embedding <=> p_embedding) as rnk
    from recent
  ),
  fts_rank as (
    select id, row_number() over (
      order by ts_rank(fts, plainto_tsquery('simple', p_query_text)) desc
    ) as rnk
    from recent
    where fts @@ plainto_tsquery('simple', p_query_text)
  ),
  merged as (
    select
      r.id,
      r.content,
      r.importance,
      r.similarity,
      r.domain,
      r.digest_date,
      r.created_at,
      (
        coalesce(1.0 / (60 + v.rnk), 0)
        + coalesce(1.0 / (60 + f.rnk), 0)
      ) * greatest(r.importance, 0.1) as rrf_score
    from recent r
    left join vec_rank v on v.id = r.id
    left join fts_rank f on f.id = r.id
  )
  select id, content, importance, similarity, rrf_score, domain, digest_date, created_at
  from merged
  where rrf_score > 0
  order by rrf_score desc
  limit p_limit;
$$;

-- ------------------------------------------------------------
-- 8. 기존 row 들 (이미 delete 됐지만 안전용) — NULL 채우기 불필요
-- ------------------------------------------------------------

comment on column public.memory_long.domain      is '도메인 digest 용 (recruitment/marketing/sales/documents). compressor/evaluations 는 NULL.';
comment on column public.memory_long.digest_date is '도메인 digest 의 날짜(KST 기준). 같은 계정×도메인×날짜는 1 row (upsert).';
comment on column public.memory_long.fts         is 'to_tsvector(simple, content) — RRF 하이브리드 검색용.';
