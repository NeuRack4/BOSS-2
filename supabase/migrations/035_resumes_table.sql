-- 035_resumes_table.sql
create table if not exists resumes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null,
  file_name    text,
  parsed_at    timestamptz not null default now(),
  applicant    jsonb not null default '{}'
);

create index if not exists resumes_account_id_idx on resumes (account_id);
