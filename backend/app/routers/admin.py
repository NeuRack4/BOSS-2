"""Admin 전용 엔드포인트.

모든 엔드포인트는 `account_id` 쿼리 파라미터를 받고,
`_require_admin(account_id)` 로 is_admin 여부를 검증한다.
"""
from __future__ import annotations

import langsmith
import logging
from datetime import date, timedelta, timezone, datetime

from fastapi import APIRouter, HTTPException, Query
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin(account_id: str) -> None:
    """account_id의 profiles.is_admin이 true가 아니면 HTTP 403 발생."""
    sb = get_supabase()
    res = (
        sb.table("profiles")
        .select("is_admin")
        .eq("id", account_id)
        .single()
        .execute()
    )
    if not res.data or not res.data.get("is_admin"):
        raise HTTPException(status_code=403, detail="Forbidden")


@router.get("/users")
async def get_users(account_id: str = Query(...)):
    _require_admin(account_id)
    sb = get_supabase()

    profiles_res = (
        sb.table("profiles")
        .select("id,display_name,business_name,last_seen_at,created_at")
        .order("created_at", desc=True)
        .execute()
    )
    profiles = profiles_res.data or []

    auth_users = sb.auth.admin.list_users()
    email_map: dict[str, str] = {
        u.id: u.email for u in (auth_users if isinstance(auth_users, list) else getattr(auth_users, "users", []) or [])
    }

    subs_res = sb.table("subscriptions").select("account_id,plan,status").execute()
    sub_map: dict[str, dict] = {
        s["account_id"]: s for s in (subs_res.data or [])
    }

    result = []
    for p in profiles:
        uid = p["id"]
        sched_res = (
            sb.table("artifacts")
            .select("id,title,type,metadata")
            .eq("account_id", uid)
            .eq("kind", "artifact")
            .execute()
        )
        all_arts = sched_res.data or []
        active_schedules = [
            {
                "id": a["id"],
                "title": a["title"],
                "cron": a.get("metadata", {}).get("cron", ""),
                "schedule_enabled": True,
                "next_run": a.get("metadata", {}).get("next_run"),
            }
            for a in all_arts
            if a.get("metadata", {}).get("schedule_enabled")
        ]

        sub = sub_map.get(uid, {})
        result.append({
            "id": uid,
            "email": email_map.get(uid, ""),
            "display_name": p.get("display_name") or "",
            "business_name": p.get("business_name") or "",
            "plan": sub.get("plan", "free"),
            "subscription_status": sub.get("status", "active"),
            "last_seen_at": p.get("last_seen_at"),
            "created_at": p.get("created_at"),
            "active_schedule_count": len(active_schedules),
            "schedules": active_schedules,
        })

    return result


@router.get("/stats")
async def get_stats(account_id: str = Query(...)):
    _require_admin(account_id)
    sb = get_supabase()
    today = date.today().isoformat()

    profiles_res = sb.table("profiles").select("id", count="exact").execute()
    total_users = profiles_res.count or 0

    logs_res = (
        sb.table("activity_logs")
        .select("account_id")
        .gte("created_at", f"{today}T00:00:00+00:00")
        .execute()
    )
    dau_today = len({r["account_id"] for r in (logs_res.data or [])})

    agent_runs_res = (
        sb.table("activity_logs")
        .select("id", count="exact")
        .eq("type", "agent_run")
        .execute()
    )
    total_agent_runs = agent_runs_res.count or 0

    arts_res = sb.table("artifacts").select("metadata").eq("kind", "artifact").execute()
    active_schedules = sum(
        1 for a in (arts_res.data or [])
        if (a.get("metadata") or {}).get("schedule_enabled")
    )

    return {
        "total_users": total_users,
        "dau_today": dau_today,
        "total_agent_runs": total_agent_runs,
        "active_schedules": active_schedules,
    }


@router.get("/costs")
async def get_costs(account_id: str = Query(...), days: int = Query(30, ge=1, le=90)):
    _require_admin(account_id)

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    client = langsmith.Client()

    runs = client.list_runs(
        project_name="boss",
        run_type="chain",
        filter='eq(name, "orchestrator.run")',
        start_time=since,
    )

    aggregated: dict[str, dict] = {}
    for run in runs:
        uid = (run.inputs or {}).get("account_id")
        if not uid:
            continue
        if uid not in aggregated:
            aggregated[uid] = {
                "account_id": uid,
                "total_tokens": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_cost": 0.0,
                "run_count": 0,
            }
        agg = aggregated[uid]
        agg["total_tokens"] += run.total_tokens or 0
        agg["prompt_tokens"] += run.prompt_tokens or 0
        agg["completion_tokens"] += run.completion_tokens or 0
        agg["total_cost"] += float(run.total_cost or 0)
        agg["run_count"] += 1

    result = sorted(aggregated.values(), key=lambda x: x["total_cost"], reverse=True)
    return result


@router.get("/payments")
async def get_payments(account_id: str = Query(...)):
    _require_admin(account_id)
    sb = get_supabase()

    subs_res = sb.table("subscriptions").select(
        "account_id,plan,status,next_billing_date,started_at,cancelled_at"
    ).execute()
    rows = subs_res.data or []

    summary: dict[str, int] = {}
    for row in rows:
        plan = row.get("plan", "free")
        summary[plan] = summary.get(plan, 0) + 1

    return {"summary": summary, "rows": rows}
