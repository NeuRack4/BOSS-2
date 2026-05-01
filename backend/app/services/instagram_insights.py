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

    if "error" in insights_data:
        log.warning("[instagram_insights] account insights API error: %s", insights_data["error"])
    elif "data" in insights_data:
        for metric in insights_data["data"]:
            name = metric.get("name")
            # v18+ 이후: total_value 포맷 / 이전: values[] 배열 포맷 모두 처리
            if "total_value" in metric:
                total = metric["total_value"].get("value", 0)
            else:
                values = metric.get("values", [])
                total = sum(v.get("value", 0) for v in values)
            if name == "reach":
                total_reach = total
            elif name == "impressions":
                total_impressions = total
            elif name == "profile_views":
                total_profile_views = total
    else:
        log.warning("[instagram_insights] unexpected insights response: %s", str(insights_data)[:300])

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

            media_type = media.get("media_type", "")
            # REELS는 별도 지표 사용 (engagement/impressions 미지원)
            if media_type == "VIDEO":
                metric_str = "reach,saved,likes,comments,shares"
            else:
                metric_str = "reach,impressions,saved,likes,comments,shares"

            r_insight = await client.get(
                f"{_GRAPH_BASE}/{media_id}/insights",
                params={
                    "metric": metric_str,
                    "access_token": access_token,
                },
            )
            insight_data = r_insight.json()

            if "error" in insight_data:
                log.debug(
                    "[instagram_insights] media %s insights error: %s",
                    media_id, insight_data["error"].get("message", "")
                )
                insight_data = {}

            metrics: dict[str, int] = {}
            for item in insight_data.get("data", []):
                name = item.get("name", "")
                # v18+ total_value 포맷 / 이전 value/values 포맷 모두 처리
                if "total_value" in item:
                    val = item["total_value"].get("value", 0)
                elif item.get("value") is not None:
                    val = item["value"]
                else:
                    val = (item.get("values") or [{}])[0].get("value", 0)
                metrics[name] = int(val or 0)

            # engagement = likes + comments + shares + saves (deprecated 지표 대체)
            engagement = (
                metrics.get("likes", 0)
                + metrics.get("comments", 0)
                + metrics.get("shares", 0)
                + metrics.get("saved", 0)
            )

            caption_raw = media.get("caption") or ""
            results.append({
                "id": media_id,
                "timestamp": media.get("timestamp", ""),
                "caption": caption_raw[:80] + ("…" if len(caption_raw) > 80 else ""),
                "media_type": media_type,
                "permalink": media.get("permalink", ""),
                "reach": metrics.get("reach", 0),
                "impressions": metrics.get("impressions", 0),
                "engagement": engagement,
                "saved": metrics.get("saved", 0),
                "comments": metrics.get("comments", 0),
                "shares": metrics.get("shares", 0),
            })

    return results


async def get_daily_reach(
    access_token: str,
    ig_user_id: str,
    days: int = 30,
) -> list[dict]:
    """일별 도달수 데이터 (values[] 배열에서 추출)."""
    until = datetime.now(timezone.utc)
    since = until - timedelta(days=days)

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{_GRAPH_BASE}/{ig_user_id}/insights",
            params={
                "metric": "reach",
                "period": "day",
                "since": int(since.timestamp()),
                "until": int(until.timestamp()),
                "access_token": access_token,
            },
        )
        data = r.json()

    if "error" in data or "data" not in data:
        return []

    for metric in data["data"]:
        if metric.get("name") == "reach":
            values = metric.get("values", [])
            return [
                {
                    "date": v.get("end_time", "")[:10],
                    "reach": v.get("value", 0),
                }
                for v in values
                if v.get("end_time")
            ]
    return []


async def collect_report_data(days: int = 30, account_id: str = "") -> dict:
    """전체 인스타그램 리포트 데이터 수집."""
    # DB 우선, fallback → env
    access_token = ""
    ig_user_id = ""

    if account_id:
        try:
            from app.core.supabase import get_supabase
            sb = get_supabase()
            res = (
                sb.table("platform_credentials")
                .select("credentials")
                .eq("account_id", account_id)
                .eq("platform", "instagram")
                .execute()
            )
            if res.data:
                creds = res.data[0]["credentials"]
                access_token = creds.get("meta_access_token", "")
                ig_user_id = creds.get("instagram_user_id", "")
        except Exception:
            pass

    if not access_token or not ig_user_id:
        if not account_id:
            # account_id 없이 호출된 경우에만 전역 설정 사용 (레거시)
            from app.core.config import settings
            access_token = access_token or settings.meta_access_token or ""
            ig_user_id = ig_user_id or settings.instagram_user_id or ""

    if not access_token or not ig_user_id:
        return {"error": "Instagram 계정이 연결되지 않았습니다. 플랫폼 연동 설정에서 연결해 주세요."}

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
