"""지원사업 REST API

엔드포인트:
  GET /api/subsidies/matches?account_id=   — 프로필+메모리 기반 top 5 매칭
  GET /api/subsidies/search?q=&limit=&offset=  — 전체 검색 (3-way RRF or 전체 목록)
"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.supabase import get_supabase
from app.core.embedder import embed_text
from app.agents._subsidy_cache import get_cache, invalidate_and_recompute

router = APIRouter(prefix="/api/subsidies", tags=["subsidies"])

_BUCKET = "subsidy-forms"
_SHOW_WINDOW_DAYS = 7  # 시작까지 N일 이상 남은 미개시 공고는 숨김


def _is_visible(row: dict) -> bool:
    """날짜 필터 — 마감됐거나 시작까지 7일 초과이면 숨김."""
    today = date.today()
    end_raw = row.get("end_date")
    start_raw = row.get("start_date")
    is_ongoing = row.get("is_ongoing", False)

    if is_ongoing:
        return True

    if end_raw:
        try:
            if date.fromisoformat(end_raw) < today:
                return False
        except ValueError:
            pass

    if start_raw:
        try:
            if date.fromisoformat(start_raw) > today + timedelta(days=_SHOW_WINDOW_DAYS):
                return False
        except ValueError:
            pass

    return True


def _build_profile_query(profile: dict) -> str:
    """프로필 필드로 검색 쿼리 문자열 구성."""
    parts = ["소상공인 지원사업 창업"]
    if profile.get("business_type"):
        parts.append(profile["business_type"])
    if profile.get("location"):
        parts.append(profile["location"])
    if profile.get("business_stage"):
        parts.append(profile["business_stage"])
    return " ".join(parts)


def _search_subsidies_rpc(query: str, match_count: int = 30) -> list[dict]:
    """search_subsidy_programs RPC (vector+FTS RRF) → 상세 조회 (동기)."""
    embedding = embed_text(query)
    sb = get_supabase()
    try:
        result = sb.rpc(
            "search_subsidy_programs",
            {
                "query_embedding": embedding,
                "query_text": query,
                "match_count": match_count,
            },
        ).execute()
        rows = result.data or []
    except Exception:
        return []

    if not rows:
        return []

    row_ids = [r["row_id"] for r in rows]
    score_map = {r["row_id"]: r.get("score", 0.0) for r in rows}

    try:
        detail_result = (
            sb.table("subsidy_programs")
            .select(
                "id,title,organization,region,program_kind,sub_kind,target,"
                "start_date,end_date,period_raw,is_ongoing,description,"
                "detail_url,external_url,hashtags,form_files"
            )
            .in_("id", row_ids)
            .execute()
        )
        details = detail_result.data or []
    except Exception:
        return []

    for d in details:
        d["score"] = score_map.get(d["id"], 0.0)

    details.sort(key=lambda x: x["score"], reverse=True)
    return details


# ── GET /api/subsidies/cache ──────────────────────────────────────────────────

@router.get("/cache")
async def get_subsidy_cache(account_id: str = Query(...)):
    """캐시된 지원사업 추천 반환. is_computing=true 면 아직 계산 중."""
    cache = get_cache(account_id)
    return {
        "data": cache["results"],
        "is_computing": cache["is_computing"],
        "computed_at": cache["computed_at"],
        "error": None,
    }


class InvalidateRequest(BaseModel):
    account_id: str


@router.post("/cache/invalidate")
async def invalidate_subsidy_cache(req: InvalidateRequest):
    """프로필 변경 시 캐시 무효화 + 백그라운드 재계산 트리거."""
    await invalidate_and_recompute(req.account_id)
    return {"data": None, "error": None}


# ── GET /api/subsidies/matches ────────────────────────────────────────────────

@router.get("/matches")
async def get_matches(account_id: str = Query(...)):
    """프로필 + long-term memory 기반 top 5 맞춤 지원사업."""
    sb = get_supabase()

    profile_row = (
        sb.table("profiles")
        .select("business_type,location,business_stage,employees_count,primary_goal")
        .eq("id", account_id)
        .maybe_single()
        .execute()
    )
    profile = profile_row.data or {}

    memory_context = ""
    try:
        mem_rows = (
            sb.table("memory_long")
            .select("content")
            .eq("account_id", account_id)
            .order("created_at", desc=True)
            .limit(3)
            .execute()
        )
        if mem_rows.data:
            memory_context = " ".join(r["content"][:200] for r in mem_rows.data)
    except Exception:
        pass

    query = _build_profile_query(profile)
    if memory_context:
        query = f"{query} {memory_context}"

    rows = await asyncio.to_thread(_search_subsidies_rpc, query, 30)
    visible = [r for r in rows if _is_visible(r)][:5]

    return {"data": visible, "error": None, "meta": {"query": query}}


# ── GET /api/subsidies/search ─────────────────────────────────────────────────

@router.get("/search")
async def search_subsidies(
    q: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """전체 지원사업 검색. q 없으면 전체 목록 (날짜 필터 적용)."""
    if q.strip():
        rows = await asyncio.to_thread(_search_subsidies_rpc, q.strip(), limit + offset + 20)
        visible = [r for r in rows if _is_visible(r)]
        page = visible[offset: offset + limit]
        return {"data": page, "error": None, "meta": {"total": len(visible), "q": q}}

    sb = get_supabase()
    try:
        result = (
            sb.table("subsidy_programs")
            .select(
                "id,title,organization,region,program_kind,sub_kind,target,"
                "start_date,end_date,period_raw,is_ongoing,description,"
                "detail_url,external_url,hashtags,form_files"
            )
            .order("fetched_at", desc=True)
            .execute()
        )
        all_rows = result.data or []
    except Exception:
        all_rows = []

    visible = [r for r in all_rows if _is_visible(r)]
    page = visible[offset: offset + limit]

    return {
        "data": page,
        "error": None,
        "meta": {"total": len(visible), "q": ""},
    }
