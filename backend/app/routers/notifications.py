"""알림 설정 라우터

GET  /api/notifications/settings — 알림 설정 조회
POST /api/notifications/settings — 알림 설정 저장 (upsert)
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationSettingsIn(BaseModel):
    account_id: str
    notify_enabled: bool
    notify_hour: int  # 0~23 KST


@router.get("/settings")
def get_settings(account_id: str = Query(...)):
    sb = get_supabase()
    res = (
        sb.table("notification_settings")
        .select("notify_enabled,notify_hour")
        .eq("account_id", account_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return {"data": res.data[0]}
    return {"data": {"notify_enabled": True, "notify_hour": 21}}


@router.post("/settings")
def save_settings(req: NotificationSettingsIn):
    sb = get_supabase()
    sb.table("notification_settings").upsert({
        "account_id": req.account_id,
        "notify_enabled": req.notify_enabled,
        "notify_hour": req.notify_hour,
        "updated_at": "now()",
    }, on_conflict="account_id").execute()
    return {"ok": True}
