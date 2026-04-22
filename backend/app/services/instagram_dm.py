"""Instagram DM 자동 발송 서비스.

댓글 트리거 기반 자동 DM 흐름:
  1. 활성 캠페인의 게시물 댓글 폴링 (Meta Graph API)
  2. 트리거 키워드 포함 댓글 감지
  3. 발송 이력 확인 (중복 방지)
  4. POST /{ig_user_id}/messages → DM 발송
  5. instagram_dm_sent 에 이력 기록 + sent_count 증가

필요 Meta 권한:
  instagram_manage_comments  — 댓글 읽기
  instagram_manage_messages  — DM 발송
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import httpx

from app.core.supabase import get_supabase

log = logging.getLogger(__name__)
_FB_BASE     = "https://graph.facebook.com/v19.0"    # 댓글 조회 (EAA 토큰)
_IG_BASE     = "https://graph.instagram.com/v25.0"   # DM 발송 (IGAA 토큰)


# ── 댓글 수집 ────────────────────────────────────────────────────────────────

async def _fetch_comments(media_id: str, access_token: str) -> list[dict]:
    """게시물의 최근 댓글 목록 반환.

    Returns list of {id, text, username, from_id}
    """
    url = f"{_FB_BASE}/{media_id}/comments"
    params = {
        "fields": "id,text,username,from",
        "access_token": access_token,
    }
    results: list[dict] = []
    async with httpx.AsyncClient(timeout=30) as client:
        while url:
            r = await client.get(url, params=params if params else {})
            # 페이지네이션: 첫 요청 이후 next URL 사용
            data = r.json()
            if "error" in data:
                log.warning("[ig_dm] fetch_comments error: %s", data["error"])
                break
            for c in data.get("data", []):
                from_info = c.get("from") or {}
                results.append({
                    "id":        c.get("id", ""),
                    "text":      c.get("text", ""),
                    "username":  c.get("username") or from_info.get("name", ""),
                    "from_id":   from_info.get("id", ""),
                })
            next_url = data.get("paging", {}).get("next")
            if next_url:
                url = next_url
                params = {}
            else:
                break
    return results


# ── DM 발송 ─────────────────────────────────────────────────────────────────

async def _send_dm(ig_user_id: str, recipient_ig_id: str, message: str, access_token: str) -> bool:
    """Meta Graph API 로 Instagram DM 발송.

    recipient_ig_id: 댓글의 from.id (Instagram-scoped user ID)
    Returns True on success.
    """
    url = f"{_IG_BASE}/me/messages"
    payload = {
        "recipient": {"id": recipient_ig_id},
        "message":   {"text": message},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            json=payload,
        )
        data = r.json()
        if "error" in data:
            log.warning("[ig_dm] send_dm error to %s: %s", recipient_ig_id, data["error"])
            return False
        log.info("[ig_dm] DM sent to %s (msg_id=%s)", recipient_ig_id, data.get("message_id"))
        return True


# ── 캠페인 스캔 ──────────────────────────────────────────────────────────────

async def scan_and_send(account_id: str) -> dict:
    """활성 DM 캠페인을 스캔하고 트리거 댓글에 DM 발송.

    Returns: {scanned: int, sent: int, campaigns: int}
    """
    from app.core.config import settings

    if not settings.meta_access_token or not settings.meta_ig_access_token or not settings.instagram_user_id:
        return {"error": "Instagram 연결 설정이 없습니다. (META_ACCESS_TOKEN / META_IG_ACCESS_TOKEN / INSTAGRAM_USER_ID)", "scanned": 0, "sent": 0, "campaigns": 0}

    fb_token  = settings.meta_access_token      # EAA — 댓글 조회
    ig_token  = settings.meta_ig_access_token   # IGAA — DM 발송
    ig_user_id = settings.instagram_user_id
    log.info("[ig_dm] fb_token=%s ig_token=%s", fb_token[:6], ig_token[:6])
    sb = get_supabase()

    # 활성 캠페인 조회
    camps = (
        sb.table("instagram_dm_campaigns")
        .select("*")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .execute()
        .data or []
    )
    if not camps:
        return {"scanned": 0, "sent": 0, "campaigns": 0}

    total_sent    = 0
    total_scanned = 0
    skip_no_id      = 0
    skip_already    = 0
    skip_no_keyword = 0
    skip_dm_failed  = 0

    for camp in camps:
        campaign_id     = camp["id"]
        post_id         = camp["post_id"]
        trigger_keyword = camp["trigger_keyword"].strip().lower()
        dm_template     = camp["dm_template"]

        # 이미 발송된 user ID 목록 (중복 방지)
        sent_rows = (
            sb.table("instagram_dm_sent")
            .select("commenter_ig_id")
            .eq("campaign_id", campaign_id)
            .execute()
            .data or []
        )
        already_sent: set[str] = {r["commenter_ig_id"] for r in sent_rows}

        try:
            comments = await _fetch_comments(post_id, fb_token)
        except Exception as e:
            log.warning("[ig_dm] fetch_comments failed for post %s: %s", post_id, e)
            continue

        total_scanned += len(comments)

        send_tasks = []
        new_recipients: list[dict] = []

        log.info("[ig_dm] campaign %s — %d comments fetched", campaign_id, len(comments))
        for comment in comments:
            from_id  = comment["from_id"]
            text     = comment["text"].lower()

            log.info(
                "[ig_dm] comment id=%s user=%s from_id=%r text=%r",
                comment["id"], comment["username"], from_id, comment["text"][:60],
            )

            if not from_id:
                log.warning("[ig_dm] skip — from_id empty (comment id=%s)", comment["id"])
                skip_no_id += 1
                continue
            if from_id in already_sent:
                log.info("[ig_dm] skip — already sent to %s", from_id)
                skip_already += 1
                continue
            if trigger_keyword not in text:
                log.info("[ig_dm] skip — keyword '%s' not in comment", trigger_keyword)
                skip_no_keyword += 1
                continue

            log.info("[ig_dm] queuing DM to %s (from_id=%s)", comment["username"], from_id)
            send_tasks.append(_send_dm(ig_user_id, from_id, dm_template, ig_token))
            new_recipients.append({
                "campaign_id":     campaign_id,
                "commenter_ig_id": from_id,
                "commenter_name":  comment["username"],
                "sent_at":         datetime.now(timezone.utc).isoformat(),
            })

        if not send_tasks:
            continue

        results = await asyncio.gather(*send_tasks, return_exceptions=True)
        success_count = sum(1 for r in results if r is True)
        skip_dm_failed += sum(1 for r in results if r is not True)

        if success_count:
            # 이력 기록 (성공한 것만)
            successful_recipients = [
                new_recipients[i] for i, r in enumerate(results) if r is True
            ]
            sb.table("instagram_dm_sent").insert(successful_recipients).execute()

            # sent_count 증가
            sb.table("instagram_dm_campaigns").update({
                "sent_count": camp["sent_count"] + success_count,
            }).eq("id", campaign_id).execute()

            total_sent += success_count
            log.info("[ig_dm] campaign %s: sent %d DMs", campaign_id, success_count)

    return {
        "scanned": total_scanned,
        "sent": total_sent,
        "campaigns": len(camps),
        "skip_no_id": skip_no_id,
        "skip_already_sent": skip_already,
        "skip_no_keyword": skip_no_keyword,
        "skip_dm_failed": skip_dm_failed,
    }
