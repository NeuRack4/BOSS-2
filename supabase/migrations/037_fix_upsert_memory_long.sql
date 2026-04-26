-- ============================================================
-- 037_fix_upsert_memory_long.sql
-- upsert_memory_long RPC 재작성 — ON CONFLICT 제거
--
-- 기존 ON CONFLICT (partial unique index) 방식이
-- "there is no unique or exclusion constraint matching" 오류를 발생시켜
-- SELECT → UPDATE/INSERT 방식으로 교체.
-- 인덱스가 없어도 동작하며, 인덱스가 있으면 성능 이점은 유지됨.
-- ============================================================

-- partial unique index 가 없으면 생성 (이미 있으면 무시)
create unique index if not exists memory_long_account_domain_date_uniq
  on public.memory_long(account_id, domain, digest_date)
  where domain is not null and digest_date is not null;

-- fts 컬럼 없으면 추가
alter table public.memory_long
  add column if not exists domain      text,
  add column if not exists digest_date date,
  add column if not exists fts         tsvector;

-- upsert_memory_long RPC 재작성 (ON CONFLICT 제거)
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
  v_id       uuid;
  v_existing uuid;
begin
  select id into v_existing
  from public.memory_long
  where account_id  = p_account_id
    and domain      = p_domain
    and digest_date = p_digest_date
  limit 1;

  if v_existing is not null then
    update public.memory_long
    set content    = p_content,
        embedding  = p_embedding,
        importance = greatest(importance, p_importance),
        fts        = to_tsvector('simple', p_content)
    where id = v_existing
    returning id into v_id;
  else
    insert into public.memory_long (
      account_id, content, embedding, importance, domain, digest_date, fts
    ) values (
      p_account_id, p_content, p_embedding, p_importance,
      p_domain, p_digest_date,
      to_tsvector('simple', p_content)
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;
