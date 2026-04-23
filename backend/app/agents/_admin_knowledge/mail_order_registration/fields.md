# 통신판매업 신고서 — 프로필 필드 매핑

## profiles 컬럼 → 양식 placeholder 매핑

| 양식 placeholder         | profiles 컬럼   | profile_meta 키      | 비고                        |
| ------------------------ | --------------- | -------------------- | --------------------------- |
| {{business_name}}        | business_name   | —                    | 법인명/상호                 |
| {{representative_name}}  | display_name    | —                    | 대표자 성명                 |
| {{location}}             | location        | —                    | 소재지 / 대표자 주소        |
| {{phone_business}}       | phone_business  | —                    | 신고인 전화번호             |
| {{phone_mobile}}         | phone_mobile    | —                    | 대표자 전화번호             |
| {{email}}                | email           | —                    | 전자우편주소                |
| {{business_reg_no}}      | business_reg_no | —                    | 사업자등록번호              |
| {{internet_domain}}      | —               | internet_domain      | 인터넷 도메인 이름          |
| {{host_server_location}} | —               | host_server_location | 호스트서버 소재지           |
| {{specific_product}}     | business_type   | —                    | 취급 품목 추론 가능 시 적용 |
| {{today}}                | —               | —                    | 신고일 (오늘 날짜 자동)     |

## 보안상 저장 불가 (항상 placeholder 유지)

- 주민등록번호 → `{{주민등록번호 직접 기재}}`
- 법인등록번호 → `{{주민등록번호 또는 법인등록번호 직접 기재}}`

## LLM 채움 규칙

1. profiles 컬럼에 값이 있으면 → 해당 값으로 교체
2. profile_meta[key]에 값이 있으면 → 해당 값으로 교체
3. 값이 없으면 → `{{placeholder}}` 그대로 유지
4. today는 항상 오늘 날짜(YYYY년 MM월 DD일)로 채울 것
5. business_type에서 취급 품목 카테고리 추론 가능하면 해당 체크박스에 [x] 표시
