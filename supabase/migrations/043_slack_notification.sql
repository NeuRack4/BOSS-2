-- 041_slack_notification.sql

create table if not exists slack_connections (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid unique not null references accounts(id) on delete cascade,
  slack_user_id text not null,
  access_token  text not null,
  team_name     text,
  created_at    timestamptz default now()
);

create table if not exists notification_settings (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid unique not null references accounts(id) on delete cascade,
  notify_enabled bool default true,
  notify_hour    int default 21,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table slack_connections enable row level security;
alter table notification_settings enable row level security;
