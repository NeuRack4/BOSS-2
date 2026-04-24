-- ============================================================
-- seed_legal_annual_values.sql
-- 법정 수치 시드 데이터. ON CONFLICT DO UPDATE 로 멱등성 보장.
--
-- 연 1회 갱신 권장. 새 연도 수치가 공표되면 관련 행 추가.
-- 출처 URL 은 공식 부처 사이트 기준.
-- ============================================================

-- ── 1. 최저임금 (시간당 + 월 환산 209h) ──────────────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, effective_from, note, unverified) values
  ('minimum_wage', 2020, '{"hourly": 8590,  "monthly": 1795310}'::jsonb, '최저임금위원회', 'https://www.minimumwage.go.kr', '2020-01-01', '월 환산 209시간 기준', false),
  ('minimum_wage', 2021, '{"hourly": 8720,  "monthly": 1822480}'::jsonb, '최저임금위원회', 'https://www.minimumwage.go.kr', '2021-01-01', '월 환산 209시간 기준', false),
  ('minimum_wage', 2022, '{"hourly": 9160,  "monthly": 1914440}'::jsonb, '최저임금위원회', 'https://www.minimumwage.go.kr', '2022-01-01', '월 환산 209시간 기준', false),
  ('minimum_wage', 2023, '{"hourly": 9620,  "monthly": 2010580}'::jsonb, '최저임금위원회', 'https://www.minimumwage.go.kr', '2023-01-01', '월 환산 209시간 기준', false),
  ('minimum_wage', 2024, '{"hourly": 9860,  "monthly": 2060740}'::jsonb, '최저임금위원회', 'https://www.minimumwage.go.kr', '2024-01-01', '월 환산 209시간 기준', false),
  ('minimum_wage', 2025, '{"hourly": 10030, "monthly": 2096270}'::jsonb, '최저임금위원회', 'https://www.minimumwage.go.kr', '2025-01-01', '월 환산 209시간 기준. 2024-07 고시', false),
  ('minimum_wage', 2026, '{"hourly": 10320, "monthly": 2156880}'::jsonb, '최저임금위원회', 'https://www.minimumwage.go.kr', '2026-01-01', '월 환산 209시간 기준. 2025-07 고시 (추정값, 공식 확인 권장)', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      effective_from=excluded.effective_from, note=excluded.note, unverified=excluded.unverified,
      updated_at=now();

-- ── 2. 부가세 간이과세자 기준 매출액 ─────────────────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('vat_simplified_threshold', 2020, '{"annual_revenue_limit": 48000000}'::jsonb, '국세청', 'https://www.nts.go.kr', '4800만원 이하 간이과세', false),
  ('vat_simplified_threshold', 2021, '{"annual_revenue_limit": 80000000}'::jsonb, '국세청', 'https://www.nts.go.kr', '8000만원으로 상향 (2021.01 개정)', false),
  ('vat_simplified_threshold', 2024, '{"annual_revenue_limit": 104000000}'::jsonb, '국세청', 'https://www.nts.go.kr', '1억 400만원으로 상향 (2024.07~)', false),
  ('vat_simplified_threshold', 2025, '{"annual_revenue_limit": 104000000}'::jsonb, '국세청', 'https://www.nts.go.kr', '1억 400만원 (유지)', false),
  ('vat_simplified_threshold', 2026, '{"annual_revenue_limit": 104000000}'::jsonb, '국세청', 'https://www.nts.go.kr', '1억 400만원 (유지, 공식 확인 권장)', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 3. 부가가치세율 (일반/영세) ──────────────────────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('vat_rate', 2024, '{"general_rate": 0.10, "zero_rate": 0.00, "simplified_rate_range": [0.005, 0.03]}'::jsonb, '국세청', 'https://www.nts.go.kr', '일반 10%, 영세 0%, 간이 업종별 0.5~3%', false),
  ('vat_rate', 2025, '{"general_rate": 0.10, "zero_rate": 0.00, "simplified_rate_range": [0.005, 0.03]}'::jsonb, '국세청', 'https://www.nts.go.kr', '변동 없음', false),
  ('vat_rate', 2026, '{"general_rate": 0.10, "zero_rate": 0.00, "simplified_rate_range": [0.005, 0.03]}'::jsonb, '국세청', 'https://www.nts.go.kr', '변동 없음', false)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 4. 종합소득세 과세표준 구간 (2023 개정, 2024 귀속분부터) ─
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('income_tax_brackets', 2023, '{"brackets": [
      {"up_to": 12000000,  "rate": 0.06},
      {"up_to": 46000000,  "rate": 0.15},
      {"up_to": 88000000,  "rate": 0.24},
      {"up_to": 150000000, "rate": 0.35},
      {"up_to": 300000000, "rate": 0.38},
      {"up_to": 500000000, "rate": 0.40},
      {"up_to": 1000000000,"rate": 0.42},
      {"up_to": null,      "rate": 0.45}
    ]}'::jsonb, '국세청', 'https://www.nts.go.kr', '2023년 귀속분까지 8단계 구간. 1200만/4600만/8800만/1.5억/3억/5억/10억', false),
  ('income_tax_brackets', 2024, '{"brackets": [
      {"up_to": 14000000,  "rate": 0.06},
      {"up_to": 50000000,  "rate": 0.15},
      {"up_to": 88000000,  "rate": 0.24},
      {"up_to": 150000000, "rate": 0.35},
      {"up_to": 300000000, "rate": 0.38},
      {"up_to": 500000000, "rate": 0.40},
      {"up_to": 1000000000,"rate": 0.42},
      {"up_to": null,      "rate": 0.45}
    ]}'::jsonb, '국세청', 'https://www.nts.go.kr', '2024년 귀속분부터 저소득 구간 상향: 1400만/5000만/8800만/1.5억/3억/5억/10억', false),
  ('income_tax_brackets', 2025, '{"brackets": [
      {"up_to": 14000000,  "rate": 0.06},
      {"up_to": 50000000,  "rate": 0.15},
      {"up_to": 88000000,  "rate": 0.24},
      {"up_to": 150000000, "rate": 0.35},
      {"up_to": 300000000, "rate": 0.38},
      {"up_to": 500000000, "rate": 0.40},
      {"up_to": 1000000000,"rate": 0.42},
      {"up_to": null,      "rate": 0.45}
    ]}'::jsonb, '국세청', 'https://www.nts.go.kr', '2025년 귀속분 (유지)', false),
  ('income_tax_brackets', 2026, '{"brackets": [
      {"up_to": 14000000,  "rate": 0.06},
      {"up_to": 50000000,  "rate": 0.15},
      {"up_to": 88000000,  "rate": 0.24},
      {"up_to": 150000000, "rate": 0.35},
      {"up_to": 300000000, "rate": 0.38},
      {"up_to": 500000000, "rate": 0.40},
      {"up_to": 1000000000,"rate": 0.42},
      {"up_to": null,      "rate": 0.45}
    ]}'::jsonb, '국세청', 'https://www.nts.go.kr', '2026년 귀속분 (공식 확인 권장)', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 5. 4대보험료율 (사업주/근로자 분담, 2024~2026) ────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('social_insurance_rates', 2024, '{
      "national_pension":  {"total": 0.09,    "employer": 0.045,  "employee": 0.045},
      "health_insurance":  {"total": 0.0709,  "employer": 0.03545,"employee": 0.03545, "long_term_care_of_health": 0.009182},
      "employment_insurance": {"employee": 0.009, "employer_base": 0.009, "employer_stability_training_range": [0.0025, 0.0085]},
      "industrial_accident": {"employer_range": [0.007, 0.185], "note": "업종별 고시료율"}
    }'::jsonb, '국민연금공단/건강보험공단/근로복지공단', 'https://www.nps.or.kr', '2024 기준. 건강보험 7.09% (각 3.545%), 장기요양 건강보험료의 12.95%', false),
  ('social_insurance_rates', 2025, '{
      "national_pension":  {"total": 0.09,    "employer": 0.045,  "employee": 0.045},
      "health_insurance":  {"total": 0.0709,  "employer": 0.03545,"employee": 0.03545, "long_term_care_of_health": 0.009182},
      "employment_insurance": {"employee": 0.009, "employer_base": 0.009, "employer_stability_training_range": [0.0025, 0.0085]},
      "industrial_accident": {"employer_range": [0.007, 0.185], "note": "업종별 고시료율"}
    }'::jsonb, '국민연금공단/건강보험공단/근로복지공단', 'https://www.nps.or.kr', '2025 기준 (대부분 동결)', false),
  ('social_insurance_rates', 2026, '{
      "national_pension":  {"total": 0.09,    "employer": 0.045,  "employee": 0.045},
      "health_insurance":  {"total": 0.0709,  "employer": 0.03545,"employee": 0.03545, "long_term_care_of_health": 0.009182},
      "employment_insurance": {"employee": 0.009, "employer_base": 0.009, "employer_stability_training_range": [0.0025, 0.0085]},
      "industrial_accident": {"employer_range": [0.007, 0.185], "note": "업종별 고시료율"}
    }'::jsonb, '국민연금공단/건강보험공단/근로복지공단', 'https://www.nps.or.kr', '2026 기준 (공식 확인 권장)', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 6. 상가건물 임대차보호법 환산보증금 상한 (2019 개정 현행) ─
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('commercial_lease_deposit_cap', 2019, '{"regions": {
      "seoul":             910000000,
      "busan_incheon_etc": 690000000,
      "metropolitan_city": 540000000,
      "other":             370000000
    }, "unit": "KRW"}'::jsonb, '법무부', 'https://www.moleg.go.kr', '환산보증금 = 보증금 + (월세 × 100). 초과 시 법 보호 일부 제한', false),
  ('commercial_lease_deposit_cap', 2024, '{"regions": {
      "seoul":             910000000,
      "busan_incheon_etc": 690000000,
      "metropolitan_city": 540000000,
      "other":             370000000
    }, "unit": "KRW"}'::jsonb, '법무부', 'https://www.moleg.go.kr', '2019 개정 기준 유지', false),
  ('commercial_lease_deposit_cap', 2026, '{"regions": {
      "seoul":             910000000,
      "busan_incheon_etc": 690000000,
      "metropolitan_city": 540000000,
      "other":             370000000
    }, "unit": "KRW"}'::jsonb, '법무부', 'https://www.moleg.go.kr', '2019 개정 기준 유지 (공식 확인 권장)', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 7. 소상공인·소기업 기준 (업종별 매출액) ──────────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('smb_threshold', 2024, '{
      "소상공인": {
        "제조업":            {"employees_lt": 10,  "annual_revenue_lt": 12000000000},
        "광업/건설업/운수업": {"employees_lt": 10,  "annual_revenue_lt": 8000000000},
        "기타":              {"employees_lt": 5,   "annual_revenue_lt": 3000000000}
      },
      "소기업": {
        "제조업":            {"annual_revenue_lt": 12000000000},
        "도소매업":          {"annual_revenue_lt": 5000000000},
        "서비스업":          {"annual_revenue_lt": 1000000000}
      }
    }'::jsonb, '중소벤처기업부', 'https://www.mss.go.kr',
    '소상공인기본법·중소기업기본법 시행령 기준. 업종별 매출액·상시근로자 수', false),
  ('smb_threshold', 2026, '{
      "소상공인": {
        "제조업":            {"employees_lt": 10,  "annual_revenue_lt": 12000000000},
        "광업/건설업/운수업": {"employees_lt": 10,  "annual_revenue_lt": 8000000000},
        "기타":              {"employees_lt": 5,   "annual_revenue_lt": 3000000000}
      },
      "소기업": {
        "제조업":            {"annual_revenue_lt": 12000000000},
        "도소매업":          {"annual_revenue_lt": 5000000000},
        "서비스업":          {"annual_revenue_lt": 1000000000}
      }
    }'::jsonb, '중소벤처기업부', 'https://www.mss.go.kr', '2024 기준 유지 추정 (공식 확인 권장)', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 8. 개인정보보호법 과태료·과징금 상한 ─────────────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('privacy_penalty', 2024, '{
      "max_fine_krw": 50000000,
      "max_admin_penalty_ratio_of_revenue": 0.03,
      "note": "개인정보 유출 시 과태료 최대 5천만원, 전체 매출 3% 이내 과징금. 2023.09 시행"
    }'::jsonb, '개인정보보호위원회', 'https://www.pipc.go.kr',
    '개인정보보호법 §75, §64-2. 유출 등 중대 위반 시 과태료 + 과징금 병과 가능', false),
  ('privacy_penalty', 2026, '{
      "max_fine_krw": 50000000,
      "max_admin_penalty_ratio_of_revenue": 0.03,
      "note": "2023.09 개정 기준 유지. 공식 확인 권장"
    }'::jsonb, '개인정보보호위원회', 'https://www.pipc.go.kr', '공식 확인 권장', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 9. 가맹사업법 가맹금 예치 기준 ───────────────────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('franchise_deposit', 2024, '{
      "min_deposit_trigger_krw": 1000000,
      "deposit_period_months": 2,
      "note": "가맹금이 100만원 이상이면 공정위 지정 예치기관에 2개월 예치 의무 (가맹사업법 §6-5)"
    }'::jsonb, '공정거래위원회', 'https://www.ftc.go.kr', '예치 의무 및 면제 요건은 가맹사업법 시행령 참조', false)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();

-- ── 10. 근로기준법 주요 기준 (단시간·수습 등) ────────────────
insert into public.legal_annual_values (category, year, value, source_name, source_url, note, unverified) values
  ('labor_thresholds', 2024, '{
      "probation_pay_min_ratio": 0.90,
      "probation_max_months": 3,
      "overtime_pay_ratio": 1.50,
      "night_pay_ratio": 1.50,
      "holiday_pay_ratio": 1.50,
      "weekly_work_limit_hours": 52,
      "weekly_regular_hours": 40,
      "annual_leave_base_days": 15,
      "retirement_year_min_months": 12,
      "notice_resign_days": 30,
      "notice_dismissal_days": 30,
      "notice_dismissal_pay_days": 30
    }'::jsonb, '고용노동부', 'https://www.moel.go.kr',
    '수습 3개월 내 최저임금의 90% 허용, 연장·야간·휴일가산 각 50%, 주 52시간제, 연차 15일, 퇴직금 발생 기준 계속근로 1년', false),
  ('labor_thresholds', 2026, '{
      "probation_pay_min_ratio": 0.90,
      "probation_max_months": 3,
      "overtime_pay_ratio": 1.50,
      "night_pay_ratio": 1.50,
      "holiday_pay_ratio": 1.50,
      "weekly_work_limit_hours": 52,
      "weekly_regular_hours": 40,
      "annual_leave_base_days": 15,
      "retirement_year_min_months": 12,
      "notice_resign_days": 30,
      "notice_dismissal_days": 30,
      "notice_dismissal_pay_days": 30
    }'::jsonb, '고용노동부', 'https://www.moel.go.kr', '2024 기준 유지 (공식 확인 권장)', true)
on conflict (category, year) do update
  set value=excluded.value, source_name=excluded.source_name, source_url=excluded.source_url,
      note=excluded.note, unverified=excluded.unverified, updated_at=now();
