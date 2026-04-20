from datetime import datetime, timezone

from croniter import croniter
from fastapi import APIRouter, HTTPException

from app.agents import orchestrator
from app.core.supabase import get_supabase
from app.scheduler.log_nodes import create_log_node
from app.models.schemas import (
    ScheduleCreateRequest,
    ScheduleResponse,
    ScheduleRunRequest,
    ScheduleStatusRequest,
    ScheduleUpdateRequest,
)

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


def _next_run_iso(cron_expr: str | None, base: datetime) -> str | None:
    if not cron_expr:
        return None
    try:
        itr = croniter(cron_expr, base)
        return itr.get_next(datetime).isoformat()
    except Exception:
        return None


@router.post("/{artifact_id}/run-now", response_model=ScheduleResponse)
async def run_now(artifact_id: str, req: ScheduleRunRequest):
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
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    if art.get("kind") != "schedule":
        raise HTTPException(status_code=400, detail="not a schedule node")

    sb.table("artifacts").update({"status": "running"}).eq("id", artifact_id).execute()

    now = datetime.now(timezone.utc)
    metadata = art.get("metadata") or {}
    try:
        reply = await orchestrator.run_scheduled(art, req.account_id)
    except Exception as e:
        sb.table("artifacts").update({"status": "failed"}).eq("id", artifact_id).execute()
        log_id = create_log_node(
            sb, art, status="failed", content=f"실행 실패: {str(e)[:200]}", executed_at=now
        )
        sb.table("task_logs").insert(
            {
                "account_id": req.account_id,
                "status": "failed",
                "result": {"artifact_id": artifact_id, "title": art.get("title"), "trigger": "run_now", "log_id": log_id},
                "error": str(e)[:2000],
            }
        ).execute()
        raise HTTPException(status_code=500, detail=f"execution failed: {e}")

    cron_expr = metadata.get("cron")
    next_run = _next_run_iso(cron_expr, now)
    new_metadata = {
        **metadata,
        "executed_at": now.isoformat(),
    }
    if next_run:
        new_metadata["next_run"] = next_run

    sb.table("artifacts").update(
        {"status": "active", "metadata": new_metadata}
    ).eq("id", artifact_id).execute()

    log_id = create_log_node(
        sb, art,
        status="success",
        content=f"수동 1회 실행 완료 — 응답 {len(reply or '')} 문자",
        executed_at=now,
    )

    sb.table("task_logs").insert(
        {
            "account_id": req.account_id,
            "status": "success",
            "result": {
                "artifact_id": artifact_id,
                "log_id": log_id,
                "title": art.get("title"),
                "trigger": "run_now",
                "reply_preview": (reply or "")[:500],
                "next_run": next_run,
            },
        }
    ).execute()

    sb.table("activity_logs").insert(
        {
            "account_id": req.account_id,
            "type": "schedule_run",
            "domain": (art.get("domains") or ["general"])[0],
            "title": art.get("title") or "scheduled run",
            "description": "수동 1회 실행",
            "metadata": {
                "artifact_id": artifact_id,
                "log_id": log_id,
                "status": "success",
                "trigger": "run_now",
                "reply_preview": (reply or "")[:200],
            },
        }
    ).execute()

    return ScheduleResponse(
        data={
            "ok": True,
            "executed_at": now.isoformat(),
            "next_run": next_run,
            "reply": reply,
        }
    )


@router.post("", response_model=ScheduleResponse)
async def create_schedule(req: ScheduleCreateRequest):
    """artifact에 자식으로 schedule 노드를 추가. artifact_edges.scheduled_by 관계 생성."""
    sb = get_supabase()
    parent_res = (
        sb.table("artifacts")
        .select("id,account_id,domains,title")
        .eq("id", req.artifact_id)
        .single()
        .execute()
    )
    parent = parent_res.data
    if not parent:
        raise HTTPException(status_code=404, detail="parent artifact not found")
    if parent.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    now = datetime.now(timezone.utc)
    next_run = _next_run_iso(req.cron, now)
    title = req.title or f"{parent.get('title') or 'schedule'} — 자동 실행"

    ins = (
        sb.table("artifacts")
        .insert(
            {
                "account_id": req.account_id,
                "domains": parent.get("domains") or [],
                "kind": "schedule",
                "type": "schedule",
                "title": title,
                "content": "",
                "status": "active",
                "metadata": {"cron": req.cron, "next_run": next_run},
            }
        )
        .execute()
    )
    schedule = (ins.data or [{}])[0]
    schedule_id = schedule.get("id")
    if not schedule_id:
        raise HTTPException(status_code=500, detail="failed to create schedule")

    sb.table("artifact_edges").insert(
        {
            "account_id": req.account_id,
            "parent_id":  req.artifact_id,
            "child_id":   schedule_id,
            "relation":   "scheduled_by",
        }
    ).execute()

    return ScheduleResponse(data={"ok": True, "id": schedule_id, "next_run": next_run})


@router.patch("/{artifact_id}", response_model=ScheduleResponse)
async def update_schedule(artifact_id: str, req: ScheduleUpdateRequest):
    """cron 표현식 수정 + next_run 재계산."""
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,kind,metadata")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    if art.get("kind") != "schedule":
        raise HTTPException(status_code=400, detail="not a schedule node")

    next_run = _next_run_iso(req.cron, datetime.now(timezone.utc))
    metadata = {**(art.get("metadata") or {}), "cron": req.cron}
    if next_run:
        metadata["next_run"] = next_run

    sb.table("artifacts").update({"metadata": metadata}).eq("id", artifact_id).execute()
    return ScheduleResponse(data={"ok": True, "cron": req.cron, "next_run": next_run})


@router.get("/{artifact_id}/history", response_model=ScheduleResponse)
async def schedule_history(artifact_id: str, account_id: str, limit: int = 20):
    """스케줄 실행 이력 — activity_logs(type=schedule_run)에서 metadata.artifact_id 매칭."""
    sb = get_supabase()
    res = (
        sb.table("activity_logs")
        .select("id,type,domain,title,description,metadata,created_at")
        .eq("account_id", account_id)
        .eq("type", "schedule_run")
        .order("created_at", desc=True)
        .limit(limit * 3)
        .execute()
    )
    logs = [
        r
        for r in (res.data or [])
        if (r.get("metadata") or {}).get("artifact_id") == artifact_id
    ][:limit]
    return ScheduleResponse(data={"logs": logs})


@router.patch("/{artifact_id}/status", response_model=ScheduleResponse)
async def update_status(artifact_id: str, req: ScheduleStatusRequest):
    if req.status not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'paused'")

    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,kind")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    if art.get("kind") != "schedule":
        raise HTTPException(status_code=400, detail="not a schedule node")

    sb.table("artifacts").update({"status": req.status}).eq("id", artifact_id).execute()

    return ScheduleResponse(data={"ok": True, "status": req.status})
