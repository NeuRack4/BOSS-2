from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

DOMAINS = ("recruitment", "marketing", "sales", "documents")


@router.get("/summary")
async def dashboard_summary(account_id: str = Query(...)):
    """Bento 대시보드용 경량 요약 — 도메인별 카운트 + 임박 일정 + 최근 활동."""
    sb = get_supabase()
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    today_plus_7 = (now + timedelta(days=7)).date().isoformat()
    seven_days_ago = (now - timedelta(days=7)).isoformat()

    arts = (
        sb.table("artifacts")
        .select("id,kind,type,title,status,domains,metadata,created_at")
        .eq("account_id", account_id)
        .neq("kind", "anchor")
        .neq("kind", "domain")
        .order("created_at", desc=True)
        .limit(400)
        .execute()
    ).data or []

    domains_stats: dict[str, dict] = {}
    for d in DOMAINS:
        in_domain = [a for a in arts if d in (a.get("domains") or [])]

        # Active — schedule 이 켜진 아이템만. artifact.status 가 아니라
        # metadata.schedule_enabled 기준 (schedule_status 가 paused 면 제외).
        active = []
        for a in in_domain:
            md = a.get("metadata") or {}
            if not md.get("schedule_enabled"):
                continue
            if (md.get("schedule_status") or "active") == "active":
                active.append(a)

        # Due — 기간 필드(start_date / end_date / due_date) 가 하나라도 있으면서
        # 아직 지나지 않은 (미래 포함) 아이템.
        upcoming = []
        for a in in_domain:
            md = a.get("metadata") or {}
            due_like = md.get("due_date") or md.get("end_date") or md.get("start_date")
            if not due_like:
                continue
            if str(due_like) >= today:
                upcoming.append(a)

        # Recent — 최근 7일 이내 생성된 일반 artifact.
        recent = [
            a for a in in_domain
            if a.get("kind") == "artifact"
            and a.get("type") != "archive"
            and (a.get("created_at") or "") >= seven_days_ago
        ]
        recent_titles = [
            {"id": a["id"], "title": a.get("title") or "(제목 없음)"}
            for a in in_domain
            if a.get("kind") == "artifact" and a.get("type") != "archive"
        ][:5]
        domains_stats[d] = {
            "active_count": len(active),
            "upcoming_count": len(upcoming),
            "recent_count": len(recent),
            "total_count": len(in_domain),
            "recent_titles": recent_titles,
        }

    schedule_items: list[dict] = []
    for a in arts:
        md = a.get("metadata") or {}
        due = md.get("due_date") or md.get("end_date")
        start = md.get("start_date")
        domain = (a.get("domains") or [None])[0]
        if due:
            schedule_items.append({
                "id": a["id"],
                "title": a.get("title") or "(제목 없음)",
                "domain": domain,
                "date": str(due),
                "kind": "due",
                "label": md.get("due_label") or "마감",
            })
        elif start:
            schedule_items.append({
                "id": a["id"],
                "title": a.get("title") or "(제목 없음)",
                "domain": domain,
                "date": str(start),
                "kind": "start",
                "label": "시작",
            })
    schedule_items.sort(key=lambda x: x["date"])
    upcoming_items = [x for x in schedule_items if x["date"] >= today][:8]

    logs = (
        sb.table("activity_logs")
        .select("type,domain,title,description,created_at,metadata")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    ).data or []

    return {
        "data": {
            "domains": domains_stats,
            "upcoming": upcoming_items,
            "recent_activity": logs,
        }
    }
