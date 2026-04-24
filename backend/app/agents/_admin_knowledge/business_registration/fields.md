# 사업자등록 신청서 — 프로필 필드 매핑

## profiles 컬럼 → 양식 placeholder 매핑

| 양식 placeholder        | profiles 컬럼   | profile_meta 키   | 비고                                  |
| ----------------------- | --------------- | ----------------- | ------------------------------------- |
| {{business_name}}       | business_name   | —                 | 상호명                                |
| {{representative_name}} | display_name    | —                 | 대표자 성명                           |
| {{phone_mobile}}        | phone_mobile    | —                 | 휴대전화                              |
| {{phone_business}}      | phone_business  | —                 | 사업장 전화                           |
| {{email}}               | email           | —                 | 전자우편                              |
| {{location}}            | location        | —                 | 사업장 소재지                         |
| {{opening_date}}        | opening_date    | —                 | 개업일 (YYYY-MM-DD)                   |
| {{employees_count}}     | employees_count | —                 | 종업원 수                             |
| {{industry_code}}       | industry_code   | —                 | 주업종 코드                           |
| {{business_form}}       | business_form   | —                 | 개인일반 / 개인간이 / 법인            |
| {{industry_type}}       | business_type   | —                 | 주업태 (예: 음식점)                   |
| {{industry_item}}       | —               | industry_item     | 주종목 (예: 한식)                     |
| {{cyber_mall_name}}     | —               | cyber_mall_name   | 사이버몰 명칭                         |
| {{cyber_mall_domain}}   | —               | cyber_mall_domain | 사이버몰 도메인                       |
| {{owned_area}}          | —               | owned_area        | 자가 면적(㎡)                         |
| {{rented_area}}         | —               | rented_area       | 타가 면적(㎡)                         |
| {{landlord_name}}       | —               | landlord_name     | 임대인 성명                           |
| {{landlord_reg_no}}     | —               | landlord_reg_no   | 임대인 사업자/주민번호                |
| {{lease_period}}        | —               | lease_period      | 임대차 계약기간                       |
| {{lease_deposit}}       | —               | lease_deposit     | 전세 보증금                           |
| {{lease_monthly}}       | —               | lease_monthly     | 월세(차임)                            |
| {{own_capital}}         | —               | own_capital       | 자기자금                              |
| {{borrowed_capital}}    | —               | borrowed_capital  | 타인자금                              |
| {{신청일}}              | —               | —                 | 신청서 작성일 (오늘 날짜, today 참조) |

## 보안상 저장 불가 (항상 placeholder 유지)

- 주민등록번호 → `{{주민등록번호 직접 기재}}`

## LLM 채움 규칙

1. profiles 컬럼에 값이 있으면 → 해당 값으로 교체
2. profile_meta[key]에 값이 있으면 → 해당 값으로 교체
3. 값이 없으면 → `{{placeholder}}` 그대로 유지
4. 주민등록번호는 절대 추론·생성하지 말 것
5. 업태/종목 미지정 시 business_type 에서 추론 가능하면 적용
6. `{{신청일}}` 은 today_context 의 오늘 날짜(YYYY-MM-DD)로 교체 — 개업일(opening_date)과 혼용 금지
