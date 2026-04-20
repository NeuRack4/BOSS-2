"""마케팅 전용 API 라우터

엔드포인트:
  POST /api/marketing/image          — DALL-E 3 이미지 생성
  POST /api/marketing/blog/upload    — 네이버 블로그 자동 업로드 (Playwright)
  GET  /api/marketing/subsidies      — 지원사업 목록 조회
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.llm import client as openai_client
from app.core.config import settings
from app.core.supabase import get_supabase
from app.agents._marketing_knowledge import search_subsidy_programs

router = APIRouter(prefix="/api/marketing", tags=["marketing"])


# ── 이미지 생성 ──────────────────────────────────────────────────────────────

class ImageRequest(BaseModel):
    prompt: str                          # 사용자 프롬프트
    style: str = "vivid"                 # vivid | natural
    size: str = "1024x1024"              # 1024x1024 | 1792x1024 | 1024x1792
    business_type: str = ""              # 업종 (프로필에서 전달)
    business_name: str = ""              # 가게명 (프로필에서 전달)


class ImageResponse(BaseModel):
    url: str
    revised_prompt: str


@router.post("/image", response_model=ImageResponse)
async def generate_image(req: ImageRequest):
    """
    DALL-E 3으로 마케팅용 이미지 생성.
    업종/가게명을 프롬프트에 자동 보강해 결과물의 맥락을 높인다.
    """
    # 업종·가게명 보강
    context_prefix = ""
    if req.business_name:
        context_prefix += f"For a Korean small business called '{req.business_name}'"
        if req.business_type:
            context_prefix += f" ({req.business_type})"
        context_prefix += ". "

    full_prompt = (
        context_prefix
        + req.prompt
        + " High-quality marketing photo, Korean aesthetic, warm lighting."
    )

    try:
        resp = await openai_client.images.generate(
            model="dall-e-3",
            prompt=full_prompt,
            n=1,
            size=req.size,  # type: ignore[arg-type]
            style=req.style,  # type: ignore[arg-type]
            quality="standard",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"이미지 생성 실패: {e}")

    img = resp.data[0]
    return ImageResponse(
        url=img.url or "",
        revised_prompt=img.revised_prompt or full_prompt,
    )


# ── 네이버 블로그 자동 업로드 ────────────────────────────────────────────────

class NaverBlogUploadRequest(BaseModel):
    title: str
    content: str                         # 마크다운 본문
    tags: list[str] = []
    account_id: str


class NaverBlogUploadResponse(BaseModel):
    success: bool
    post_url: str = ""
    error: str = ""


@router.post("/blog/upload", response_model=NaverBlogUploadResponse)
async def upload_naver_blog(req: NaverBlogUploadRequest):
    """
    Playwright headless=False로 네이버 블로그에 자동 업로드.
    NAVER_BLOG_ID / NAVER_BLOG_PW 환경변수 필요.
    """
    if not settings.naver_blog_id or not settings.naver_blog_pw:
        raise HTTPException(
            status_code=503,
            detail="NAVER_BLOG_ID / NAVER_BLOG_PW 환경변수가 설정되지 않았습니다.",
        )

    try:
        from app.services.naver_blog import upload_post
        url = await upload_post(
            blog_id=settings.naver_blog_id,
            blog_pw=settings.naver_blog_pw,
            title=req.title,
            content=req.content,
            tags=req.tags,
        )
        return NaverBlogUploadResponse(success=True, post_url=url)
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="playwright가 설치되지 않았습니다. `pip install playwright && playwright install chromium`",
        )
    except Exception as e:
        return NaverBlogUploadResponse(success=False, error=str(e))


# ── 지원사업 목록 ─────────────────────────────────────────────────────────────

@router.get("/subsidies")
async def list_subsidies(
    q: str = Query(default="소상공인 마케팅", description="검색 키워드"),
    limit: int = Query(default=10, ge=1, le=50),
):
    """
    소상공인 정부 지원사업 목록 반환 (마케팅 관련도 내림차순 정렬).
    """
    results = search_subsidy_programs(q, max_results=limit)
    return {"data": results, "total": len(results)}
