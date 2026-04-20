"""마케팅 전용 API 라우터

엔드포인트:
  POST /api/marketing/image          — DALL-E 3 이미지 생성
  POST /api/marketing/blog/upload    — 네이버 블로그 자동 업로드 (Playwright)
  GET  /api/marketing/subsidies      — 지원사업 목록 조회
"""

from __future__ import annotations

import base64
import json
import logging

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.core.llm import client as openai_client
from app.core.config import settings
from app.core.supabase import get_supabase
from app.agents._marketing_knowledge import search_subsidy_programs

log = logging.getLogger(__name__)

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


# ── 리뷰 이미지 분석 ─────────────────────────────────────────────────────────

_REVIEW_VISION_PROMPT = """이 이미지는 네이버 플레이스, 카카오맵, 구글맵 등의 고객 리뷰 캡처 화면입니다.
아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력.

{
  "platform": "naver 또는 kakao 또는 google 또는 other",
  "star_rating": 별점 숫자 1~5 (없으면 null),
  "review_text": "고객이 작성한 리뷰 본문만 (사장님 답글 제외)",
  "reviewer_name": "닉네임 (없으면 null)"
}

규칙:
- review_text는 고객 리뷰 원문만. 날짜·별점·닉네임·사장님 답글 제외.
- star_rating은 별 개수를 숫자로 (★★★ = 3).
- 리뷰가 보이지 않으면 {"error": "리뷰를 찾을 수 없습니다"} 반환."""


class ReviewAnalysisResult(BaseModel):
    platform: str = "other"
    star_rating: int | None = None
    review_text: str = ""
    reviewer_name: str | None = None
    error: str = ""


_MIME_BY_EXT = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "webp": "image/webp", "bmp": "image/bmp", "gif": "image/gif",
}


@router.post("/review/analyze", response_model=ReviewAnalysisResult)
async def analyze_review_image(file: UploadFile = File(...)):
    """
    리뷰 캡처 이미지를 GPT-4o Vision으로 분석해 별점·플랫폼·리뷰 본문을 추출한다.
    """
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    mime = _MIME_BY_EXT.get(ext, "image/jpeg")
    b64 = base64.standard_b64encode(content).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    try:
        resp = await openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": _REVIEW_VISION_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            temperature=0,
            max_tokens=800,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        log.exception("review vision call failed")
        raise HTTPException(status_code=503, detail=f"이미지 분석 실패: {str(exc)[:200]}")

    raw = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="분석 결과를 파싱하지 못했습니다.")

    if "error" in data:
        return ReviewAnalysisResult(error=data["error"])

    return ReviewAnalysisResult(
        platform=data.get("platform", "other"),
        star_rating=data.get("star_rating"),
        review_text=(data.get("review_text") or "").strip(),
        reviewer_name=data.get("reviewer_name"),
    )


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
