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
import httpx
import pytz
from openai import OpenAI
from app.core.config import settings

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


@celery_app.task(name="app.scheduler.tasks.scan_comments")
def scan_comments() -> dict:
    """1시간마다 YouTube 댓글 자동 수집."""
    from app.core.supabase import get_supabase

    sb = get_supabase()
    # YouTube 연결된 모든 계정 조회
    res = sb.table("youtube_oauth_tokens").select("account_id").execute()
    accounts = [row["account_id"] for row in (res.data or [])]

    total_new = 0
    for account_id in accounts:
        try:
            result = asyncio.run(
                __import__(
                    "app.services.comment_manager",
                    fromlist=["scan_and_store"],
                ).scan_and_store(account_id, ["youtube"])
            )
            total_new += result.get("new", 0)
            log.info("[comment-scan] account=%s new=%d", account_id, result.get("new", 0))
        except Exception as e:
            log.warning("[comment-scan] account=%s error: %s", account_id, e)

    return {"accounts": len(accounts), "new_comments": total_new}


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


# ──────────────────────────────────────────────────────────────────────────
# 월정액 자동 청구 — 매일 09:00 KST, next_billing_date 도래 구독 청구
# ──────────────────────────────────────────────────────────────────────────
@celery_app.task(name="app.scheduler.tasks.charge_subscriptions")
def charge_subscriptions() -> dict:
    """next_billing_date 가 지난 active 구독 월정액 자동 청구."""
    from app.services.payment import run_monthly_billing
    result = asyncio.run(run_monthly_billing())
    log.info("[charge_subscriptions] %s", result)
    return result


# ── Sales Slack 알림 ─────────────────────────────────────────────────────────

def _send_slack_dm(bot_token: str, slack_user_id: str, text: str) -> None:
    """봇 토큰으로 사용자에게 Slack DM 전송."""
    with httpx.Client() as client:
        # DM 채널 열기
        open_resp = client.post(
            "https://slack.com/api/conversations.open",
            headers={"Authorization": f"Bearer {bot_token}"},
            json={"users": slack_user_id},
        )
        channel_id = open_resp.json().get("channel", {}).get("id")
        if not channel_id:
            return
        # 메세지 전송
        client.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {bot_token}"},
            json={"channel": channel_id, "text": text},
        )


def _ai_sales_comment(today_total: int, yesterday_total: int) -> str:
    """GPT-4o-mini로 매출 비교 한줄 코멘트 생성."""
    diff_pct = (
        round((today_total - yesterday_total) / yesterday_total * 100, 1)
        if yesterday_total > 0 else 0
    )
    direction = "상승" if diff_pct >= 0 else "하락"
    prompt = (
        f"소상공인 사장님의 오늘 매출은 {today_total:,}원이고 "
        f"어제 대비 {abs(diff_pct)}% {direction}했습니다. "
        f"친근하고 간결하게 한 문장으로 격려 또는 조언을 해주세요."
    )
    ai_client = OpenAI(api_key=settings.openai_api_key)
    resp = ai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=80,
    )
    return resp.choices[0].message.content.strip()


@celery_app.task(name="app.scheduler.tasks.sales_slack_notify")
def sales_slack_notify() -> dict:
    """매시 정각 실행 — 설정 시각인 유저에게 Slack DM 전송."""
    kst = pytz.timezone("Asia/Seoul")
    now_kst = datetime.now(timezone.utc).astimezone(kst)
    current_hour = now_kst.hour
    today_str = now_kst.strftime("%Y-%m-%d")
    yesterday_str = (now_kst - timedelta(days=1)).strftime("%Y-%m-%d")

    sb = get_supabase()

    settings_res = (
        sb.table("notification_settings")
        .select("account_id")
        .eq("notify_enabled", True)
        .eq("notify_hour", current_hour)
        .execute()
    )
    account_ids = [r["account_id"] for r in (settings_res.data or [])]
    if not account_ids:
        return {"sent": 0, "hour": current_hour}

    sent = 0
    for account_id in account_ids:
        slack_res = (
            sb.table("slack_connections")
            .select("access_token,slack_user_id")
            .eq("account_id", account_id)
            .limit(1)
            .execute()
        )
        if not slack_res.data:
            continue
        bot_token = slack_res.data[0]["access_token"]
        slack_user_id = slack_res.data[0]["slack_user_id"]

        today_res = (
            sb.table("sales_records")
            .select("amount")
            .eq("account_id", account_id)
            .eq("recorded_date", today_str)
            .execute()
        )
        today_entries = today_res.data or []

        try:
            if not today_entries:
                msg = (
                    "📊 *BOSS 알림*\n"
                    "오늘 매출을 아직 입력하지 않으셨어요.\n"
                    f"지금 기록해보세요 → {settings.boss_frontend_url}"
                )
            else:
                today_total = sum(e["amount"] for e in today_entries)
                yesterday_res = (
                    sb.table("sales_records")
                    .select("amount")
                    .eq("account_id", account_id)
                    .eq("recorded_date", yesterday_str)
                    .execute()
                )
                yesterday_total = sum(e["amount"] for e in (yesterday_res.data or []))
                diff_pct = (
                    round((today_total - yesterday_total) / yesterday_total * 100, 1)
                    if yesterday_total > 0 else 0
                )
                arrow = "↑" if diff_pct >= 0 else "↓"
                ai_comment = _ai_sales_comment(today_total, yesterday_total)
                msg = (
                    "📈 *오늘의 매출 리포트*\n"
                    f"오늘: {today_total:,}원 (어제 대비 {diff_pct:+.1f}% {arrow})\n"
                    f"AI 분석: {ai_comment}"
                )
            _send_slack_dm(bot_token, slack_user_id, msg)
            sent += 1
        except Exception as e:
            log.warning("[sales_slack_notify] account=%s error=%s", account_id, e)

    return {"sent": sent, "hour": current_hour}
