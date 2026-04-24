create table if not exists dashboard_layouts (
  account_id uuid primary key references profiles(id) on delete cascade,
  layout     jsonb        not null default '[]'::jsonb,
  hidden     text[]       not null default '{}',
  updated_at timestamptz  not null default now()
);
