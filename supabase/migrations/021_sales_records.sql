-- ============================================================
-- 018_sales_records.sql
-- Sales 도메인 실매출 데이터 테이블 + Revenue 서브허브 추가
--
-- 1) sales_records  — 매출 입력 전용 트랜잭션 테이블
-- 2) ensure_standard_sub_hubs 업데이트 — Sales에 Revenue 서브허브 추가
-- ============================================================

-- ------------------------------------------------------------
-- 1. sales_records 테이블
-- ------------------------------------------------------------
create table public.sales_records (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references auth.users(id) on delete cascade,
  recorded_date date not null,
  item_name     text not null,
  category      text not null default '기타',
  quantity      integer not null default 1 check (quantity > 0),
  unit_price    integer not null default 0 check (unit_price >= 0),
  amount        integer not null check (amount >= 0),
  source        text not null default 'chat'
                  check (source = any(array['chat','ocr','csv','excel'])),
  raw_input     text not null default '',
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz default now()
);

alter table public.sales_records enable row level security;

create policy "users can manage own sales_records"
  on public.sales_records for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

-- 날짜별 조회/집계 인덱스
create index idx_sales_records_account_date
  on public.sales_records(account_id, recorded_date desc);

-- ------------------------------------------------------------
-- 2. ensure_standard_sub_hubs — Revenue 서브허브 추가
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
        ('recruitment',        'Evaluations'),
        ('documents',          'Contracts'),
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

-- 기존 모든 계정에 Revenue 서브허브 backfill
do $$
declare
  p record;
begin
  for p in select id from public.profiles loop
    perform public.ensure_standard_sub_hubs(p.id);
  end loop;
end $$;
