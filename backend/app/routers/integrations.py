"""플랫폼 연동 자격증명 관리 라우터

엔드포인트:
  GET    /api/integrations/naver_blog          — 연결 상태 조회
  PUT    /api/integrations/naver_blog          — blog_id + 쿠키 파일 저장
  DELETE /api/integrations/naver_blog          — 연결 해제

  GET    /api/integrations/instagram           — 연결 상태 조회
  PUT    /api/integrations/instagram           — Instagram 토큰 저장
  DELETE /api/integrations/instagram           — 연결 해제

  GET    /api/integrations/youtube             — 연결 상태 조회 (youtube_oauth_tokens 테이블)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.core.supabase import get_supabase

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


def _upsert_credentials(account_id: str, platform: str, credentials: dict) -> None:
    sb = get_supabase()
    sb.table("platform_credentials").upsert(
        {
            "account_id":  account_id,
            "platform":    platform,
            "credentials": credentials,
            "updated_at":  datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="account_id,platform",
    ).execute()


def _delete_credentials(account_id: str, platform: str) -> None:
    sb = get_supabase()
    sb.table("platform_credentials").delete().eq("account_id", account_id).eq("platform", platform).execute()


def _get_credentials(account_id: str, platform: str) -> dict | None:
    sb = get_supabase()
    res = (
        sb.table("platform_credentials")
        .select("credentials, updated_at")
        .eq("account_id", account_id)
        .eq("platform", platform)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0]


# ── 네이버 블로그 ─────────────────────────────────────────────────────────────

@router.get("/naver_blog")
async def get_naver_blog_status(account_id: str):
    row = _get_credentials(account_id, "naver_blog")
    if not row:
        return {"connected": False, "blog_id": ""}
    return {
        "connected":  True,
        "blog_id":    row["credentials"].get("blog_id", ""),
        "updated_at": row["updated_at"],
    }


@router.put("/naver_blog")
async def save_naver_blog(
    account_id: str = Form(...),
    blog_id: str = Form(...),
    cookie_file: UploadFile = File(...),
):
    content = await cookie_file.read()
    try:
        cookies = json.loads(content)
    except Exception:
        raise HTTPException(status_code=400, detail="쿠키 파일이 올바른 JSON 형식이 아닙니다.")
    if not isinstance(cookies, list):
        raise HTTPException(status_code=400, detail="쿠키 파일은 JSON 배열이어야 합니다.")

    _upsert_credentials(account_id, "naver_blog", {"blog_id": blog_id, "cookies": cookies})
    log.info("[integrations] naver_blog saved for account=%s", account_id)
    return {"success": True}


@router.delete("/naver_blog")
async def delete_naver_blog(account_id: str):
    _delete_credentials(account_id, "naver_blog")
    return {"success": True}


# ── Instagram ────────────────────────────────────────────────────────────────

class InstagramCredentials(BaseModel):
    account_id:          str
    meta_access_token:    str   # EAA — 게시/댓글
    instagram_user_id:   str   # IG 비즈니스 계정 숫자 ID
    meta_ig_access_token: str = ""  # IGAA — DM 발송 (선택)


@router.get("/instagram")
async def get_instagram_status(account_id: str):
    row = _get_credentials(account_id, "instagram")
    if not row:
        return {"connected": False}
    creds = row["credentials"]
    return {
        "connected":         True,
        "instagram_user_id": creds.get("instagram_user_id", ""),
        "updated_at":        row["updated_at"],
    }


@router.put("/instagram")
async def save_instagram(req: InstagramCredentials):
    if not req.meta_access_token or not req.instagram_user_id:
        raise HTTPException(status_code=400, detail="Meta Access Token과 Instagram User ID는 필수입니다.")
    _upsert_credentials(req.account_id, "instagram", {
        "meta_access_token":    req.meta_access_token,
        "meta_ig_access_token": req.meta_ig_access_token,
        "instagram_user_id":    req.instagram_user_id,
    })
    log.info("[integrations] instagram saved for account=%s", req.account_id)
    return {"success": True}


@router.delete("/instagram")
async def delete_instagram(account_id: str):
    _delete_credentials(account_id, "instagram")
    return {"success": True}


# ── YouTube ──────────────────────────────────────────────────────────────────

@router.get("/youtube")
async def get_youtube_status(account_id: str):
    """youtube_oauth_tokens 테이블에서 연결 상태 조회."""
    from app.services.youtube import get_connection_status
    status = await get_connection_status(account_id)
    row = _get_credentials(account_id, "youtube")
    creds = row["credentials"] if row else {}
    return {
        **status,
        "configured": bool(creds.get("youtube_client_id") and creds.get("youtube_client_secret")),
        "youtube_client_id": creds.get("youtube_client_id", ""),
        "youtube_redirect_uri": creds.get("youtube_redirect_uri", ""),
        "updated_at": row["updated_at"] if row else None,
    }


class YouTubeCredentials(BaseModel):
    account_id: str
    youtube_client_id: str
    youtube_client_secret: str
    youtube_redirect_uri: str


@router.put("/youtube")
async def save_youtube(req: YouTubeCredentials):
    if not req.youtube_client_id.strip() or not req.youtube_client_secret.strip() or not req.youtube_redirect_uri.strip():
        raise HTTPException(status_code=400, detail="YouTube Client ID, Client Secret, Redirect URI are required.")
    _upsert_credentials(req.account_id, "youtube", {
        "youtube_client_id": req.youtube_client_id.strip(),
        "youtube_client_secret": req.youtube_client_secret.strip(),
        "youtube_redirect_uri": req.youtube_redirect_uri.strip(),
    })
    log.info("[integrations] youtube oauth settings saved for account=%s", req.account_id)
    return {"success": True}


@router.delete("/youtube")
async def delete_youtube(account_id: str):
    sb = get_supabase()
    sb.table("youtube_oauth_tokens").delete().eq("account_id", account_id).execute()
    _delete_credentials(account_id, "youtube")
    return {"success": True}
