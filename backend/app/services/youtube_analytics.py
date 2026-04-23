"""YouTube Analytics API v2 — 채널/영상 성과 데이터.

필요 OAuth 스코프:
  yt-analytics.readonly — youtube.py의 _SCOPES에 추가됨

기존 youtube.py의 get_valid_token()을 재활용해 토큰 관리.
이미 연결된 계정 중 analytics 스코프가 없는 경우 재연결 안내 반환.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

import httpx

log = logging.getLogger(__name__)
_YT_ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports"


async def get_channel_analytics(
    account_id: str,
    days: int = 30,
) -> dict:
    """채널 전체 통계: 조회수, 시청시간(분), 구독자 증감, 좋아요, 댓글."""
    from app.services.youtube import get_valid_token

    end_date = date.today().isoformat()
    start_date = (date.today() - timedelta(days=days)).isoformat()

    try:
        access_token = await get_valid_token(account_id)
    except RuntimeError as e:
        return {"error": str(e)}

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            _YT_ANALYTICS_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "ids": "channel==MINE",
                "startDate": start_date,
                "endDate": end_date,
                "metrics": "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments",
            },
        )
        data = r.json()

    if "error" in data:
        err = data["error"]
        code = err.get("code", 0)
        msg = err.get("message", str(err))
        details = err.get("errors", [])
        log.error(
            "[youtube_analytics] channel analytics error code=%s msg=%s details=%s",
            code, msg, details,
        )
        if code == 403:
            reason = details[0].get("reason", "") if details else ""
            log.error("[youtube_analytics] 403 reason=%s", reason)
            return {
                "error": f"YouTube Analytics 권한 오류: {msg}",
                "needs_reconnect": True,
            }
        return {"error": msg}

    rows = data.get("rows")
    if not rows:
        return {
            "views": 0,
            "watch_minutes": 0,
            "subscribers_gained": 0,
            "subscribers_lost": 0,
            "net_subscribers": 0,
            "likes": 0,
            "comments": 0,
            "period_days": days,
            "start_date": start_date,
            "end_date": end_date,
        }

    row = rows[0]
    views, watch_min, sub_gain, sub_lost, likes, comments = (int(v or 0) for v in row)
    return {
        "views": views,
        "watch_minutes": watch_min,
        "subscribers_gained": sub_gain,
        "subscribers_lost": sub_lost,
        "net_subscribers": sub_gain - sub_lost,
        "likes": likes,
        "comments": comments,
        "period_days": days,
        "start_date": start_date,
        "end_date": end_date,
    }


async def get_top_videos(
    account_id: str,
    days: int = 30,
    limit: int = 5,
) -> list[dict]:
    """조회수 기준 상위 영상 목록."""
    from app.services.youtube import get_valid_token

    end_date = date.today().isoformat()
    start_date = (date.today() - timedelta(days=days)).isoformat()

    try:
        access_token = await get_valid_token(account_id)
    except RuntimeError:
        return []

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            _YT_ANALYTICS_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "ids": "channel==MINE",
                "startDate": start_date,
                "endDate": end_date,
                "metrics": "views,estimatedMinutesWatched,likes",
                "dimensions": "video",
                "sort": "-views",
                "maxResults": limit,
            },
        )
        data = r.json()

    if "error" in data:
        err = data["error"]
        log.error("[youtube_analytics] top_videos error code=%s msg=%s", err.get("code"), err.get("message"))
        return []
    if not data.get("rows"):
        return []

    headers = [h["name"] for h in data.get("columnHeaders", [])]
    results: list[dict] = []
    for row in data.get("rows", []):
        item = dict(zip(headers, row))
        video_id = item.get("video", "")
        results.append({
            "video_id": video_id,
            "views": int(item.get("views", 0)),
            "watch_minutes": int(item.get("estimatedMinutesWatched", 0)),
            "likes": int(item.get("likes", 0)),
            "url": f"https://youtu.be/{video_id}" if video_id else "",
        })

    return results


async def collect_report_data(account_id: str, days: int = 30) -> dict:
    """전체 유튜브 리포트 데이터 수집."""
    channel = await get_channel_analytics(account_id, days=days)
    top_videos = await get_top_videos(account_id, days=days, limit=5)
    return {
        "channel": channel,
        "top_videos": top_videos,
    }
