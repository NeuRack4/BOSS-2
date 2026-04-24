"""지원사업 추천 캐시 — 계정별 24h TTL."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)

_CACHE_TTL_HOURS = 24
_STUCK_TIMEOUT_MINUTES = 10  # is_computing=true 인데 이 시간 지나면 재계산 허용


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _get_cache_row(account_id: str) -> dict | None:
    sb = get_supabase()
    try:
        res = (
            sb.table("subsidy_cache")
            .select("account_id, results, computed_at, is_computing")
            .eq("account_id", account_id)
            .maybe_single()
            .execute()
        )
        return res.data
    except Exception:
        return None


def _is_stale(row: dict | None) -> bool:
    if not row:
        return True
    computed_at_str = row.get("computed_at")
    if not computed_at_str:
        return True
    try:
        computed_at = datetime.fromisoformat(computed_at_str.replace("Z", "+00:00"))
        if computed_at.tzinfo is None:
            computed_at = computed_at.replace(tzinfo=timezone.utc)
        return _now_utc() - computed_at > timedelta(hours=_CACHE_TTL_HOURS)
    except Exception:
        return True


def _is_stuck(row: dict | None) -> bool:
    """is_computing=true 인데 너무 오래된 경우."""
    if not row or not row.get("is_computing"):
        return False
    computed_at_str = row.get("computed_at")
    if not computed_at_str:
        return True
    try:
        computed_at = datetime.fromisoformat(computed_at_str.replace("Z", "+00:00"))
        if computed_at.tzinfo is None:
            computed_at = computed_at.replace(tzinfo=timezone.utc)
        return _now_utc() - computed_at > timedelta(minutes=_STUCK_TIMEOUT_MINUTES)
    except Exception:
        return True


def _mark_computing(account_id: str) -> None:
    sb = get_supabase()
    now_iso = _now_utc().isoformat()
    sb.table("subsidy_cache").upsert(
        {
            "account_id": account_id,
            "is_computing": True,
            "computed_at": now_iso,
        },
        on_conflict="account_id",
    ).execute()


def _store_results(account_id: str, results: list) -> None:
    sb = get_supabase()
    now_iso = _now_utc().isoformat()
    sb.table("subsidy_cache").upsert(
        {
            "account_id": account_id,
            "results": results,
            "computed_at": now_iso,
            "is_computing": False,
        },
        on_conflict="account_id",
    ).execute()


async def _compute(account_id: str) -> None:
    """실제 검색 수행 후 캐시에 저장."""
    from app.routers.subsidies import _build_profile_query, _search_subsidies_rpc, _is_visible
    from app.core.supabase import get_supabase as _sb

    sb = _sb()
    try:
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
        _store_results(account_id, visible)
        logger.info("[subsidy_cache] computed %d results for %s", len(visible), account_id)
    except Exception as e:
        logger.error("[subsidy_cache] compute failed for %s: %s", account_id, e)
        _store_results(account_id, [])


async def maybe_refresh(account_id: str) -> None:
    """캐시가 없거나 만료됐으면 백그라운드 재계산 트리거."""
    row = _get_cache_row(account_id)
    needs_refresh = _is_stale(row) or _is_stuck(row)
    if not needs_refresh:
        return
    # 이미 계산 중이고 stuck 아니면 스킵
    if row and row.get("is_computing") and not _is_stuck(row):
        return
    _mark_computing(account_id)
    asyncio.create_task(_compute(account_id))


async def invalidate_and_recompute(account_id: str) -> None:
    """프로필 변경 시 즉시 무효화 후 재계산."""
    _mark_computing(account_id)
    asyncio.create_task(_compute(account_id))


def get_cache(account_id: str) -> dict:
    """캐시 row 반환. row 없으면 빈 결과 반환 (is_computing=False).
    실제 계산 트리거는 maybe_refresh() 가 담당."""
    row = _get_cache_row(account_id)
    if not row:
        return {"results": [], "is_computing": False, "computed_at": None}
    return {
        "results": row.get("results") or [],
        "is_computing": bool(row.get("is_computing")),
        "computed_at": row.get("computed_at"),
    }
