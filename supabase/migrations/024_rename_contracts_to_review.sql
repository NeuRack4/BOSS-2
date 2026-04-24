-- ============================================================
-- 024_rename_contracts_to_review.sql
-- Documents 서브허브 'Contracts' → 'Review' 로 재명명.
--
-- 배경:
--   v1.3 에서 Documents 서브허브 4종의 역할을 재정의.
--     Review      — 계약서·제안서처럼 공정 중립이 필요한 서류 (검토·공정성 분석)
--     Tax&HR      — 인사평가 관리 + 세무 문서 (채용 제외)
--     Legal       — 법률 자문 (RAG + legal_annual_values)
--     Operations  — 국가 지원사업·행정 처리 신청서·일반 서류 초안 작성
--
-- 내부 식별자(contract_subtype / *_contract_knowledge_chunks /
-- search_*_contract_knowledge)는 그대로 유지 — 사용자 노출 라벨만 변경.
--
-- 순서:
--   1) 기존 서브허브 title 을 in-place UPDATE → 자식 contains 엣지 자동 승계
--   2) ensure_standard_sub_hubs(p_account) 재정의 (Contracts 자리에 Review)
--   3) 모든 계정에 backfill 호출 (idempotent — 이미 있는 계정은 skip)
-- ============================================================

-- ------------------------------------------------------------
-- 1. 기존 Contracts 서브허브를 Review 로 in-place 업데이트
-- ------------------------------------------------------------
-- parent_id 는 유지되므로 자식(계약서·공정성 분석 artifact)은 자동 승계.
-- 혹시 'Review' 라는 동일 title 이 이미 존재하는 계정이 있다면 (중복 방지)
-- 기존 Contracts 를 삭제하고 자식을 Review 로 재배선해야 하지만,
-- 014 · 021 마이그레이션 이후 'Review' title 은 Documents 도메인에 없으므로
-- 단순 UPDATE 로 안전.
update public.artifacts
   set title = 'Review'
 where kind = 'domain'
   and type = 'category'
   and title = 'Contracts'
   and 'documents' = any(domains);


-- ------------------------------------------------------------
-- 2. ensure_standard_sub_hubs — Documents 쪽을 Review 로 교체
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


-- ------------------------------------------------------------
-- 3. 누락 계정 backfill (idempotent)
-- ------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in select id from public.profiles loop
    perform public.ensure_standard_sub_hubs(p.id);
  end loop;
end $$;
