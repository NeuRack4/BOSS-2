-- 007_memos.sql
-- 노드별 메모 (타임라인 형식). 각 메모는 embeddings 테이블에 1행으로 인덱싱되어
-- 검색/orchestrator hybrid_search 에 자연스럽게 합류한다.

-- 1) memos 테이블
create table public.memos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index memos_artifact_id_idx on public.memos(artifact_id);
create index memos_account_id_idx on public.memos(account_id);

-- 2) RLS
alter table public.memos enable row level security;
create policy "memo select own" on public.memos for select
  using (auth.uid() = account_id);
create policy "memo insert own" on public.memos for insert
  with check (auth.uid() = account_id);
create policy "memo update own" on public.memos for update
  using (auth.uid() = account_id);
create policy "memo delete own" on public.memos for delete
  using (auth.uid() = account_id);

-- 3) embeddings.source_type 에 'memo' 추가
alter table public.embeddings drop constraint if exists embeddings_source_type_check;
alter table public.embeddings add constraint embeddings_source_type_check
  check (source_type = any (array[
    'recruitment','marketing','sales','documents',
    'memory','document',
    'schedule','log','hub',
    'memo'
  ]));

-- 4) updated_at 자동 갱신
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists memos_set_updated_at on public.memos;
create trigger memos_set_updated_at
  before update on public.memos
  for each row execute function public.set_updated_at();
