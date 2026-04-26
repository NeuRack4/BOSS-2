"""Planner DeepAgent 도구 모음.

Non-terminal tools (get_profile, search_memory, get_recent_artifacts, get_memos, list_capabilities)
+ Terminal tools (ask_user, dispatch, trigger_planning) + ContextVar result store.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any

from langchain_core.tools import tool

from app.agents._agent_context import get_account_id
from app.core.supabase import get_supabase

log = logging.getLogger("boss2.planner_tools")

# ──────────────────────────────────────────────────────────────────────────
# Per-request result store (terminal tool이 여기에 결과를 기록한다)
# ──────────────────────────────────────────────────────────────────────────
_planner_result: ContextVar[dict | None] = ContextVar("planner_result", default=None)


def init_result_store() -> dict:
    """요청 시작 시 호출 — 빈 dict를 store로 설정하고 반환."""
    store: dict = {}
    _planner_result.set(store)
    return store


def get_result_store() -> dict | None:
    """현재 결과 store 반환 (terminal tool이 쓰기 전이면 None)."""
    return _planner_result.get(None)


# ──────────────────────────────────────────────────────────────────────────
# Non-terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def get_profile() -> dict:
    """사용자의 비즈니스 프로필을 반환합니다.
    업종(business_type), 지역(location), 사업 단계(business_stage),
    직원 수(employees_count), 주 목표(primary_goal), 닉네임(display_name) 등을 포함합니다.
    프로필이 없으면 빈 dict를 반환합니다.
    """
    account_id = get_account_id()
    sb = get_supabase()
    rows = (
        sb.table("profiles")
        .select(
            "display_name,business_type,business_name,business_stage,"
            "employees_count,location,channels,primary_goal,profile_meta"
        )
        .eq("id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return {}
    p = rows[0]
    # profile_meta 압축 (최대 5개 키만 노출)
    meta = p.pop("profile_meta", None) or {}
    if isinstance(meta, dict):
        p["extra"] = dict(list(meta.items())[:5])
    return {k: v for k, v in p.items() if v is not None}


@tool
async def search_memory(query: str) -> list[dict]:
    """사용자의 장기기억(pgvector)에서 query와 관련된 내용을 검색합니다.
    최대 4개의 관련 청크를 반환합니다. 사용자의 이전 대화, 선호도, 사업 맥락을 파악할 때 사용하세요.
    """
    account_id = get_account_id()
    try:
        from app.rag.retriever import hybrid_search
        chunks = await hybrid_search(account_id, query, limit=4)
        return [{"content": c.get("content", "")[:300]} for c in chunks]
    except Exception as e:
        log.warning("search_memory failed: %s", e)
        return []


@tool
def get_recent_artifacts(domain: str = "", limit: int = 5) -> list[dict]:
    """최근 저장된 artifact 목록을 반환합니다.
    domain 파라미터로 특정 도메인(recruitment|marketing|sales|documents)만 필터 가능.
    각 artifact의 id, title, type, 생성일을 반환합니다.
    """
    account_id = get_account_id()
    sb = get_supabase()
    q = (
        sb.table("artifacts")
        .select("id,title,type,domains,created_at")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .order("created_at", desc=True)
        .limit(min(limit, 20))
    )
    if domain:
        q = q.contains("domains", [domain])
    rows = q.execute().data or []
    return [
        {
            "id": r["id"],
            "title": r.get("title") or "",
            "type": r.get("type") or "",
            "created_at": (r.get("created_at") or "")[:10],
        }
        for r in rows
    ]


@tool
def get_memos(limit: int = 10) -> list[dict]:
    """사용자가 저장한 최근 메모 목록을 반환합니다. 각 메모의 내용(최대 200자)과 날짜를 반환합니다."""
    account_id = get_account_id()
    sb = get_supabase()
    rows = (
        sb.table("memos")
        .select("content,updated_at")
        .eq("account_id", account_id)
        .order("updated_at", desc=True)
        .limit(min(limit, 20))
        .execute()
        .data
        or []
    )
    return [
        {
            "content": (r.get("content") or "")[:200],
            "updated_at": (r.get("updated_at") or "")[:10],
        }
        for r in rows
    ]


@tool
def list_capabilities() -> list[dict]:
    """4개 도메인(recruitment, marketing, sales, documents)의 모든 capability 카탈로그를 반환합니다.
    각 capability의 name, description, required_params, optional_params를 포함합니다.
    dispatch() 호출 전 이 도구로 capability 이름과 필수 파라미터를 확인하세요.
    """
    account_id = get_account_id()
    from app.agents._capability import describe_all
    tools_spec, _ = describe_all(account_id)
    result = []
    for t in tools_spec:
        f = t.get("function") or {}
        params = f.get("parameters") or {}
        props = params.get("properties") or {}
        required = set(params.get("required") or [])
        result.append({
            "name": f.get("name", ""),
            "description": (f.get("description") or "")[:120],
            "required_params": [k for k in props if k in required],
            "optional_params": [k for k in props if k not in required],
        })
    return result


# ──────────────────────────────────────────────────────────────────────────
# Terminal tools — 반드시 둘 중 하나를 호출해야 planner가 올바르게 종료됨
# ──────────────────────────────────────────────────────────────────────────

@tool
def ask_user(
    question: str,
    choices: list[str] | None = None,
    profile_updates: dict[str, str] | None = None,
) -> str:
    """[TERMINAL] 사용자에게 명확화 질문을 합니다.
    required 파라미터가 부족하거나 의도가 불명확할 때 호출하세요.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    question: 사용자에게 물을 한 문장.
    choices: 객관식 보기 (3~4개 권장, 마지막은 '기타 (직접 입력)'). 자유 응답이면 빈 리스트 또는 None.
    profile_updates: 이번 턴에서 확인된 프로필 정보 (확신 없으면 넣지 말 것).
    """
    store = _planner_result.get(None)
    if store is not None:
        store["mode"] = "ask"
        store["question"] = question
        store["choices"] = choices or []
        store["profile_updates"] = profile_updates or {}
    return "질문이 전송됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def dispatch(
    steps: list[dict[str, Any]],
    brief: str,
    opening: str = "",
    profile_updates: dict[str, str] | None = None,
) -> str:
    """[TERMINAL] 도메인 에이전트를 실행합니다.
    필요한 정보가 모두 확인되었을 때 호출하세요.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    steps: 실행할 capability 목록. 각 step은 아래 형식:
      { "capability": <list_capabilities()에서 확인한 이름>,
        "args": { <required_params를 모두 채운 dict> },
        "depends_on": <이전 step capability 이름 또는 null> }
    brief: domain agent에 전달할 내부 지시 (사용자에게 노출 안 됨).
    opening: 사용자에게 먼저 보여줄 한두 줄 안내 (선택).
    profile_updates: 이번 턴에서 확인된 프로필 정보.
    """
    store = _planner_result.get(None)
    if store is not None:
        store["mode"] = "dispatch"
        store["steps"] = steps
        store["brief"] = brief
        store["opening"] = opening
        store["profile_updates"] = profile_updates or {}
    return "도메인 에이전트가 실행됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def trigger_planning(opening: str = "") -> str:
    """[TERMINAL] 기간별 할 일 정리/플랜 모드를 요청합니다.
    '이번 주 할 일', '오늘 뭐 해야 돼' 같이 여러 도메인을 가로지르는 기간 단위 정리 요청에 사용하세요.
    이 도구를 호출하면 대화가 종료됩니다.
    """
    store = _planner_result.get(None)
    if store is not None:
        store["mode"] = "planning"
        store["opening"] = opening
    return "플래닝 모드로 전환됩니다. 추가 도구 호출 없이 종료하세요."


# 편의 export
PLANNER_TOOLS = [
    get_profile,
    search_memory,
    get_recent_artifacts,
    get_memos,
    list_capabilities,
    ask_user,
    dispatch,
    trigger_planning,
]

TERMINAL_TOOL_NAMES = {"ask_user", "dispatch", "trigger_planning"}
