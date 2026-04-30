"""댓글 자동 관리 서비스.

YouTube Data API v3 + Instagram Graph API 에서 댓글을 수집하고
GPT-4o 로 AI 답글을 생성한 뒤 comment_queue 에 저장한다.

YouTube  — 계정별 OAuth 토큰 (youtube_oauth_tokens 테이블)
Instagram — 전역 META_ACCESS_TOKEN / INSTAGRAM_USER_ID 환경변수
"""
from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger(__name__)

_YT_API  = "https://www.googleapis.com/youtube/v3"
_GRAPH   = "https://graph.facebook.com/v19.0"


# ── AI 답글 생성 ──────────────────────────────────────────────────────────────

async def generate_ai_reply(
    platform: str,
    commenter_name: str,
    comment_text: str,
) -> str:
    """GPT-4o 로 플랫폼·댓글에 맞는 사장님 답글 생성."""
    from app.core.llm import client as openai_client
    from app.core.config import settings

    platform_label = "YouTube" if platform == "youtube" else "Instagram"
    system = (
        f"당신은 소상공인 사장님을 대신해 {platform_label} 댓글에 답글을 다는 전문가입니다.\n"
        "규칙:\n"
        "- 80자 이내, 친근하고 따뜻한 한국어\n"
        "- 감사 인사 또는 공감 표현으로 시작\n"
        "- 비판적 댓글은 진심 어린 사과 + 개선 의지 표현 (감정적 대응 금지)\n"
        "- 이모지 1~2개 자연스럽게 포함\n"
        "- 제목·라벨 없이 본문만 출력"
    )
    user_text = f"댓글 작성자: {commenter_name}\n댓글 내용: {comment_text}"

    try:
        resp = await asyncio.to_thread(
            openai_client.chat.completions.create,
            model=settings.openai_chat_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_text},
            ],
            max_tokens=150,
            temperature=0.7,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        log.warning("[comment] ai reply failed: %s", e)
        return ""


# ── YouTube ───────────────────────────────────────────────────────────────────

async def _yt_get(path: str, access_token: str, params: dict) -> dict:
    params["access_token"] = access_token
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{_YT_API}/{path}", params=params)
        return r.json()


async def fetch_youtube_comments(account_id: str) -> list[dict]:
    """최근 업로드 영상(최대 10개) 의 미답변 댓글(영상당 최대 20개) 수집."""
    from app.services.youtube import get_valid_token

    try:
        token = await get_valid_token(account_id)
    except Exception as e:
        log.warning("[comment] yt token error account=%s: %s", account_id, e)
        return []

    # 1) 내 채널의 uploads 플레이리스트 ID 조회
    ch = await _yt_get("channels", token, {"part": "contentDetails", "mine": "true"})
    uploads_id = (
        ch.get("items", [{}])[0]
        .get("contentDetails", {})
        .get("relatedPlaylists", {})
        .get("uploads")
    )
    if not uploads_id:
        log.warning("[comment] no uploads playlist for account=%s", account_id)
        return []

    # 2) 최근 업로드 영상 ID + 제목
    pl = await _yt_get("playlistItems", token, {
        "part": "snippet",
        "playlistId": uploads_id,
        "maxResults": "10",
    })
    videos = [
        {
            "id":    item["snippet"]["resourceId"]["videoId"],
            "title": item["snippet"].get("title", ""),
        }
        for item in pl.get("items", [])
    ]

    # 3) 각 영상의 댓글 수집
    comments: list[dict] = []
    for video in videos:
        ct = await _yt_get("commentThreads", token, {
            "part": "snippet",
            "videoId": video["id"],
            "order": "time",
            "maxResults": "20",
            "moderationStatus": "published",
        })
        for item in ct.get("items", []):
            snip = item["snippet"]["topLevelComment"]["snippet"]
            comments.append({
                "platform":       "youtube",
                "media_id":       video["id"],
                "media_title":    video["title"],
                "comment_id":     item["id"],       # thread ID = parent ID for reply
                "commenter_name": snip.get("authorDisplayName", ""),
                "comment_text":   snip.get("textOriginal", ""),
            })

    return comments


async def post_youtube_reply(account_id: str, parent_id: str, reply_text: str) -> None:
    """YouTube 댓글 스레드에 답글 게시."""
    from app.services.youtube import get_valid_token

    token = await get_valid_token(account_id)
    payload = {
        "snippet": {
            "parentId":     parent_id,
            "textOriginal": reply_text,
        }
    }
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(
            f"{_YT_API}/comments",
            params={"part": "snippet", "access_token": token},
            json=payload,
        )
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"YouTube 답글 오류: {data['error'].get('message', data['error'])}")


# ── Instagram ─────────────────────────────────────────────────────────────────

async def fetch_instagram_comments(account_id: str) -> list[dict]:
    """최근 미디어(최대 10개) 의 댓글(미디어당 최대 20개) 수집."""
    from app.services.instagram import _get_instagram_credentials

    creds = _get_instagram_credentials(account_id)
    token = creds.get("meta_access_token", "")
    ig_id = creds.get("instagram_user_id", "")
    if not token or not ig_id:
        return []

    async with httpx.AsyncClient(timeout=20) as c:
        # 1) 최근 미디어
        r = await c.get(f"{_GRAPH}/{ig_id}/media", params={
            "fields": "id,caption,media_type,timestamp",
            "limit":  "10",
            "access_token": token,
        })
        media_items = r.json().get("data", [])

        comments: list[dict] = []
        for media in media_items:
            media_id    = media["id"]
            media_title = (media.get("caption") or "")[:80]

            # 2) 댓글 목록
            rc = await c.get(f"{_GRAPH}/{media_id}/comments", params={
                "fields":       "id,text,username,timestamp",
                "limit":        "20",
                "access_token": token,
            })
            for cmt in rc.json().get("data", []):
                comments.append({
                    "platform":       "instagram",
                    "media_id":       media_id,
                    "media_title":    media_title,
                    "comment_id":     cmt["id"],
                    "commenter_name": cmt.get("username", ""),
                    "comment_text":   cmt.get("text", ""),
                })

    return comments


async def post_instagram_reply(account_id: str, comment_id: str, reply_text: str) -> None:
    """Instagram 댓글에 답글 게시."""
    from app.services.instagram import _get_instagram_credentials

    creds = _get_instagram_credentials(account_id)
    token = creds.get("meta_access_token", "")
    if not token:
        raise RuntimeError("Instagram 연결 설정이 없습니다. 연동 설정에서 Instagram 액세스 토큰을 저장해주세요.")

    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{_GRAPH}/{comment_id}/replies", params={
            "message":      reply_text,
            "access_token": token,
        })
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"Instagram 답글 오류: {data['error'].get('message', data['error'])}")


# ── 통합 스캔 ─────────────────────────────────────────────────────────────────

async def scan_and_store(
    account_id: str,
    platforms: list[str] | None = None,
) -> dict:
    """댓글 수집 → AI 답글 생성 → comment_queue upsert.

    Returns: {"new": int, "skipped": int, "errors": int}
    """
    from app.core.supabase import get_supabase

    if platforms is None:
        platforms = ["youtube", "instagram"]

    sb = get_supabase()
    new_count = skipped = errors = 0

    # 플랫폼별 수집
    raw: list[dict] = []
    tasks = []
    if "youtube" in platforms:
        tasks.append(fetch_youtube_comments(account_id))
    if "instagram" in platforms:
        tasks.append(fetch_instagram_comments(account_id))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            log.warning("[comment] fetch error: %s", r)
        else:
            raw.extend(r)

    log.info("[comment] fetched %d comments for account=%s", len(raw), account_id)

    # 이미 저장된 comment_id 조회 (중복 방지)
    if raw:
        existing = sb.table("comment_queue") \
            .select("comment_id") \
            .eq("account_id", account_id) \
            .execute()
        seen = {row["comment_id"] for row in (existing.data or [])}
    else:
        seen = set()

    # 새 댓글만 AI 답글 생성 후 저장
    for cmt in raw:
        if cmt["comment_id"] in seen:
            skipped += 1
            continue
        if not cmt.get("comment_text", "").strip():
            skipped += 1
            continue

        try:
            ai_reply = await generate_ai_reply(
                cmt["platform"],
                cmt["commenter_name"],
                cmt["comment_text"],
            )
            sb.table("comment_queue").insert({
                "account_id":     account_id,
                "platform":       cmt["platform"],
                "media_id":       cmt["media_id"],
                "media_title":    cmt["media_title"],
                "comment_id":     cmt["comment_id"],
                "commenter_name": cmt["commenter_name"],
                "comment_text":   cmt["comment_text"],
                "ai_reply":       ai_reply,
                "status":         "pending",
            }).execute()
            new_count += 1
        except Exception as e:
            log.warning("[comment] store failed: %s", e)
            errors += 1

    return {"new": new_count, "skipped": skipped, "errors": errors}
