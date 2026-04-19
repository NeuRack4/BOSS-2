"""도메인 에이전트 공용 `suggest_today` 헬퍼.

각 도메인 에이전트는 이 함수를 자신의 도메인 이름으로 호출해서
오늘 사용자에게 추천할 만한 액션 목록을 반환한다.

반환 포맷: list[{title, reason, artifact_id?}]
- 기간/마감 임박 artifact
- 오늘 실행 예정 schedule
- 최근 실패한 schedule 재시도 제안
를 도메인별로 섞어 최대 3개까지 반환.
"""

from datetime import date, datetime, timedelta, timezone

from app.core.supabase import get_supabase


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def suggest_today_for_domain(account_id: str, domain: str, limit: int = 3) -> list[dict]:
    sb = get_supabase()
    today = _today_utc()
    soon = today + timedelta(days=3)
    today_iso = today.isoformat()
    soon_iso = soon.isoformat()

    suggestions: list[dict] = []

    # 1) 기간/마감 임박 artifact — due_date 또는 end_date 가 오늘~+3일 이내
    artifact_rows = (
        sb.table("artifacts")
        .select("id,title,metadata,domains,status")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .contains("domains", [domain])
        .in_("status", ["active", "running", "draft"])
        .limit(50)
        .execute()
        .data
        or []
    )
    for row in artifact_rows:
        meta = row.get("metadata") or {}
        due = meta.get("due_date") or meta.get("end_date")
        start = meta.get("start_date")
        if due and today_iso <= due <= soon_iso:
            days_left = (date.fromisoformat(due) - today).days
            label = "오늘 마감" if days_left == 0 else f"마감 {days_left}일 전"
            suggestions.append({
                "title": row.get("title") or "(제목 없음)",
                "reason": f"{label} — 확인/마무리 필요",
                "artifact_id": row["id"],
            })
        elif start and start == today_iso:
            suggestions.append({
                "title": row.get("title") or "(제목 없음)",
                "reason": "오늘 시작 — 착수 체크",
                "artifact_id": row["id"],
            })

    # 2) 오늘~내일 실행 예정 schedule
    schedule_rows = (
        sb.table("artifacts")
        .select("id,title,metadata,domains,status")
        .eq("account_id", account_id)
        .eq("kind", "schedule")
        .eq("status", "active")
        .contains("domains", [domain])
        .limit(50)
        .execute()
        .data
        or []
    )
    horizon = datetime.now(timezone.utc) + timedelta(days=1)
    for row in schedule_rows:
        meta = row.get("metadata") or {}
        nxt = meta.get("next_run")
        if not nxt:
            continue
        try:
            nxt_dt = datetime.fromisoformat(nxt.replace("Z", "+00:00"))
            if nxt_dt.tzinfo is None:
                nxt_dt = nxt_dt.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if nxt_dt <= horizon:
            suggestions.append({
                "title": row.get("title") or "(제목 없음)",
                "reason": f"예정 실행 {nxt_dt.strftime('%m-%d %H:%M')} — 결과 검토 예정",
                "artifact_id": row["id"],
            })

    # 상위 limit 만
    return suggestions[:limit]
