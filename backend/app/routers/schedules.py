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
    metadata = art.get("metadata") or {}
    if not metadata.get("schedule_enabled"):
        raise HTTPException(status_code=400, detail="schedule not enabled on this artifact")

    now = datetime.now(timezone.utc)
    try:
        reply = await orchestrator.run_scheduled(art, req.account_id)
    except Exception as e:
        sb.table("artifacts").update(
            {"metadata": {**metadata, "last_run_status": "failed", "last_error": str(e)[:500]}}
        ).eq("id", artifact_id).execute()
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
        "last_run_status": "success",
    }
    if next_run:
        new_metadata["next_run"] = next_run

    sb.table("artifacts").update({"metadata": new_metadata}).eq("id", artifact_id).execute()

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
    """대상 artifact 에 schedule 토글을 켠다 (v0.10 — 별도 노드를 만들지 않음)."""
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,metadata")
        .eq("id", req.artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    now = datetime.now(timezone.utc)
    next_run = _next_run_iso(req.cron, now)
    metadata = {
        **(art.get("metadata") or {}),
        "schedule_enabled": True,
        "schedule_status":  "active",
        "cron":             req.cron,
    }
    if next_run:
        metadata["next_run"] = next_run

    sb.table("artifacts").update({"metadata": metadata}).eq("id", req.artifact_id).execute()
    return ScheduleResponse(data={"ok": True, "id": req.artifact_id, "next_run": next_run})


@router.patch("/{artifact_id}", response_model=ScheduleResponse)
async def update_schedule(artifact_id: str, req: ScheduleUpdateRequest):
    """cron 표현식 수정 + next_run 재계산 (metadata.schedule_enabled=true 전제)."""
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,metadata")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    meta = art.get("metadata") or {}
    if not meta.get("schedule_enabled"):
        raise HTTPException(status_code=400, detail="schedule not enabled on this artifact")

    next_run = _next_run_iso(req.cron, datetime.now(timezone.utc))
    metadata = {**meta, "cron": req.cron}
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
    """metadata.schedule_status 를 active/paused 로 토글."""
    if req.status not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'paused'")

    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,metadata")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    meta = art.get("metadata") or {}
    if not meta.get("schedule_enabled"):
        raise HTTPException(status_code=400, detail="schedule not enabled on this artifact")

    metadata = {**meta, "schedule_status": req.status}
    sb.table("artifacts").update({"metadata": metadata}).eq("id", artifact_id).execute()

    return ScheduleResponse(data={"ok": True, "status": req.status})
