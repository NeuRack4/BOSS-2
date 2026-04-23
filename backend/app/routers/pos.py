"""Square POS 연동 API

엔드포인트:
  GET  /api/pos/square/locations          — 매장 위치 목록
  POST /api/pos/square/sync               — 기간별 주문 동기화 → sales_records
  GET  /api/pos/square/oauth/callback     — OAuth 콜백 (준비 중)
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(prefix="/api/pos", tags=["pos"])


# ── GET /api/pos/square/locations ─────────────────────────────────────────────

@router.get("/square/locations")
async def square_locations():
    """Square 매장 위치 목록 반환."""
    if not settings.square_access_token:
        raise HTTPException(status_code=503, detail="Square Access Token이 설정되지 않았어요.")
    from app.agents._sales._pos import get_locations
    try:
        locations = await get_locations()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Square API 오류: {e}")
    return {"data": {"locations": locations}, "error": None, "meta": {}}


# ── POST /api/pos/square/sync ─────────────────────────────────────────────────

class SyncRequest(BaseModel):
    account_id: str
    location_id: str
    start_date: str = ""   # YYYY-MM-DD, 기본 오늘
    end_date: str   = ""   # YYYY-MM-DD, 기본 오늘


@router.post("/square/sync")
async def square_sync(req: SyncRequest):
    """Square 주문 → sales_records 동기화."""
    if not settings.square_access_token:
        raise HTTPException(status_code=503, detail="Square Access Token이 설정되지 않았어요.")

    today      = date.today()
    start_date = date.fromisoformat(req.start_date) if req.start_date else today
    end_date   = date.fromisoformat(req.end_date)   if req.end_date   else today

    from app.agents._sales._pos import sync_pos_to_sales
    try:
        result = await sync_pos_to_sales(
            account_id=req.account_id,
            location_id=req.location_id,
            start_date=start_date,
            end_date=end_date,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"동기화 실패: {e}")

    return {"data": result, "error": None, "meta": {}}


# ── GET /api/pos/square/oauth/callback ────────────────────────────────────────

@router.get("/square/oauth/callback")
async def square_oauth_callback(
    code:  str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
):
    """Square OAuth 콜백 — 추후 구현 예정."""
    if error:
        return {"status": "error", "detail": error}
    # TODO: code → access_token 교환 후 profiles.profile_meta에 저장
    return {"status": "준비 중", "code": code[:10] + "..." if code else ""}
