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
        raw = json.loads(content)
    except Exception:
        raise HTTPException(status_code=400, detail="쿠키 파일이 올바른 JSON 형식이 아닙니다.")

    # 다양한 쿠키 파일 형식 정규화
    if isinstance(raw, list):
        cookies = raw  # Playwright context.cookies() 표준 형식
    elif isinstance(raw, dict) and "cookies" in raw:
        cookies = raw["cookies"]  # Playwright storage_state() 형식
    elif isinstance(raw, dict):
        # 도메인별 객체 형식 {"naver.com": [...]} → 평탄화
        cookies = []
        for v in raw.values():
            if isinstance(v, list):
                cookies.extend(v)
    else:
        cookies = []

    if not cookies:
        raise HTTPException(status_code=400, detail="쿠키 파일에서 유효한 쿠키를 찾을 수 없습니다. naver_login_setup.py로 생성한 파일을 사용해 주세요.")

    if not all(isinstance(c, dict) and "name" in c and "value" in c for c in cookies):
        raise HTTPException(status_code=400, detail="쿠키 형식이 올바르지 않습니다. Cookie-Editor 확장프로그램으로 내보낸 파일을 사용해 주세요.")

    # Cookie-Editor 등 외부 도구 형식 → Playwright add_cookies() 형식으로 정규화
    _VALID_SAMESITE = {"Strict", "Lax", "None"}
    normalized = []
    for c in cookies:
        nc: dict = {"name": c["name"], "value": c["value"]}
        # domain / path
        if "domain" in c:
            nc["domain"] = c["domain"]
        if "path" in c:
            nc["path"] = c["path"]
        # 만료일: expirationDate(Cookie-Editor) → expires(Playwright)
        if "expires" in c:
            nc["expires"] = float(c["expires"])
        elif "expirationDate" in c:
            nc["expires"] = float(c["expirationDate"])
        # httpOnly / secure
        if "httpOnly" in c:
            nc["httpOnly"] = bool(c["httpOnly"])
        if "secure" in c:
            nc["secure"] = bool(c["secure"])
        # sameSite: "unspecified" 등 비표준 값 제거
        same_site = c.get("sameSite", "")
        if same_site in _VALID_SAMESITE:
            nc["sameSite"] = same_site
        normalized.append(nc)

    _upsert_credentials(account_id, "naver_blog", {"blog_id": blog_id, "cookies": normalized})
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

    # Meta Graph API로 실제 계정 검증
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"https://graph.facebook.com/v19.0/{req.instagram_user_id}",
                params={
                    "fields": "id,name,username",
                    "access_token": req.meta_access_token,
                },
            )
        data = r.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Meta API 연결에 실패했습니다. 잠시 후 다시 시도해주세요.")

    if "error" in data:
        msg = data["error"].get("message", "")
        code = data["error"].get("code", 0)
        if code in (190, 102):
            raise HTTPException(status_code=401, detail="유효하지 않거나 만료된 Access Token입니다.")
        if code == 100:
            raise HTTPException(status_code=400, detail="Instagram User ID가 올바르지 않습니다.")
        raise HTTPException(status_code=400, detail=f"Meta API 오류: {msg}")

    if data.get("id") != req.instagram_user_id:
        raise HTTPException(status_code=400, detail="Instagram User ID가 토큰과 일치하지 않습니다.")

    _upsert_credentials(req.account_id, "instagram", {
        "meta_access_token":    req.meta_access_token,
        "meta_ig_access_token": req.meta_ig_access_token,
        "instagram_user_id":    req.instagram_user_id,
    })
    log.info("[integrations] instagram saved for account=%s (ig_id=%s)", req.account_id, req.instagram_user_id)
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
    import httpx

    client_id = req.youtube_client_id.strip()
    client_secret = req.youtube_client_secret.strip()

    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="YouTube Client ID와 Client Secret은 필수입니다.")
    if not client_id.endswith(".apps.googleusercontent.com"):
        raise HTTPException(status_code=400, detail="Client ID 형식이 올바르지 않습니다. (예: xxxxxx.apps.googleusercontent.com)")

    # Google 토큰 엔드포인트에 더미 코드로 요청:
    # - invalid_client → Client ID 또는 Secret이 실제로 존재하지 않음
    # - invalid_grant  → 자격증명은 유효하나 코드가 잘못됨 (정상 저장 가능)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "authorization_code",
                    "code": "invalid_dummy_code",
                    "redirect_uri": req.youtube_redirect_uri.strip() or "http://localhost",
                },
            )
        result = r.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Google API 연결에 실패했습니다. 잠시 후 다시 시도해주세요.")

    error = result.get("error", "")
    if error == "invalid_client":
        raise HTTPException(status_code=401, detail="Client ID 또는 Client Secret이 올바르지 않습니다.")
    if error not in ("invalid_grant", "redirect_uri_mismatch"):
        raise HTTPException(status_code=400, detail=f"Google API 오류: {result.get('error_description', error)}")

    _upsert_credentials(req.account_id, "youtube", {
        "youtube_client_id": client_id,
        "youtube_client_secret": client_secret,
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
