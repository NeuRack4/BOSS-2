-- 002_schema.sql
-- public 스키마 테이블 정의.
-- 모든 테이블은 auth.users(id)를 참조하는 account_id 컬럼을 통해 RLS로 분리된다.
-- artifacts + artifact_edges는 캔버스 DAG 구조를 하나의 테이블 쌍으로 표현한다.

-- profiles: auth.users 확장 (display_name 등)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- artifacts: DAG 노드 (anchor / domain / artifact / schedule / log)
create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  domains text[] check (
    domains is null
    or domains <@ array['recruitment','marketing','sales','documents']::text[]
  ),
  kind text not null check (
    kind = any (array['anchor','domain','artifact','schedule','log'])
  ),
  type text not null default '',
  title text not null,
  content text not null default '',
  status text not null default 'draft',
  position_x double precision,
  position_y double precision,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- artifact_edges: DAG 엣지 (contains / derives_from / scheduled_by / revises / logged_from)
create table public.artifact_edges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid not null references public.artifacts(id) on delete cascade,
  child_id uuid not null references public.artifacts(id) on delete cascade,
  relation text not null default 'derives_from' check (
    relation = any (array['contains','derives_from','scheduled_by','revises','logged_from'])
  ),
  created_at timestamptz default now(),
  unique (parent_id, child_id, relation)
);

-- embeddings: RAG 하이브리드 서치 대상 (artifact / memory / document)
create table public.embeddings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (
    source_type = any (array['recruitment','marketing','sales','documents','memory','document'])
  ),
  source_id uuid not null,
  content text not null,
  fts tsvector,
  embedding vector(1024),
  created_at timestamptz default now()
);

-- memory_long: 계정별 장기 기억 (RAG recall 대상)
create table public.memory_long (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  importance double precision default 1.0,
  embedding vector(1024),
  created_at timestamptz default now()
);

-- activity_logs: 활동이력 타임라인
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type = any (array['artifact_created','agent_run'])),
  domain text not null check (
    domain = any (array['recruitment','marketing','sales','documents'])
  ),
  title text not null,
  description text not null default '',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- schedules: Celery Beat 동적 등록용
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  domain text not null,
  cron_expr text not null,
  is_active boolean default true,
  last_run timestamptz,
  next_run timestamptz,
  created_at timestamptz default now()
);

-- task_logs: 스케쥴 실행 결과
create table public.task_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.schedules(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status = any (array['success','failed','running'])),
  result jsonb,
  error text,
  executed_at timestamptz default now()
);

-- evaluations: 생성물 피드백 (up/down)
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  rating text not null check (rating = any (array['up','down'])),
  feedback text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (account_id, artifact_id)
);

-- chat_sessions: 대화 세션 (타이틀 + 타임스탬프)
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '새 대화',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- chat_messages: 세션 내 메시지
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role = any (array['user','assistant','system'])),
  content text not null,
  choices jsonb,
  created_at timestamptz default now()
);
