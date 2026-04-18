-- 004_rls.sql
-- Row Level Security 정책.
-- 모든 테이블은 auth.uid() = account_id 기반으로 분리.
-- profiles 만 예외적으로 id 컬럼으로 본인 판별.

alter table public.profiles        enable row level security;
alter table public.artifacts       enable row level security;
alter table public.artifact_edges  enable row level security;
alter table public.embeddings      enable row level security;
alter table public.memory_long     enable row level security;
alter table public.activity_logs   enable row level security;
alter table public.schedules       enable row level security;
alter table public.task_logs       enable row level security;
alter table public.evaluations     enable row level security;
alter table public.chat_sessions   enable row level security;
alter table public.chat_messages   enable row level security;

-- profiles: 본인만 조회/수정
create policy "본인만 조회"
  on public.profiles for select
  using (auth.uid() = id);

create policy "본인만 수정"
  on public.profiles for update
  using (auth.uid() = id);

-- artifacts / artifact_edges / evaluations: account_id 기반 전체 (with check 포함)
create policy "own artifacts all"
  on public.artifacts for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

create policy "own edges all"
  on public.artifact_edges for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

create policy "own evaluations all"
  on public.evaluations for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

-- chat_sessions / chat_messages: account_id 기반 전체
create policy "본인 세션 전체"
  on public.chat_sessions for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

create policy "본인 세션 메시지 전체"
  on public.chat_messages for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

-- 서비스/백엔드 write 경로 (with_check 생략, using 만)
create policy "본인 임베딩 전체"
  on public.embeddings for all
  using (auth.uid() = account_id);

create policy "본인 장기메모리 전체"
  on public.memory_long for all
  using (auth.uid() = account_id);

create policy "본인 활동이력 전체"
  on public.activity_logs for all
  using (auth.uid() = account_id);

create policy "본인 스케쥴 전체"
  on public.schedules for all
  using (auth.uid() = account_id);

create policy "본인 태스크로그 전체"
  on public.task_logs for all
  using (auth.uid() = account_id);
