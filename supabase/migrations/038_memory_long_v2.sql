-- ============================================================
-- 038_memory_long_v2.sql
-- Long-term memory v2.0 — 1 artifact = 1 markdown row + 자동 압축
--
-- 변경 사항:
--   (a) 컬럼 추가: artifact_type, event_time, is_compressed
--   (b) digest 기반 unique index 제거 → artifact별 개별 row 방식
--   (c) upsert_memory_long RPC 제거 (더 이상 불필요)
--   (d) FTS 자동 업데이트 트리거 추가
--   (e) 압축 쿼리용 인덱스 추가
--   (f) memory_search RPC 수정 — is_compressed row는 7일 TTL 미적용
-- ============================================================

-- ------------------------------------------------------------
-- 1. 새 컬럼 추가
-- ------------------------------------------------------------
alter table public.memory_long
  add column if not exists artifact_type  text,
  add column if not exists event_time     timestamptz,
  add column if not exists is_compressed  boolean not null default false;

-- ------------------------------------------------------------
-- 2. digest 기반 unique index 제거
-- ------------------------------------------------------------
drop index if exists public.memory_long_account_domain_date_uniq;

-- ------------------------------------------------------------
-- 3. upsert_memory_long RPC 제거
-- ------------------------------------------------------------
drop function if exists public.upsert_memory_long(uuid, text, date, text, vector, double precision);

-- ------------------------------------------------------------
-- 4. FTS 자동 업데이트 트리거
--    (Python에서 fts를 직접 계산하지 않아도 됨)
-- ------------------------------------------------------------
create or replace function public.memory_long_fts_trigger()
returns trigger
language plpgsql
as $$
begin
  new.fts := to_tsvector('simple', new.content);
  return new;
end;
$$;

drop trigger if exists memory_long_fts_update on public.memory_long;
create trigger memory_long_fts_update
  before insert or update of content on public.memory_long
  for each row execute function public.memory_long_fts_trigger();

-- 기존 row fts 백필
update public.memory_long
  set fts = to_tsvector('simple', content)
  where fts is null;

-- ------------------------------------------------------------
-- 5. 압축 쿼리용 인덱스 — (account_id, domain, is_compressed, event_time)
-- ------------------------------------------------------------
create index if not exists memory_long_domain_compress_idx
  on public.memory_long(account_id, domain, is_compressed, event_time)
  where domain is not null;

-- ------------------------------------------------------------
-- 6. memory_search RPC 수정
--    - is_compressed = true → 7일 TTL 미적용 (압축된 오래된 기억도 recall)
--    - is_compressed = false → 기존과 동일하게 7일 TTL
-- ------------------------------------------------------------
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
      and (
        m.is_compressed = true
        or m.created_at > now() - interval '7 days'
      )
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
    where p_query_text <> ''
      and fts @@ plainto_tsquery('simple', p_query_text)
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
