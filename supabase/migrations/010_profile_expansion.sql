-- 010_profile_expansion.sql
-- profiles 에 사업 컨텍스트 추가. 도메인 에이전트가 매 응답에서 참조하고,
-- orchestrator 가 대화 중 [SET_PROFILE] 블록으로 자동 수집한다.
--
-- 7개 core 컬럼 + 자유 정보용 profile_meta jsonb (예: sns_channels 리스트).

alter table public.profiles
  add column if not exists business_type text,
  add column if not exists business_name text,
  add column if not exists business_stage text,
  add column if not exists employees_count text,
  add column if not exists location text,
  add column if not exists channels text,
  add column if not exists primary_goal text,
  add column if not exists profile_meta jsonb default '{}'::jsonb;
