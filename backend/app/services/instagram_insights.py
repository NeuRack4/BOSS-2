"""Instagram Graph API — 계정/게시물 성과 인사이트.

필요 권한:
  META_ACCESS_TOKEN  — instagram_manage_insights 권한 포함 필요
  INSTAGRAM_USER_ID  — Instagram 비즈니스 계정 숫자 ID

Instagram Insights는 비즈니스/크리에이터 계정에서만 사용 가능.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx

log = logging.getLogger(__name__)
_GRAPH_BASE = "https://graph.facebook.com/v19.0"


async def get_account_insights(
    access_token: str,
    ig_user_id: str,
    days: int = 30,
) -> dict:
    """계정 레벨 인사이트: 팔로워 수, 도달수, 인상수, 프로필 방문."""
    until = datetime.now(timezone.utc)
    since = until - timedelta(days=days)

    async with httpx.AsyncClient(timeout=30) as client:
        # 팔로워 수 + 게시물 수 (현재 스냅샷)
        r_account = await client.get(
            f"{_GRAPH_BASE}/{ig_user_id}",
            params={
                "fields": "followers_count,media_count,name,username",
                "access_token": access_token,
            },
        )
        account_data = r_account.json()

        # 기간별 계정 인사이트
        r_insights = await client.get(
            f"{_GRAPH_BASE}/{ig_user_id}/insights",
            params={
                "metric": "reach,impressions,profile_views",
                "period": "day",
                "since": int(since.timestamp()),
                "until": int(until.timestamp()),
                "access_token": access_token,
            },
        )
        insights_data = r_insights.json()

    if "error" in account_data:
        raise RuntimeError(account_data["error"].get("message", "Meta API 오류"))

    followers = account_data.get("followers_count", 0)
    media_count = account_data.get("media_count", 0)
    username = account_data.get("username", "")

    total_reach = 0
    total_impressions = 0
    total_profile_views = 0

    if "data" in insights_data:
        for metric in insights_data["data"]:
            name = metric.get("name")
            values = metric.get("values", [])
            total = sum(v.get("value", 0) for v in values)
            if name == "reach":
                total_reach = total
            elif name == "impressions":
                total_impressions = total
            elif name == "profile_views":
                total_profile_views = total

    return {
        "username": username,
        "followers_count": followers,
        "media_count": media_count,
        "reach": total_reach,
        "impressions": total_impressions,
        "profile_views": total_profile_views,
        "period_days": days,
    }


async def get_media_insights(
    access_token: str,
    ig_user_id: str,
    limit: int = 12,
) -> list[dict]:
    """최근 게시물별 성과 데이터 (engagement 포함)."""
    async with httpx.AsyncClient(timeout=30) as client:
        r_media = await client.get(
            f"{_GRAPH_BASE}/{ig_user_id}/media",
            params={
                "fields": "id,timestamp,caption,media_type,permalink,thumbnail_url,media_url",
                "limit": limit,
                "access_token": access_token,
            },
        )
        media_list = r_media.json().get("data", [])

        results: list[dict] = []
        for media in media_list:
            media_id = media.get("id")
            if not media_id:
                continue

            r_insight = await client.get(
                f"{_GRAPH_BASE}/{media_id}/insights",
                params={
                    "metric": "reach,impressions,engagement,saved",
                    "access_token": access_token,
                },
            )
            insight_data = r_insight.json()

            metrics: dict[str, int] = {}
            for item in insight_data.get("data", []):
                name = item.get("name", "")
                # video/reels는 value 직접, image는 values[0].value
                val = item.get("value") or (item.get("values") or [{}])[0].get("value", 0)
                metrics[name] = int(val or 0)

            caption_raw = media.get("caption") or ""
            results.append({
                "id": media_id,
                "timestamp": media.get("timestamp", ""),
                "caption": caption_raw[:80] + ("…" if len(caption_raw) > 80 else ""),
                "media_type": media.get("media_type", ""),
                "permalink": media.get("permalink", ""),
                "reach": metrics.get("reach", 0),
                "impressions": metrics.get("impressions", 0),
                "engagement": metrics.get("engagement", 0),
                "saved": metrics.get("saved", 0),
            })

    return results


async def collect_report_data(days: int = 30) -> dict:
    """전체 인스타그램 리포트 데이터 수집."""
    from app.core.config import settings

    if not settings.meta_access_token or not settings.instagram_user_id:
        return {"error": "Instagram 계정이 연결되지 않았습니다. 환경변수를 확인해주세요."}

    access_token = settings.meta_access_token
    ig_user_id = settings.instagram_user_id

    try:
        account = await get_account_insights(access_token, ig_user_id, days)
        media = await get_media_insights(access_token, ig_user_id, limit=12)

        # TOP 3 게시물 (engagement 기준)
        top_posts = sorted(media, key=lambda x: x.get("engagement", 0), reverse=True)[:3]

        # 평균 engagement rate
        avg_engagement = (
            sum(m.get("engagement", 0) for m in media) / len(media)
            if media else 0
        )

        return {
            "account": account,
            "top_posts": top_posts,
            "avg_engagement": round(avg_engagement, 1),
            "total_posts_analyzed": len(media),
        }
    except Exception as e:
        log.exception("[instagram_insights] collect_report_data failed")
        return {"error": str(e)}
