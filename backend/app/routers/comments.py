"""댓글 관리 API 라우터.

GET    /api/comments            — 댓글 목록 조회
POST   /api/comments/scan       — 수동 스캔 트리거
POST   /api/comments/{id}/post  — AI 답글 게시
POST   /api/comments/{id}/ignore — 댓글 무시
PATCH  /api/comments/{id}/reply — 답글 내용 수정
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.supabase import get_supabase

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/comments", tags=["comments"])


# ── 목록 조회 ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_comments(
    account_id: str = Query(...),
    status: str = Query("pending"),
    limit: int = Query(50),
):
    """댓글 큐 목록 반환. status = pending | posted | ignored | all"""
    sb = get_supabase()
    q = (
        sb.table("comment_queue")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if status != "all":
        q = q.eq("status", status)
    res = q.execute()
    return {"data": res.data or [], "error": None}


# ── 수동 스캔 ─────────────────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    account_id: str
    platforms: list[str] = ["youtube", "instagram"]


@router.post("/scan")
async def scan_comments(req: ScanRequest):
    """YouTube + Instagram 댓글 수동 수집."""
    from app.services.comment_manager import scan_and_store
    result = await scan_and_store(req.account_id, req.platforms)
    return {"data": result, "error": None}


# ── 답글 게시 ─────────────────────────────────────────────────────────────────

@router.post("/{comment_id}/post")
async def post_reply(comment_id: str, account_id: str = Query(...)):
    """AI 답글을 실제 플랫폼에 게시."""
    from app.services.comment_manager import post_youtube_reply, post_instagram_reply

    sb = get_supabase()
    res = (
        sb.table("comment_queue")
        .select("*")
        .eq("id", comment_id)
        .eq("account_id", account_id)
        .single()
        .execute()
    )
    row = res.data
    if not row:
        raise HTTPException(status_code=404, detail="댓글을 찾을 수 없습니다.")
    if row["status"] == "posted":
        raise HTTPException(status_code=400, detail="이미 게시된 답글입니다.")

    try:
        if row["platform"] == "youtube":
            await post_youtube_reply(account_id, row["comment_id"], row["ai_reply"])
        else:
            await post_instagram_reply(account_id, row["comment_id"], row["ai_reply"])
    except Exception as e:
        log.exception("reply post failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e)[:300])

    now = datetime.now(timezone.utc).isoformat()
    sb.table("comment_queue").update({
        "status":    "posted",
        "posted_at": now,
    }).eq("id", comment_id).execute()

    return {"data": {"posted": True}, "error": None}


# ── 댓글 무시 ─────────────────────────────────────────────────────────────────

@router.post("/{comment_id}/ignore")
async def ignore_comment(comment_id: str, account_id: str = Query(...)):
    """댓글을 무시 처리."""
    sb = get_supabase()
    sb.table("comment_queue").update({"status": "ignored"}) \
        .eq("id", comment_id) \
        .eq("account_id", account_id) \
        .execute()
    return {"data": {"ignored": True}, "error": None}


# ── 답글 내용 수정 ────────────────────────────────────────────────────────────

class ReplyEditRequest(BaseModel):
    account_id: str
    ai_reply: str


@router.patch("/{comment_id}/reply")
async def edit_reply(comment_id: str, req: ReplyEditRequest):
    """AI 답글 내용을 사용자가 수정."""
    sb = get_supabase()
    sb.table("comment_queue").update({"ai_reply": req.ai_reply}) \
        .eq("id", comment_id) \
        .eq("account_id", req.account_id) \
        .execute()
    return {"data": {"updated": True}, "error": None}
