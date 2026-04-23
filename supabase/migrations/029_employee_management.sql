-- ============================================================
-- 029_employee_management.sql
-- 직원 관리: employees + work_records 테이블
-- ensure_standard_sub_hubs: Evaluations → Managing
-- ============================================================

-- 1. employees 테이블
-- ------------------------------------------------------------
create table if not exists public.employees (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.profiles(id) on delete cascade,
  name             text not null,
  employment_type  text not null check (employment_type in ('초단시간', '시급제', '월급제')),
  hourly_rate      integer,          -- 원/시간 (초단시간·시급제)
  monthly_salary   integer,          -- 원/월 (월급제)
  pay_day          integer check (pay_day between 1 and 31),  -- 지급 예정일
  phone            text,
  department       text,
  position         text,
  hire_date        date,
  status           text not null default 'active' check (status in ('active', 'inactive')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists employees_account_id_idx on public.employees(account_id);
create index if not exists employees_status_idx      on public.employees(account_id, status);


-- 2. work_records 테이블
-- ------------------------------------------------------------
create table if not exists public.work_records (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.employees(id) on delete cascade,
  account_id          uuid not null references public.profiles(id) on delete cascade,
  work_date           date not null,
  hours_worked        numeric(5,2) not null default 0,
  overtime_hours      numeric(5,2) not null default 0,
  night_hours         numeric(5,2) not null default 0,
  holiday_hours       numeric(5,2) not null default 0,
  memo                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (employee_id, work_date)
);

create index if not exists work_records_employee_id_idx on public.work_records(employee_id);
create index if not exists work_records_account_id_idx  on public.work_records(account_id);
create index if not exists work_records_date_idx        on public.work_records(employee_id, work_date);


-- 3. updated_at 자동 갱신 트리거
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employees_updated_at   on public.employees;
create trigger employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

drop trigger if exists work_records_updated_at on public.work_records;
create trigger work_records_updated_at
  before update on public.work_records
  for each row execute function public.set_updated_at();


-- 4. ensure_standard_sub_hubs — Evaluations → Managing
-- ------------------------------------------------------------
create or replace function public.ensure_standard_sub_hubs(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  spec        record;
  main_hub_id uuid;
  sub_hub_id  uuid;
begin
  for spec in
    with defs(domain, title) as (
      values
        ('recruitment'::text, 'Job_posting'),
        ('recruitment',        'Interviews'),
        ('recruitment',        'Onboarding'),
        ('recruitment',        'Managing'),      -- Evaluations → Managing
        ('documents',          'Review'),
        ('documents',          'Tax&HR'),
        ('documents',          'Legal'),
        ('documents',          'Operations'),
        ('sales',              'Revenue'),
        ('sales',              'Costs'),
        ('sales',              'Pricing'),
        ('sales',              'Customers'),
        ('sales',              'Reports'),
        ('marketing',          'Social'),
        ('marketing',          'Blog'),
        ('marketing',          'Campaigns'),
        ('marketing',          'Events'),
        ('marketing',          'Reviews')
    )
    select * from defs
  loop
    if exists (
      select 1 from public.artifacts a
      where a.account_id = p_account
        and a.kind = 'domain'
        and a.type = 'category'
        and a.title = spec.title
        and spec.domain = any(a.domains)
    ) then
      continue;
    end if;

    select id into main_hub_id
    from public.artifacts
    where account_id = p_account
      and kind = 'domain'
      and (type is null or type = '' or type <> 'category')
      and spec.domain = any(domains)
    limit 1;

    if main_hub_id is null then
      continue;
    end if;

    insert into public.artifacts(account_id, domains, kind, type, title, content, status)
    values (p_account, array[spec.domain], 'domain', 'category', spec.title, '', 'active')
    returning id into sub_hub_id;

    insert into public.artifact_edges(account_id, parent_id, child_id, relation)
    values (p_account, main_hub_id, sub_hub_id, 'contains');
  end loop;
end;
$$;


-- 5. 기존 Evaluations 서브허브 → Managing 으로 rename
-- ------------------------------------------------------------
update public.artifacts
set title = 'Managing'
where kind = 'domain'
  and type = 'category'
  and title = 'Evaluations'
  and 'recruitment' = any(domains);


-- 6. 기존 계정에 Managing 서브허브 backfill (Evaluations 가 없던 경우)
-- ------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in select id from public.profiles loop
    perform public.ensure_standard_sub_hubs(p.id);
  end loop;
end $$;
