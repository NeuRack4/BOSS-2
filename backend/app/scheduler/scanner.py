"""스케쥴러 tick이 DB를 스캔해서 실행/알림 대상을 추려주는 헬퍼.

두 가지 카테고리:
1. `metadata.schedule_enabled = true` + `metadata.schedule_status='active'` (기본 active) +
   `metadata.next_run <= now` → 실행 대상.
   v0.10 부터 `kind='schedule'` 별도 노드 대신 일반 artifact 의 metadata 토글로 판정.
2. 일회성 artifact (`kind='artifact'`) 의 start_date/due_date(= end_date fallback) 기준
   D-7 / D-3 / D-1 / D-0 (+start 와 start_d3 / start_d1) 알림 대상.
   중복 방지는 activity_logs 에서 같은 (artifact_id, notify_kind, for_date) 튜플 체크.

notify_kind 규약:
  start        start_date == today
  start_d1     start_date == today+1
  start_d3     start_date == today+3
  due_d0       due_date == today
  due_d1       due_date == today+1
  due_d3       due_date == today+3
  due_d7       due_date == today+7
"""

from datetime import date, datetime, timedelta, timezone

from app.core.supabase import get_supabase


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def find_due_schedules(now: datetime | None = None, limit: int = 500) -> list[dict]:
    """실행해야 할 artifact (metadata.schedule_enabled=true) 를 반환."""
    sb = get_supabase()
    now = now or datetime.now(timezone.utc)

    res = (
        sb.table("artifacts")
        .select("id,account_id,domains,kind,type,title,content,status,metadata")
        .eq("kind", "artifact")
        .eq("metadata->>schedule_enabled", "true")
        .limit(limit)
        .execute()
    )
    due: list[dict] = []
    for row in res.data or []:
        meta = row.get("metadata") or {}
        # paused 상태면 스킵 (기본 active)
        if (meta.get("schedule_status") or "active") != "active":
            continue
        next_run = _parse_iso(meta.get("next_run"))
        if next_run is None:
            continue
        if next_run <= now:
            due.append(row)
    return due


_START_OFFSETS = {0: "start", 1: "start_d1", 3: "start_d3"}
_DUE_OFFSETS = {0: "due_d0", 1: "due_d1", 3: "due_d3", 7: "due_d7"}


def find_date_notifications(today: date | None = None, limit: int = 1000) -> list[dict]:
    """오늘 알림을 쏴야 하는 일회성 artifact 들.

    반환 항목: {artifact, notify_kind, for_date}
    """
    sb = get_supabase()
    today = today or datetime.now(timezone.utc).date()
    today_iso = today.isoformat()

    res = (
        sb.table("artifacts")
        .select("id,account_id,domains,kind,type,title,content,status,metadata")
        .eq("kind", "artifact")
        .in_("status", ["active", "running", "draft"])
        .limit(limit)
        .execute()
    )

    targets: list[dict] = []
    for row in res.data or []:
        meta = row.get("metadata") or {}
        start = meta.get("start_date")
        due = meta.get("due_date") or meta.get("end_date")

        for offset, kind in _START_OFFSETS.items():
            if start and start == (today + timedelta(days=offset)).isoformat():
                targets.append({"artifact": row, "notify_kind": kind, "for_date": today_iso})
        for offset, kind in _DUE_OFFSETS.items():
            if due and due == (today + timedelta(days=offset)).isoformat():
                targets.append({"artifact": row, "notify_kind": kind, "for_date": today_iso})

    if not targets:
        return []

    account_ids = list({t["artifact"]["account_id"] for t in targets})
    start_of_day = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc).isoformat()

    already = (
        sb.table("activity_logs")
        .select("metadata,created_at")
        .in_("account_id", account_ids)
        .eq("type", "schedule_notify")
        .gte("created_at", start_of_day)
        .execute()
    )
    seen: set[tuple[str, str, str]] = set()
    for row in already.data or []:
        m = row.get("metadata") or {}
        aid, kind, fd = m.get("artifact_id"), m.get("notify_kind"), m.get("for_date")
        if aid and kind and fd:
            seen.add((aid, kind, fd))

    return [t for t in targets if (t["artifact"]["id"], t["notify_kind"], t["for_date"]) not in seen]
