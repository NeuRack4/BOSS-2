-- ============================================================
-- 014_standard_sub_hubs.sql
-- 모든 계정이 동일한 표준 서브허브 세트를 공유하도록 변경.
--
-- Recruitment: Evaluations / Onboarding / Interviews / Job_posting
-- Documents:   Operations / Legal / Tax&HR / Contracts
-- Sales:       Costs / Pricing / Customers / Reports
-- Marketing:   Social / Blog / Campaigns / Events / Reviews
--
-- 설계:
--   1) helper ensure_standard_sub_hubs(account_id) — idempotent:
--      (account_id, domain, title) 가 없으면 서브허브 artifact 삽입 +
--      메인허브와 contains 엣지 연결.
--   2) bootstrap_workspace 가 trigger 마지막에 helper 호출.
--   3) 이미 가입된 모든 profile 에 대해 helper 를 한 번 실행(backfill).
-- ============================================================

create or replace function public.ensure_standard_sub_hubs(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  spec record;
  main_hub_id uuid;
  sub_hub_id  uuid;
begin
  -- 표준 서브허브 목록 — (domain, title) 쌍
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
        ('sales',              'Reports'),
        ('sales',              'Customers'),
        ('sales',              'Pricing'),
        ('sales',              'Costs'),
        ('marketing',          'Social'),
        ('marketing',          'Blog'),
        ('marketing',          'Campaigns'),
        ('marketing',          'Events'),
        ('marketing',          'Reviews')
    )
    select * from defs
  loop
    -- 이미 존재하면 skip — domain + title 일치 + kind='domain' + type='category'
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

    -- 메인허브 id 조회 (type is null or '' — category 아님)
    select id into main_hub_id
    from public.artifacts
    where account_id = p_account
      and kind = 'domain'
      and (type is null or type = '' or type <> 'category')
      and spec.domain = any(domains)
    limit 1;

    if main_hub_id is null then
      -- 메인허브가 없으면 서브허브 만들 수 없음 (bootstrap 먼저 필요)
      continue;
    end if;

    -- 서브허브 insert
    insert into public.artifacts(account_id, domains, kind, type, title, content, status)
    values (p_account, array[spec.domain], 'domain', 'category', spec.title, '', 'active')
    returning id into sub_hub_id;

    -- 메인허브 → 서브허브 contains 엣지
    insert into public.artifact_edges(account_id, parent_id, child_id, relation)
    values (p_account, main_hub_id, sub_hub_id, 'contains');
  end loop;
end;
$$;


-- bootstrap_workspace 가 신규 가입 시 helper 도 호출하도록 교체
create or replace function public.bootstrap_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  anchor_id  uuid;
  recruit_id uuid;
  market_id  uuid;
  sales_id   uuid;
  docs_id    uuid;
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;

  insert into public.artifacts(account_id, kind, title, content)
    values (new.id, 'anchor', 'Orchestrator', '오케스트레이터 트리거')
    returning id into anchor_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['recruitment'], 'domain', '채용 관리', 'Recruitment')
    returning id into recruit_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['marketing'], 'domain', '마케팅 관리', 'Marketing')
    returning id into market_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['sales'], 'domain', '매출 관리', 'Sales')
    returning id into sales_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['documents'], 'domain', '서류 관리', 'Documents')
    returning id into docs_id;

  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (new.id, anchor_id, recruit_id, 'contains'),
    (new.id, anchor_id, market_id,  'contains'),
    (new.id, anchor_id, sales_id,   'contains'),
    (new.id, anchor_id, docs_id,    'contains');

  -- 17 표준 서브허브 + contains 엣지
  perform public.ensure_standard_sub_hubs(new.id);

  return new;
end;
$$;


-- 이미 존재하는 모든 profile 에 대해 backfill
do $$
declare
  p record;
begin
  for p in select id from public.profiles loop
    perform public.ensure_standard_sub_hubs(p.id);
  end loop;
end $$;
