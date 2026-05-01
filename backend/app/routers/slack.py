"""Slack OAuth 연동 라우터 (봇 토큰 방식)

GET    /api/slack/oauth/url      — OAuth 시작 URL 반환
GET    /api/slack/oauth/callback — 코드→토큰 교환 → DB 저장
GET    /api/slack/status         — 연동 여부 조회
DELETE /api/slack/disconnect     — 연동 해제
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse, JSONResponse

from app.core.config import settings
from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/slack", tags=["slack"])

SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"
SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access"
# 봇 토큰 스코프: DM 전송에 필요한 최소 권한
BOT_SCOPES = "chat:write,im:write"


@router.get("/oauth/url")
def get_oauth_url(account_id: str = Query(...)):
    url = (
        f"{SLACK_AUTHORIZE_URL}"
        f"?client_id={settings.slack_client_id}"
        f"&scope={BOT_SCOPES}"
        f"&redirect_uri={settings.slack_redirect_uri}"
        f"&state={account_id}"
    )
    response = JSONResponse(content={"url": url})
    response.headers["ngrok-skip-browser-warning"] = "true"
    return response


@router.get("/oauth/callback")
async def oauth_callback(code: str = Query(...), state: str = Query(...)):
    account_id = state
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            SLACK_TOKEN_URL,
            data={
                "client_id": settings.slack_client_id,
                "client_secret": settings.slack_client_secret,
                "code": code,
                "redirect_uri": settings.slack_redirect_uri,
            },
        )
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(status_code=400, detail=f"Slack OAuth 실패: {data.get('error')}")

    # 봇 토큰 방식: access_token이 봇 토큰
    bot_token = data.get("access_token")
    # 연동한 사용자의 Slack ID
    slack_user_id = data.get("authed_user", {}).get("id")
    team_name = data.get("team", {}).get("name", "")

    if not bot_token or not slack_user_id:
        raise HTTPException(status_code=400, detail="토큰 또는 사용자 ID 없음")

    sb = get_supabase()
    sb.table("slack_connections").upsert({
        "account_id": account_id,
        "slack_user_id": slack_user_id,
        "access_token": bot_token,
        "team_name": team_name,
    }, on_conflict="account_id").execute()

    redirect = RedirectResponse(
        url=f"{settings.boss_frontend_url}/slack-success"
    )
    redirect.headers["ngrok-skip-browser-warning"] = "true"
    return redirect


@router.get("/status")
def get_status(account_id: str = Query(...)):
    sb = get_supabase()
    res = (
        sb.table("slack_connections")
        .select("slack_user_id,team_name,created_at")
        .eq("account_id", account_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return {"connected": True, "team_name": res.data[0]["team_name"]}
    return {"connected": False}


@router.delete("/disconnect")
def disconnect(account_id: str = Query(...)):
    sb = get_supabase()
    sb.table("slack_connections").delete().eq("account_id", account_id).execute()
    return {"ok": True}
