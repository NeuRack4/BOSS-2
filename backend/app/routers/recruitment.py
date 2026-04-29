"""채용 도메인 라우터.

POST /api/recruitment/poster
  body: { account_id, posting_set_id, platform?, style_prompt? }
  → `core.poster_gen.generate_job_posting_poster` 에 위임.
  → 응답: { artifact_id, public_url, storage_path, platform, posting_set_id }

POST /api/recruitment/wage-simulation
  body: { hourly_wage, weekly_hours }
  → 월 기본급·주휴수당·4대보험 의무 여부 계산.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.agents._recruit_calc import MIN_WAGE_2026, calc_total_labor_cost
from app.agents._recruit_templates import VALID_PLATFORMS
from app.core.poster_gen import generate_job_posting_poster
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recruitment", tags=["recruitment"])


class PostingPosterRequest(BaseModel):
    account_id: str = Field(..., description="Supabase auth.uid")
    posting_set_id: str = Field(..., description="대상 job_posting_set artifact id")
    platform: Literal["karrot", "albamon", "saramin"] = "karrot"
    style_prompt: str = Field(default="", description="자유 디자인 지시")


class PostingPosterResponse(BaseModel):
    data: dict
    error: str | None = None
    meta: dict = Field(default_factory=dict)


@router.post("/poster", response_model=PostingPosterResponse)
async def create_posting_poster(req: PostingPosterRequest):
    if req.platform not in VALID_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 platform: {req.platform}")
    try:
        result = await generate_job_posting_poster(
            account_id=req.account_id,
            posting_set_id=req.posting_set_id,
            platform=req.platform,
            style_prompt=req.style_prompt,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        log.exception("posting poster generation failed")
        raise HTTPException(status_code=500, detail=f"포스터 생성 실패: {str(e)[:200]}")
    return PostingPosterResponse(data=result)


@router.get("/posters/{artifact_id}", response_class=HTMLResponse)
async def serve_poster_html(artifact_id: str, account_id: str):
    """artifact.content(HTML)를 text/html로 직접 서빙 — iframe srcDoc 대용."""
    sb = get_supabase()
    rows = (
        sb.table("artifacts")
        .select("content")
        .eq("id", artifact_id)
        .eq("account_id", account_id)
        .eq("type", "job_posting_poster")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="포스터를 찾을 수 없습니다.")
    html = rows[0].get("content") or ""
    if not html:
        raise HTTPException(status_code=404, detail="포스터 HTML이 없습니다.")
    return HTMLResponse(content=html, media_type="text/html; charset=utf-8")


class WageSimRequest(BaseModel):
    hourly_wage: int = Field(default=MIN_WAGE_2026, ge=MIN_WAGE_2026)
    weekly_hours: float = Field(default=20.0, ge=1, le=52)


@router.post("/wage-simulation")
async def wage_simulation(req: WageSimRequest):
    return {"data": calc_total_labor_cost(req.hourly_wage, req.weekly_hours)}
