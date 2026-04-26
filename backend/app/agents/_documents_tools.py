"""Documents DeepAgent 도구 모음.

Non-terminal: get_uploaded_doc, get_recent_analysis, get_sub_hubs
Terminal: write_document, analyze_document
Result store: init_docs_result_store / get_docs_result_store
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from langchain_core.tools import tool

from app.agents._agent_context import get_account_id, get_history, get_rag_context, get_long_term_context

log = logging.getLogger("boss2.documents_tools")

# ──────────────────────────────────────────────────────────────────────────
# Per-request result store
# ──────────────────────────────────────────────────────────────────────────
_docs_result: ContextVar[dict | None] = ContextVar("docs_result", default=None)


def init_docs_result_store() -> dict:
    """요청 시작 시 호출 — 빈 dict로 초기화하고 반환."""
    store: dict = {}
    _docs_result.set(store)
    return store


def get_docs_result_store() -> dict | None:
    """현재 결과 store 반환. terminal tool 호출 전이면 빈 dict."""
    return _docs_result.get(None)


# ──────────────────────────────────────────────────────────────────────────
# Non-terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def get_uploaded_doc() -> dict:
    """최근 업로드된 문서의 내용과 메타데이터를 반환합니다.
    공정성 분석 요청 시 반드시 먼저 호출해 doc_id를 확인하세요.
    업로드 문서가 없으면 빈 dict를 반환합니다.
    """
    account_id = get_account_id()
    from app.agents.documents import _find_recent_uploaded_doc
    doc = _find_recent_uploaded_doc(account_id)
    if not doc:
        return {}
    return {
        "id":      doc.get("id"),
        "title":   doc.get("title") or "",
        "preview": (doc.get("content") or "")[:600],
        "ephemeral": bool(doc.get("_ephemeral")),
    }


@tool
def get_recent_analysis() -> dict:
    """직전에 수행된 공정성 분석 결과를 반환합니다.
    분석 결과가 없으면 빈 dict를 반환합니다.
    """
    account_id = get_account_id()
    from app.agents.documents import _find_recent_analysis
    analysis = _find_recent_analysis(account_id)
    if not analysis:
        return {}
    meta = analysis.get("metadata") or {}
    return {
        "analysis_id":       analysis.get("id"),
        "user_role":         meta.get("user_role", "미지정"),
        "gap_ratio":         meta.get("gap_ratio"),
        "eul_ratio":         meta.get("eul_ratio"),
        "contract_subtype":  meta.get("contract_subtype"),
        "summary":           (analysis.get("content") or "")[:400],
    }


@tool
def get_sub_hubs() -> list[str]:
    """이 계정의 Documents 서브허브 목록을 반환합니다.
    서류 저장 시 sub_domain 결정에 참고하세요.
    서브허브는 Review, Tax&HR, Operations, Legal 4종입니다.
    """
    account_id = get_account_id()
    from app.agents._artifact import list_sub_hub_titles
    return list_sub_hub_titles(account_id, "documents")


# ──────────────────────────────────────────────────────────────────────────
# Terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def write_document(
    doc_type: str,
    title: str,
    content: str,
    subtype: str | None = None,
    due_date: str | None = None,
    due_label: str | None = None,
) -> str:
    """[TERMINAL] 서류를 작성하고 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    doc_type: contract | estimate | proposal | notice | checklist | guide |
              subsidy_recommendation | admin_application | hr_evaluation |
              payroll_doc | tax_calendar
    title: 문서 제목 (예: "근로계약서 — 주방 보조 홍길동")
    content: 완성된 문서 본문 (마크다운). 반드시 실제 내용으로 채울 것. placeholder 금지.
    subtype: contract 에만 사용 (labor|lease|service|supply|partnership|franchise|nda)
    due_date: YYYY-MM-DD 형식 기한 (견적 유효기간, 계약 만료일 등)
    due_label: 기한 설명 (예: "계약 만료", "견적 유효기간")
    """
    store = _docs_result.get(None)
    if store is not None:
        store["action"] = "write"
        store["doc_type"] = doc_type
        store["title"] = title
        store["content"] = content
        store["subtype"] = subtype
        store["due_date"] = due_date
        store["due_label"] = due_label
    return "서류가 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def analyze_document(
    user_role: str,
    doc_type: str = "계약서",
    contract_subtype: str | None = None,
) -> str:
    """[TERMINAL] 업로드된 문서의 공정성을 분석합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    반드시 get_uploaded_doc()을 먼저 호출해 doc_id를 확인한 뒤 이 도구를 호출하세요.

    user_role: 갑 | 을 | 미지정
    doc_type: 계약서 | 제안서 | 기타
    contract_subtype: labor | lease | service | supply | partnership | franchise | nda (없으면 None)
    """
    store = _docs_result.get(None)
    if store is not None:
        store["action"] = "analyze"
        store["user_role"] = user_role
        store["doc_type"] = doc_type
        store["contract_subtype"] = contract_subtype
    return "공정성 분석이 시작됩니다. 추가 도구 호출 없이 종료하세요."


# 편의 export
DOCUMENTS_TOOLS = [
    get_uploaded_doc,
    get_recent_analysis,
    get_sub_hubs,
    write_document,
    analyze_document,
]

DOCUMENTS_TERMINAL_TOOL_NAMES = {"write_document", "analyze_document"}
