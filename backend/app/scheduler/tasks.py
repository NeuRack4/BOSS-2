"""Celery 태스크.

- `tick` — 60초마다 Beat 이 호출. 스캐너 결과를 읽어 실행 대상은 per-item 태스크로 fan-out,
  알림 대상은 tick 안에서 바로 activity_logs 에 insert.
- `run_schedule_artifact` — 단일 schedule artifact 실행. orchestrator.run_scheduled 를 호출.
- 실행 결과는 artifacts.status/metadata 갱신 + task_logs(성공/실패) + activity_logs(schedule_run).
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from croniter import croniter

from app.agents import orchestrator
from app.core.supabase import get_supabase
from app.scheduler.celery_app import celery_app
from app.scheduler.log_nodes import create_log_node
from app.scheduler.scanner import find_date_notifications, find_due_schedules

log = logging.getLogger(__name__)


def _next_run_iso(cron_expr: str | None, base: datetime) -> str | None:
    if not cron_expr:
        return None
    try:
        itr = croniter(cron_expr, base)
        return itr.get_next(datetime).isoformat()
    except Exception:
        return None


_NOTIFY_KIND_TEMPLATES: dict[str, tuple[str, str]] = {
    "start":    ("D-0 시작",       "오늘부터 시작되는 {label}입니다."),
    "start_d1": ("D-1 시작 하루 전", "내일부터 시작됩니다 — {label}."),
    "start_d3": ("D-3 시작 임박",   "3일 뒤 시작됩니다 — {label}."),
    "due_d0":   ("D-0 마감",       "오늘이 {label} 입니다."),
    "due_d1":   ("D-1 마감 하루 전", "내일이 {label} 입니다."),
    "due_d3":   ("D-3 마감 임박",   "3일 뒤 {label} 입니다."),
    "due_d7":   ("D-7 마감 일주일 전", "일주일 뒤 {label} 입니다."),
}


def _notify_kind_to_text(kind: str, due_label: str | None) -> tuple[str, str]:
    prefix, template = _NOTIFY_KIND_TEMPLATES.get(kind, ("알림", "{label}"))
    label = (due_label or "").strip()
    if not label:
        label = "마감" if kind.startswith("due") else "일정"
    return prefix, template.format(label=label)


@celery_app.task(name="app.scheduler.tasks.tick")
def tick() -> dict:
    """Beat가 60초마다 호출하는 스캐너."""
    now = datetime.now(timezone.utc)
    due = find_due_schedules(now=now)
    notifications = find_date_notifications(today=now.date())

    for art in due:
        run_schedule_artifact.delay(art["id"])

    sb = get_supabase()
    notif_count = 0
    for t in notifications:
        art = t["artifact"]
        art_meta = art.get("metadata") or {}
        due_label = art_meta.get("due_label")
        title_prefix, desc = _notify_kind_to_text(t["notify_kind"], due_label)
        try:
            sb.table("activity_logs").insert(
                {
                    "account_id": art["account_id"],
                    "type": "schedule_notify",
                    "domain": (art.get("domains") or ["general"])[0],
                    "title": f"[{title_prefix}] {art.get('title') or ''}",
                    "description": desc,
                    "metadata": {
                        "artifact_id": art["id"],
                        "notify_kind": t["notify_kind"],
                        "for_date": t["for_date"],
                        "due_label": due_label,
                    },
                }
            ).execute()
            notif_count += 1
        except Exception as e:
            log.exception("notify insert failed: %s", e)

    return {"dispatched": len(due), "notifications": notif_count, "ts": now.isoformat()}


@celery_app.task(name="app.scheduler.tasks.run_schedule_artifact", bind=True, max_retries=3)
def run_schedule_artifact(self, artifact_id: str) -> dict:
    """단일 schedule artifact 실행."""
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,domains,kind,type,title,content,status,metadata")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        return {"ok": False, "reason": "not_found"}
    meta = art.get("metadata") or {}
    if not meta.get("schedule_enabled"):
        return {"ok": False, "reason": "schedule_disabled"}
    if (meta.get("schedule_status") or "active") != "active":
        return {"ok": False, "reason": f"schedule_status={meta.get('schedule_status')}"}

    account_id = art["account_id"]
    metadata = meta
    cron_expr = metadata.get("cron")

    # 실행 중에는 metadata 토글로 판정 — artifact.status 는 건드리지 않음
    # (사용자가 설정한 kind='artifact' 의 업무 상태를 보존)
    now = datetime.now(timezone.utc)

    try:
        reply = asyncio.run(orchestrator.run_scheduled(art, account_id))
    except Exception as e:
        log.exception("schedule execution failed: %s", e)
        # 실행 실패는 metadata 에 기록 (artifact.status 는 사용자 업무 상태)
        sb.table("artifacts").update(
            {"metadata": {**metadata, "last_run_status": "failed", "last_error": str(e)[:500]}}
        ).eq("id", artifact_id).execute()
        log_id = create_log_node(
            sb, art, status="failed", content=f"실행 실패: {str(e)[:200]}", executed_at=now
        )
        sb.table("task_logs").insert(
            {
                "account_id": account_id,
                "status": "failed",
                "result": {"artifact_id": artifact_id, "title": art.get("title"), "log_id": log_id},
                "error": str(e)[:2000],
            }
        ).execute()
        sb.table("activity_logs").insert(
            {
                "account_id": account_id,
                "type": "schedule_run",
                "domain": (art.get("domains") or ["general"])[0],
                "title": art.get("title") or "scheduled run",
                "description": f"실행 실패: {str(e)[:200]}",
                "metadata": {"artifact_id": artifact_id, "log_id": log_id, "status": "failed"},
            }
        ).execute()
        return {"ok": False, "error": str(e)[:500]}

    next_run = _next_run_iso(cron_expr, now)
    new_metadata = {**metadata, "executed_at": now.isoformat(), "last_run_status": "success"}
    if next_run:
        new_metadata["next_run"] = next_run

    sb.table("artifacts").update(
        {"metadata": new_metadata}
    ).eq("id", artifact_id).execute()

    log_id = create_log_node(
        sb,
        art,
        status="success",
        content=f"자동 실행 완료 — 응답 {len(reply or '')} 문자",
        executed_at=now,
    )

    sb.table("task_logs").insert(
        {
            "account_id": account_id,
            "status": "success",
            "result": {
                "artifact_id": artifact_id,
                "log_id": log_id,
                "title": art.get("title"),
                "reply_preview": (reply or "")[:500],
                "next_run": next_run,
            },
        }
    ).execute()

    sb.table("activity_logs").insert(
        {
            "account_id": account_id,
            "type": "schedule_run",
            "domain": (art.get("domains") or ["general"])[0],
            "title": art.get("title") or "scheduled run",
            "description": "자동 실행 완료",
            "metadata": {
                "artifact_id": artifact_id,
                "log_id": log_id,
                "status": "success",
                "reply_preview": (reply or "")[:200],
                "next_run": next_run,
            },
        }
    ).execute()

    return {"ok": True, "artifact_id": artifact_id, "log_id": log_id, "next_run": next_run}


# ──────────────────────────────────────────────────────────────────────────
# Memory 유지보수 — 7일 이전 memory_long 레코드 매일 00:00 KST 삭제
# ──────────────────────────────────────────────────────────────────────────
@celery_app.task(name="app.scheduler.tasks.cleanup_old_memories")
def cleanup_old_memories() -> dict:
    """7일 이전 memory_long rows DELETE (KST 기준 자정 beat schedule).

    v1.3: 장기기억 retention 정책. created_at 은 UTC 로 저장되지만 비교는 절대시간이라 문제 없음.
    """
    sb = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        res = sb.table("memory_long").delete().lt("created_at", cutoff).execute()
        deleted = len(res.data or [])
    except Exception as exc:
        log.warning("[cleanup_old_memories] failed: %s", exc)
        return {"deleted": 0, "error": str(exc)}
    log.info("[cleanup_old_memories] deleted %d rows older than %s", deleted, cutoff)
    return {"deleted": deleted, "cutoff": cutoff}
