"""YouTube Data API v3 OAuth 2.0 + 영상 업로드 서비스.

필수 환경변수:
  YOUTUBE_CLIENT_ID       — Google Cloud Console OAuth 2.0 클라이언트 ID
  YOUTUBE_CLIENT_SECRET   — 클라이언트 시크릿
  YOUTUBE_REDIRECT_URI    — 콜백 URI (기본: http://localhost:8000/api/marketing/youtube/oauth/callback)
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

log = logging.getLogger(__name__)

_GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_YT_UPLOAD_URL    = "https://www.googleapis.com/upload/youtube/v3/videos"
_SCOPES           = "https://www.googleapis.com/auth/youtube.upload"


# ── OAuth URL 생성 ────────────────────────────────────────────────────────────

def get_oauth_url(account_id: str) -> str:
    """Google OAuth 2.0 인가 URL 반환. state = account_id."""
    from app.core.config import settings
    import urllib.parse

    params = {
        "client_id":     settings.youtube_client_id,
        "redirect_uri":  settings.youtube_redirect_uri,
        "response_type": "code",
        "scope":         _SCOPES,
        "access_type":   "offline",
        "prompt":        "consent",   # 매번 refresh_token 재발급
        "state":         account_id,
    }
    return f"{_GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"


# ── 코드 → 토큰 교환 ─────────────────────────────────────────────────────────

async def exchange_code_for_tokens(code: str, account_id: str) -> dict:
    """Authorization code → access/refresh token 교환 후 DB upsert."""
    from app.core.config import settings
    from app.core.supabase import get_supabase

    async with httpx.AsyncClient() as client:
        r = await client.post(_GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     settings.youtube_client_id,
            "client_secret": settings.youtube_client_secret,
            "redirect_uri":  settings.youtube_redirect_uri,
            "grant_type":    "authorization_code",
        })
        data = r.json()

    if "error" in data:
        raise RuntimeError(f"Google OAuth 오류: {data.get('error_description', data['error'])}")

    expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))

    sb = get_supabase()
    sb.table("youtube_oauth_tokens").upsert({
        "account_id":    account_id,
        "access_token":  data["access_token"],
        "refresh_token": data.get("refresh_token", ""),
        "token_expiry":  expiry.isoformat(),
        "scope":         data.get("scope", _SCOPES),
    }, on_conflict="account_id").execute()

    log.info("[youtube] tokens saved for account=%s", account_id)
    return data


# ── 토큰 갱신 ─────────────────────────────────────────────────────────────────

async def _refresh_token(account_id: str, refresh_token: str) -> str:
    """refresh_token으로 새 access_token 획득 후 DB 업데이트."""
    from app.core.config import settings
    from app.core.supabase import get_supabase

    async with httpx.AsyncClient() as client:
        r = await client.post(_GOOGLE_TOKEN_URL, data={
            "client_id":     settings.youtube_client_id,
            "client_secret": settings.youtube_client_secret,
            "refresh_token": refresh_token,
            "grant_type":    "refresh_token",
        })
        data = r.json()

    if "error" in data:
        raise RuntimeError(f"토큰 갱신 실패: {data.get('error_description', data['error'])}")

    expiry = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
    access_token = data["access_token"]

    sb = get_supabase()
    sb.table("youtube_oauth_tokens").update({
        "access_token": access_token,
        "token_expiry": expiry.isoformat(),
    }).eq("account_id", account_id).execute()

    return access_token


async def get_valid_token(account_id: str) -> str:
    """유효한 access_token 반환. 만료 5분 전이면 자동 갱신."""
    from app.core.supabase import get_supabase

    sb = get_supabase()
    res = sb.table("youtube_oauth_tokens").select("*").eq("account_id", account_id).execute()
    if not res.data:
        raise RuntimeError("YouTube 계정이 연결되지 않았습니다. 먼저 YouTube를 연결해주세요.")

    row = res.data[0]
    expiry = datetime.fromisoformat(row["token_expiry"])
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if datetime.now(timezone.utc) >= expiry - timedelta(minutes=5):
        return await _refresh_token(account_id, row["refresh_token"])

    return row["access_token"]


async def get_connection_status(account_id: str) -> dict:
    """YouTube 연결 상태 조회."""
    from app.core.supabase import get_supabase

    sb = get_supabase()
    res = sb.table("youtube_oauth_tokens").select("token_expiry").eq("account_id", account_id).execute()
    if not res.data:
        return {"connected": False, "expires_at": None}
    return {"connected": True, "expires_at": res.data[0]["token_expiry"]}


# ── YouTube 영상 업로드 ───────────────────────────────────────────────────────

async def upload_to_youtube(
    *,
    account_id: str,
    video_path: str,
    title: str,
    description: str = "",
    tags: list[str] | None = None,
    privacy_status: str = "private",
) -> str:
    """MP4 파일을 YouTube에 업로드. YouTube 영상 URL 반환."""
    access_token = await get_valid_token(account_id)

    metadata = {
        "snippet": {
            "title":       title[:100],
            "description": description[:5000],
            "tags":        tags or [],
            "categoryId":  "22",   # People & Blogs
        },
        "status": {
            "privacyStatus": privacy_status,
            "selfDeclaredMadeForKids": False,
        },
    }

    with open(video_path, "rb") as f:
        video_bytes = f.read()

    # Resumable upload (단일 요청으로 처리 — 500MB 이하)
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(
            _YT_UPLOAD_URL,
            params={"uploadType": "multipart", "part": "snippet,status"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-Upload-Content-Type": "video/mp4",
            },
            files={
                "metadata": (None, __import__("json").dumps(metadata), "application/json; charset=UTF-8"),
                "video":    ("video.mp4", video_bytes, "video/mp4"),
            },
        )

    data = r.json()
    if "error" in data:
        raise RuntimeError(f"YouTube 업로드 오류: {data['error'].get('message', data['error'])}")

    video_id = data["id"]
    log.info("[youtube] uploaded video_id=%s", video_id)
    return f"https://youtu.be/{video_id}"
