"""Instagram DM 캠페인 CRUD + 수동 스캔 API.

GET    /api/dm-campaigns             — 캠페인 목록
POST   /api/dm-campaigns             — 캠페인 생성
PATCH  /api/dm-campaigns/{id}        — 캠페인 수정 (키워드/템플릿/활성화)
DELETE /api/dm-campaigns/{id}        — 캠페인 삭제
POST   /api/dm-campaigns/scan        — 수동 스캔 & DM 발송
GET    /api/dm-campaigns/{id}/sent   — 발송 이력 조회
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from app.core.supabase import get_supabase

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dm-campaigns", tags=["dm-campaigns"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _extract_post_id(post_url_or_id: str) -> str:
    """인스타그램 게시물 URL 또는 숫자 ID에서 미디어 ID 추출.

    URL 형식: https://www.instagram.com/p/<shortcode>/
    Meta API 미디어 ID 는 숫자 문자열 — 숫자면 그대로 사용.
    URL shortcode 는 직접 조회가 필요하므로 현재는 숫자 ID 만 허용.
    """
    # 이미 숫자 ID 면 그대로
    if re.fullmatch(r"\d+", post_url_or_id.strip()):
        return post_url_or_id.strip()
    # URL 에서 숫자 ID 추출 시도 (불가능하면 원본 반환)
    return post_url_or_id.strip()


# ── 스키마 ───────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    account_id:      str
    post_id:         str   # Instagram 미디어 ID (숫자)
    post_url:        str   # 게시물 permalink
    post_thumbnail:  str = ""
    trigger_keyword: str
    dm_template:     str

    @field_validator("trigger_keyword")
    @classmethod
    def keyword_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("trigger_keyword 는 비워둘 수 없습니다.")
        return v

    @field_validator("dm_template")
    @classmethod
    def template_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("dm_template 는 비워둘 수 없습니다.")
        return v


class CampaignUpdate(BaseModel):
    account_id:      str
    trigger_keyword: str | None = None
    dm_template:     str | None = None
    is_active:       bool | None = None


class ScanRequest(BaseModel):
    account_id: str


# ── 목록 조회 ─────────────────────────────────────────────────────────────────

@router.get("/")
async def list_campaigns(account_id: str = Query(...)):
    sb = get_supabase()
    res = (
        sb.table("instagram_dm_campaigns")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"data": res.data or [], "error": None}


# ── 캠페인 생성 ───────────────────────────────────────────────────────────────

@router.post("/")
async def create_campaign(req: CampaignCreate):
    sb = get_supabase()
    post_id = _extract_post_id(req.post_id)
    res = sb.table("instagram_dm_campaigns").insert({
        "account_id":      req.account_id,
        "post_id":         post_id,
        "post_url":        req.post_url,
        "post_thumbnail":  req.post_thumbnail,
        "trigger_keyword": req.trigger_keyword.strip(),
        "dm_template":     req.dm_template.strip(),
        "is_active":       True,
        "sent_count":      0,
    }).execute()
    return {"data": res.data[0] if res.data else None, "error": None}


# ── 캠페인 수정 ───────────────────────────────────────────────────────────────

@router.patch("/{campaign_id}")
async def update_campaign(campaign_id: str, req: CampaignUpdate):
    sb = get_supabase()

    # 소유자 확인
    existing = (
        sb.table("instagram_dm_campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("account_id", req.account_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    patch: dict = {}
    if req.trigger_keyword is not None:
        patch["trigger_keyword"] = req.trigger_keyword.strip()
    if req.dm_template is not None:
        patch["dm_template"] = req.dm_template.strip()
    if req.is_active is not None:
        patch["is_active"] = req.is_active

    if not patch:
        raise HTTPException(status_code=400, detail="변경할 필드가 없습니다.")

    sb.table("instagram_dm_campaigns").update(patch) \
        .eq("id", campaign_id).execute()

    return {"data": {"updated": True}, "error": None}


# ── 캠페인 삭제 ───────────────────────────────────────────────────────────────

@router.delete("/{campaign_id}")
async def delete_campaign(campaign_id: str, account_id: str = Query(...)):
    sb = get_supabase()
    existing = (
        sb.table("instagram_dm_campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("account_id", account_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    sb.table("instagram_dm_campaigns").delete().eq("id", campaign_id).execute()
    return {"data": {"deleted": True}, "error": None}


# ── 수동 스캔 & DM 발송 ────────────────────────────────────────────────────────

@router.post("/scan")
async def scan_campaigns(req: ScanRequest):
    """활성 캠페인을 즉시 스캔하고 트리거 댓글에 DM 발송."""
    from app.services.instagram_dm import scan_and_send
    result = await scan_and_send(req.account_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"data": result, "error": None}


# ── 발송 이력 ─────────────────────────────────────────────────────────────────

@router.get("/{campaign_id}/sent")
async def list_sent(
    campaign_id: str,
    account_id: str = Query(...),
    limit: int = Query(50),
):
    sb = get_supabase()

    # 소유자 확인
    camp = (
        sb.table("instagram_dm_campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("account_id", account_id)
        .execute()
        .data
    )
    if not camp:
        raise HTTPException(status_code=404, detail="캠페인을 찾을 수 없습니다.")

    res = (
        sb.table("instagram_dm_sent")
        .select("*")
        .eq("campaign_id", campaign_id)
        .order("sent_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"data": res.data or [], "error": None}
