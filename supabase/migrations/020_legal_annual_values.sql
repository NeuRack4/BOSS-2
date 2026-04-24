-- ============================================================
-- 020_legal_annual_values.sql
-- 매년 갱신되는 법정 수치 (최저임금·세율·보험료·각종 기준 금액).
--
-- 목적: LLM 학습 컷오프 이후 값까지 "확정 수치" 를 제공하기 위한 수동 관리 테이블.
--       `_legal.py` 가 질문의 카테고리+연도를 감지해 이 테이블을 먼저 조회하고
--       결과를 system prompt 에 주입한다. 법령 조문 RAG 와 병행.
--
-- 정책:
--   - INSERT/UPDATE 는 service_role 전용 (수동 관리 스크립트 / 마이그레이션).
--   - SELECT 는 모두에게 공개 (지식 베이스).
--   - `value` 는 jsonb — 카테고리마다 구조가 다르므로 유연하게.
--     (예: minimum_wage → {"hourly": 10030, "monthly": 2096270})
-- ============================================================

create table if not exists public.legal_annual_values (
  id              bigserial primary key,
  category        text not null,        -- 'minimum_wage' | 'vat_simplified_threshold' |
                                        -- 'income_tax_brackets' | 'social_insurance_rates' |
                                        -- 'commercial_lease_deposit_cap' | 'smb_threshold' |
                                        -- 'franchise_deposit' | 'privacy_penalty' | ...
  year            int not null,         -- 적용 연도
  value           jsonb not null,
  source_name     text,                 -- '고용노동부 고시', '국세청 안내' 등
  source_url      text,
  effective_from  date,                 -- 시행일 (선택)
  note            text,                 -- 참고 메모
  unverified      boolean default false,-- true 면 LLM 응답에 "확인 필요" 명시 유도
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (category, year)
);

create index if not exists lav_category_year_idx
  on public.legal_annual_values (category, year desc);

-- RLS — 공개 읽기, service_role 쓰기
alter table public.legal_annual_values enable row level security;

drop policy if exists "lav_read" on public.legal_annual_values;
create policy "lav_read" on public.legal_annual_values for select using (true);
