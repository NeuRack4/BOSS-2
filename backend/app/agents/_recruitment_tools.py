"""Recruitment DeepAgent 도구 모음.

Non-terminal: get_recent_posting, get_resume
Terminal: write_posting_set, write_interview, write_hiring_drive,
          write_checklist_guide, write_onboarding, write_resume_interview,
          write_interview_evaluation, export_evaluation_docx, generate_posting_poster
Result store: init_recruit_result_store / get_recruit_result_store
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from langchain_core.tools import tool

from app.agents._agent_context import get_account_id

log = logging.getLogger("boss2.recruitment_tools")

_recruit_result: ContextVar[dict | None] = ContextVar("recruit_result", default=None)


def init_recruit_result_store() -> dict:
    """요청 시작 시 호출 — 빈 dict로 초기화하고 반환."""
    store: dict = {}
    _recruit_result.set(store)
    return store


def get_recruit_result_store() -> dict | None:
    """현재 결과 store 반환. terminal tool 호출 전이면 빈 dict."""
    return _recruit_result.get(None)


# ──────────────────────────────────────────────────────────────────────────
# Non-terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def get_recent_posting() -> dict:
    """가장 최근에 저장된 채용공고 세트(job_posting_set)를 반환합니다.
    포스터 생성 또는 후속 작업 시 posting_set_id 확인에 사용하세요.
    저장된 공고가 없으면 빈 dict를 반환합니다.
    """
    account_id = get_account_id()
    from app.agents.recruitment import _find_recent_posting_set
    posting = _find_recent_posting_set(account_id)
    if not posting:
        return {}
    return {
        "id": posting.get("id"),
        "title": posting.get("title") or "",
        "created_at": (posting.get("created_at") or "")[:10],
        "preview": (posting.get("content") or "")[:400],
    }


@tool
def get_resume() -> list[dict]:
    """최근 파싱된 이력서 목록을 반환합니다. (최대 5건)
    이력서 기반 면접질문 또는 평가표 생성 시 지원자 이름 확인에 사용하세요.
    이력서가 없으면 빈 리스트를 반환합니다.
    """
    account_id = get_account_id()
    from app.core.supabase import get_supabase
    sb = get_supabase()
    rows = (
        sb.table("resumes")
        .select("id,file_name,applicant,parsed_at")
        .eq("account_id", account_id)
        .order("parsed_at", desc=True)
        .limit(5)
        .execute()
        .data or []
    )
    result = []
    for r in rows:
        a = r.get("applicant") or {}
        result.append({
            "id": r.get("id"),
            "name": (a.get("name") or "").strip() or r.get("file_name", ""),
            "desired_position": a.get("desired_position") or "",
            "parsed_at": (r.get("parsed_at") or "")[:10],
        })
    return result


# ──────────────────────────────────────────────────────────────────────────
# Terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def write_posting_set(
    title: str,
    karrot_content: str,
    albamon_content: str,
    saramin_content: str,
    start_date: str | None = None,
    end_date: str | None = None,
    due_label: str | None = None,
) -> str:
    """[TERMINAL] 당근알바·알바천국·사람인 3종 플랫폼 채용공고 세트를 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 채용공고 세트 제목 (예: "홀서빙 알바 채용공고")
    karrot_content: 당근알바용 공고 본문 (친근한 톤, 이모지 1~2개, 300~600자)
    albamon_content: 알바천국용 공고 본문 (표준 구인 양식, 굵은 헤더 + bullet)
    saramin_content: 사람인용 공고 본문 (공식 톤, 회사소개→담당업무→자격요건→복리후생 순)
    start_date: 모집 시작일 YYYY-MM-DD (선택)
    end_date: 모집 마감일 YYYY-MM-DD (선택)
    due_label: 기한 설명 (기본: 모집 마감)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "write_posting_set"
        store["title"] = title
        store["karrot_content"] = karrot_content
        store["albamon_content"] = albamon_content
        store["saramin_content"] = saramin_content
        store["start_date"] = start_date
        store["end_date"] = end_date
        store["due_label"] = due_label
    return "채용공고 세트가 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_interview(
    title: str,
    content: str,
    position: str | None = None,
    level: str | None = None,
) -> str:
    """[TERMINAL] 면접 질문 세트를 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 면접 질문 세트 제목 (예: "바리스타 신입 면접 질문")
    content: 완성된 면접 질문 목록 (번호 목록 마크다운 형식)
    position: 직종/직무 (선택, 예: 바리스타)
    level: 지원자 레벨 (선택, 예: 신입/경력/시니어)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "write_interview"
        store["title"] = title
        store["content"] = content
        store["position"] = position
        store["level"] = level
    return "면접 질문이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_hiring_drive(
    title: str,
    content: str,
    start_date: str,
    end_date: str,
    headcount: int,
    target_position: str | None = None,
) -> str:
    """[TERMINAL] 공채/시즌 채용 기간(hiring_drive)을 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    스케쥴러가 D-7/D-3/D-1/D-0 리마인드를 자동으로 발송합니다.

    title: 채용 기간 이름 (예: "2026년 하반기 공채")
    content: 채용 기간 상세 내용 (마크다운)
    start_date: 채용 시작일 YYYY-MM-DD
    end_date: 채용 마감일 YYYY-MM-DD
    headcount: 모집 인원 (명)
    target_position: 대상 직종 (선택, 예: 홀서빙)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "write_hiring_drive"
        store["title"] = title
        store["content"] = content
        store["start_date"] = start_date
        store["end_date"] = end_date
        store["headcount"] = headcount
        store["target_position"] = target_position
    return "채용 기간이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_checklist_guide(
    title: str,
    content: str,
    doc_type: str = "checklist",
) -> str:
    """[TERMINAL] 채용 관련 체크리스트 또는 가이드를 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    ⚠️ 계약서(근로계약서 포함) 작성에는 사용하지 마세요. 계약서는 documents 도메인의 doc_contract 전용입니다.

    title: 문서 제목 (예: "신입 바리스타 채용 체크리스트")
    content: 완성된 체크리스트 또는 가이드 본문 (마크다운)
    doc_type: 문서 유형 — "checklist" 또는 "guide" (기본: checklist)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "write_checklist_guide"
        store["title"] = title
        store["content"] = content
        store["doc_type"] = doc_type
    return "체크리스트/가이드가 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_onboarding(
    title: str,
    content: str,
    onboarding_type: str,
    position: str | None = None,
) -> str:
    """[TERMINAL] 신규 입사자 온보딩 자료를 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 자료 제목 (예: "바리스타 온보딩 체크리스트")
    content: 완성된 온보딩 자료 본문 (마크다운)
    onboarding_type: 자료 유형 — 반드시 아래 중 하나:
        - "onboarding_checklist": 입사 전·당일·첫 주 단계별 체크리스트
        - "onboarding_plan": 수습 기간 일자별/주별 온보딩 플랜
        - "education_material": 업무 교육 자료 (매뉴얼·가이드·SOP)
    position: 직책/직종 (선택, 예: 바리스타)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "write_onboarding"
        store["title"] = title
        store["content"] = content
        store["onboarding_type"] = onboarding_type
        store["position"] = position
    return "온보딩 자료가 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_resume_interview(
    applicant_name: str,
    count: int = 7,
) -> str:
    """[TERMINAL] 저장된 이력서를 기반으로 맞춤 면접 질문을 생성합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    반드시 get_resume()로 지원자 이름을 확인한 후 호출하세요.

    applicant_name: 면접 질문을 생성할 지원자 이름 (이력서에서 파싱된 이름)
    count: 생성할 면접 질문 수 (기본 7, 최소 3, 최대 15)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "write_resume_interview"
        store["applicant_name"] = applicant_name
        store["count"] = count
    return "이력서 기반 면접 질문을 생성합니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_interview_evaluation(
    applicant_name: str,
    position: str | None = None,
    custom_categories_json: str | None = None,
    weights_json: str | None = None,
) -> str:
    """[TERMINAL] 저장된 이력서를 기반으로 맞춤 면접 평가표를 생성합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    반드시 get_resume()로 지원자 이름을 확인한 후 호출하세요.

    applicant_name: 평가표를 만들 지원자 이름 (이력서에서 파싱된 이름)
    position: 지원 직종 (선택 — 이력서에 희망직종이 있으면 생략 가능)
    custom_categories_json: 커스텀 평가 항목 목록 JSON 문자열 (예: '["기술역량","태도","소통"]')
    weights_json: 항목별 배점 비율 JSON 문자열 (예: '{"기술역량": 50, "태도": 30, "소통": 20}', 합계 100)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "write_interview_evaluation"
        store["applicant_name"] = applicant_name
        store["position"] = position
        store["custom_categories_json"] = custom_categories_json
        store["weights_json"] = weights_json
    return "면접 평가표를 생성합니다. 추가 도구 호출 없이 종료하세요."


@tool
def export_evaluation_docx(
    artifact_id: str | None = None,
    applicant_name: str | None = None,
) -> str:
    """[TERMINAL] 캔버스의 면접 평가표를 DOCX 파일로 내보냅니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    사용자가 평가표 검토·수정 후 'DOCX로 저장/내보내기/다운로드'를 요청할 때 호출하세요.

    artifact_id: DOCX로 변환할 interview_evaluation artifact ID (선택 — 미확정 시 생략)
    applicant_name: 지원자 이름으로 artifact 검색 시 사용 (선택)
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "export_evaluation_docx"
        store["artifact_id"] = artifact_id
        store["applicant_name"] = applicant_name
    return "DOCX 파일을 생성합니다. 추가 도구 호출 없이 종료하세요."


@tool
def generate_posting_poster(
    posting_set_id: str | None = None,
    platforms_json: str = '["karrot"]',
    style: str = "",
) -> str:
    """[TERMINAL] 채용공고 포스터 이미지를 생성합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    먼저 get_recent_posting()으로 posting_set_id를 확인하세요.

    posting_set_id: 포스터를 생성할 job_posting_set artifact ID (선택 — 미확정 시 최근 공고 자동 사용)
    platforms_json: 포스터를 만들 플랫폼 목록 JSON 문자열 (예: '["karrot"]', '["karrot","albamon"]')
        유효 값: "karrot", "albamon", "saramin"
    style: 디자인 스타일 지시 (예: "따뜻한 브라운 톤, 미니멀 타이포")
    """
    store = _recruit_result.get(None)
    if store is not None:
        store["action"] = "generate_posting_poster"
        store["posting_set_id"] = posting_set_id
        store["platforms_json"] = platforms_json
        store["style"] = style
    return "포스터를 생성합니다. 추가 도구 호출 없이 종료하세요."


# ──────────────────────────────────────────────────────────────────────────
# 편의 export
# ──────────────────────────────────────────────────────────────────────────

RECRUITMENT_TOOLS = [
    get_recent_posting,
    get_resume,
    write_posting_set,
    write_interview,
    write_hiring_drive,
    write_checklist_guide,
    write_onboarding,
    write_resume_interview,
    write_interview_evaluation,
    export_evaluation_docx,
    generate_posting_poster,
]

RECRUITMENT_TERMINAL_TOOL_NAMES = {
    "write_posting_set",
    "write_interview",
    "write_hiring_drive",
    "write_checklist_guide",
    "write_onboarding",
    "write_resume_interview",
    "write_interview_evaluation",
    "export_evaluation_docx",
    "generate_posting_poster",
}
