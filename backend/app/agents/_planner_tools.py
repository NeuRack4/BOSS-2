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
