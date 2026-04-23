"""행정 신청서 도메인 전용 템플릿/지식 모듈.

- VALID_ADMIN_TYPES  — 지원 양식 종류 (enum 역할)
- load_admin_knowledge(admin_type) — _admin_knowledge/{type}/*.md 통합 로드 (lru_cache)
- build_admin_context(admin_type, profile, profile_meta) — system prompt 말미 주입용 블록

확장 방법: _admin_knowledge/ 아래 새 디렉토리 생성 + VALID_ADMIN_TYPES / ADMIN_TYPE_LABELS 에
항목 추가. documents.py describe() 의 application_type enum 도 함께 갱신.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_KNOWLEDGE_ROOT = Path(__file__).parent / "_admin_knowledge"

VALID_ADMIN_TYPES: tuple[str, ...] = (
    "business_registration",    # 사업자등록 신청서
    "mail_order_registration",  # 통신판매업 신고서
    "purchase_safety_exempt",   # 구매안전서비스 비적용대상 확인서
)

ADMIN_TYPE_LABELS: dict[str, str] = {
    "business_registration":   "사업자등록 신청서",
    "mail_order_registration": "통신판매업 신고서",
    "purchase_safety_exempt":  "구매안전서비스 비적용대상 확인서",
}

# 양식별 처리 기한 (영업일) — due_date 자동 세팅용
ADMIN_TYPE_DUE_DAYS: dict[str, int] = {
    "business_registration":   2,
    "mail_order_registration": 7,
    "purchase_safety_exempt":  7,
}

ADMIN_TYPE_DUE_LABELS: dict[str, str] = {
    "business_registration":   "사업자등록 처리 기한",
    "mail_order_registration": "통신판매업 신고 처리 기한",
    "purchase_safety_exempt":  "통신판매업 신고 처리 기한",
}


@lru_cache(maxsize=16)
def load_admin_knowledge(admin_type: str) -> str:
    """_admin_knowledge/{admin_type}/form.md + fields.md + meta.md 를 하나의 블록으로 반환.

    파일이 없으면 빈 문자열. lru_cache 로 반복 로드 방지.
    """
    if admin_type not in VALID_ADMIN_TYPES:
        return ""
    base = _KNOWLEDGE_ROOT / admin_type
    parts: list[str] = []
    for fname, label in (
        ("form.md",   "양식"),
        ("fields.md", "필드 매핑"),
        ("meta.md",   "메타 정보"),
    ):
        path = base / fname
        if path.is_file():
            parts.append(f"[{label} — {ADMIN_TYPE_LABELS[admin_type]}]\n{path.read_text(encoding='utf-8')}")
    return "\n\n---\n\n".join(parts)


def build_admin_context(
    admin_type: str,
    profile: dict,
    profile_meta: dict,
) -> str:
    """LLM system prompt 말미에 주입할 컨텍스트 블록.

    양식 전체 + 필드 매핑 + 프로필 자동 채움 데이터를 하나의 문자열로 반환.
    LLM 은 이 블록을 보고 placeholder 를 실제 값으로 교체한다.
    """
    knowledge = load_admin_knowledge(admin_type)
    if not knowledge:
        return ""

    # 프로필 데이터 블록 — LLM 이 placeholder 채울 때 참조
    profile_lines: list[str] = ["[프로필 자동 채움 데이터]"]
    field_map: list[tuple[str, str]] = [
        ("business_name",   "상호(business_name)"),
        ("display_name",    "대표자 성명(display_name)"),
        ("business_reg_no", "사업자등록번호(business_reg_no)"),
        ("phone_mobile",    "휴대전화(phone_mobile)"),
        ("phone_business",  "사업장 전화(phone_business)"),
        ("email",           "전자우편(email)"),
        ("location",        "사업장 소재지(location)"),
        ("opening_date",    "개업일(opening_date)"),
        ("employees_count", "종업원 수(employees_count)"),
        ("industry_code",   "주업종 코드(industry_code)"),
        ("business_type",   "업태(business_type)"),
        ("business_form",   "사업자 형태(business_form)"),
    ]
    for key, label in field_map:
        val = profile.get(key)
        if val:
            profile_lines.append(f"- {label}: {val}")

    # profile_meta jsonb 추가 필드
    meta_keys = (
        "industry_item", "cyber_mall_name", "cyber_mall_domain",
        "owned_area", "rented_area",
        "landlord_name", "landlord_reg_no", "lease_period",
        "lease_deposit", "lease_monthly",
        "own_capital", "borrowed_capital",
        "internet_domain", "host_server_location",
        "exemption_reason",
    )
    for key in meta_keys:
        val = profile_meta.get(key)
        if val:
            profile_lines.append(f"- {key}: {val}")

    profile_block = "\n".join(profile_lines)

    fill_instruction = (
        "[양식 채움 규칙]\n"
        "1. 위 [프로필 자동 채움 데이터]의 값을 양식 해당 placeholder 에 교체하세요.\n"
        "2. 프로필에 없는 placeholder 는 {{...}} 형태 그대로 유지하세요.\n"
        "3. 주민등록번호·법인등록번호는 절대 생성·추론하지 마세요.\n"
        "4. {{today}} 는 오늘 날짜(YYYY년 MM월 DD일)로 채우세요.\n"
        "5. 체크박스는 사용자 메시지에서 언급된 사항은 [x], 나머지는 [ ] 유지.\n"
        "6. 양식 구조(표·체크박스·섹션)를 그대로 유지하며, 내용만 채우세요.\n"
        "7. 응답 마지막에 '📝 직접 채워야 할 항목' 섹션으로 미기입 항목을 정리하세요."
    )

    chunks = [knowledge, profile_block, fill_instruction]
    return "\n\n---\n\n".join(chunks)
