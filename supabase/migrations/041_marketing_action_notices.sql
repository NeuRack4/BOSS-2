-- 마케팅 할 일 알림 테이블
create table if not exists marketing_action_notices (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  category    text not null,
  priority    text not null,
  period      text,
  due_date    date not null,
  target      text,
  idea        text,
  steps       jsonb,
  expected    text,
  why         text,
  created_at  timestamptz default now(),
  unique (account_id, title, due_date)
);

alter table marketing_action_notices enable row level security;

create policy "owner access" on marketing_action_notices
  for all using (auth.uid() = account_id);
