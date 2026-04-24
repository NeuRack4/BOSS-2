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

import uuid as _uuid

from typing import List

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import HTMLResponse
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


# ── 인스타그램 자동 게시 ──────────────────────────────────────────────────────

class InstagramPublishRequest(BaseModel):
    account_id: str
    image_urls: list[str]  # 1~10장 (1장: 단일, 2~10장: 캐러셀)
    caption: str
    hashtags: list[str] = []


class InstagramPublishResponse(BaseModel):
    success: bool
    post_url: str = ""
    error: str = ""


@router.post("/instagram/publish", response_model=InstagramPublishResponse)
async def publish_instagram(req: InstagramPublishRequest):
    """
    인스타그램 비즈니스 계정에 이미지 피드 게시.
    META_ACCESS_TOKEN / INSTAGRAM_USER_ID 환경변수 필요.
    """
    from app.core.config import settings

    if not settings.meta_access_token or not settings.instagram_user_id:
        raise HTTPException(
            status_code=503,
            detail="META_ACCESS_TOKEN / INSTAGRAM_USER_ID 환경변수가 설정되지 않았습니다.",
        )

    try:
        from app.services.instagram import publish_post
        post_url = await publish_post(
            account_id=req.account_id,
            image_urls=req.image_urls,
            caption=req.caption,
            hashtags=req.hashtags,
        )
        return InstagramPublishResponse(success=True, post_url=post_url)
    except Exception as e:
        log.exception("instagram publish failed")
        return InstagramPublishResponse(success=False, error=str(e)[:300])


# ── 사진 라이브러리 ───────────────────────────────────────────────────────────

@router.post("/photos/upload")
async def upload_business_photo(
    account_id: str = Form(...),
    file: UploadFile = File(...),
):
    """사업자 사진 라이브러리에 사진 업로드."""
    sb = get_supabase()
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    path = f"{account_id}/{_uuid.uuid4().hex}.{ext}"
    content = await file.read()

    sb.storage.from_("business-photos").upload(
        path=path,
        file=content,
        file_options={"content-type": file.content_type or "image/jpeg", "upsert": "true"},
    )
    public_url = sb.storage.from_("business-photos").get_public_url(path)

    res = sb.table("business_photos").insert({
        "account_id": account_id,
        "storage_path": path,
        "public_url": public_url,
        "name": file.filename or path.split("/")[-1],
        "size_bytes": len(content),
    }).execute()

    row = res.data[0]
    return {"data": row, "error": None}


@router.get("/photos")
async def list_business_photos(account_id: str = Query(...)):
    """계정의 사진 라이브러리 목록 조회."""
    sb = get_supabase()
    res = (
        sb.table("business_photos")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"data": res.data, "error": None}


@router.delete("/photos/{photo_id}")
async def delete_business_photo(photo_id: str, account_id: str = Query(...)):
    """사진 라이브러리에서 사진 삭제."""
    sb = get_supabase()
    res = (
        sb.table("business_photos")
        .select("storage_path")
        .eq("id", photo_id)
        .eq("account_id", account_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="사진을 찾을 수 없습니다.")

    sb.storage.from_("business-photos").remove([res.data[0]["storage_path"]])
    sb.table("business_photos").delete().eq("id", photo_id).execute()
    return {"data": {"deleted": True}, "error": None}


# ── YouTube OAuth + Shorts ────────────────────────────────────────────────────

@router.get("/youtube/oauth/start")
async def youtube_oauth_start(account_id: str = Query(...)):
    """YouTube OAuth 2.0 인가 URL 반환."""
    from app.services.youtube import get_oauth_url
    from app.core.config import settings
    if not settings.youtube_client_id:
        raise HTTPException(status_code=503, detail="YOUTUBE_CLIENT_ID 환경변수가 설정되지 않았습니다.")
    return {"url": get_oauth_url(account_id)}


@router.get("/youtube/oauth/callback", response_class=HTMLResponse)
async def youtube_oauth_callback(code: str = Query(...), state: str = Query(...)):
    """Google OAuth 콜백 — 토큰 저장 후 팝업 닫기."""
    from app.services.youtube import exchange_code_for_tokens
    try:
        await exchange_code_for_tokens(code, account_id=state)
        html = """<html><body><script>
            window.opener && window.opener.postMessage({type:'youtube_connected',success:true},'*');
            window.close();
        </script><p>YouTube 연결 완료! 이 창을 닫아주세요.</p></body></html>"""
    except Exception as e:
        log.exception("youtube oauth callback failed")
        html = f"""<html><body><script>
            window.opener && window.opener.postMessage({{type:'youtube_connected',success:false,error:'{str(e)[:100]}'}},'*');
            window.close();
        </script><p>오류: {str(e)[:200]}</p></body></html>"""
    return HTMLResponse(html)


@router.get("/youtube/oauth/status")
async def youtube_oauth_status(account_id: str = Query(...)):
    """YouTube 연결 상태 조회."""
    from app.services.youtube import get_connection_status
    return await get_connection_status(account_id)


@router.delete("/youtube/oauth/disconnect")
async def youtube_oauth_disconnect(account_id: str = Query(...)):
    """YouTube 연결 해제."""
    sb = get_supabase()
    sb.table("youtube_oauth_tokens").delete().eq("account_id", account_id).execute()
    return {"data": {"disconnected": True}, "error": None}


@router.post("/youtube/shorts/preview-subtitles")
async def preview_subtitles(
    account_id: str = Form(...),
    context: str = Form(""),
    images: List[UploadFile] = File(...),
):
    """이미지들에 대한 AI 자막 + 제목·설명·태그 자동 생성 (FFmpeg 없이 빠른 응답)."""
    from app.services.shorts_gen import generate_subtitles_for_images, generate_video_metadata
    if not (2 <= len(images) <= 10):
        raise HTTPException(status_code=400, detail="이미지는 2~10장이어야 합니다.")
    image_bytes_list = [await img.read() for img in images]
    subtitles = await generate_subtitles_for_images(image_bytes_list, context)
    metadata = await generate_video_metadata(context, subtitles)
    return {
        "data": {
            "subtitles": subtitles,
            "title": metadata["title"],
            "description": metadata["description"],
            "tags": metadata["tags"],
        },
        "error": None,
    }


class ShortsGenerateResponse(BaseModel):
    success: bool
    youtube_url: str = ""
    storage_url: str = ""
    reels_url: str = ""
    reels_error: str = ""
    error: str = ""


@router.post("/youtube/shorts/generate", response_model=ShortsGenerateResponse)
async def generate_shorts(
    account_id: str = Form(...),
    title: str = Form(...),
    description: str = Form(""),
    tags: str = Form("[]"),
    subtitles: str = Form("[]"),          # JSON list — 사용자가 편집한 자막
    duration_per_slide: float = Form(3.0),
    privacy_status: str = Form("private"),
    upload_to_reels: bool = Form(False),  # Instagram Reels 동시 업로드 여부
    images: List[UploadFile] = File(...),
):
    """이미지 슬라이드 → MP4 → YouTube Shorts 업로드."""
    from app.services.shorts_gen import build_shorts_video
    from app.services.youtube import upload_to_youtube

    if not (2 <= len(images) <= 10):
        raise HTTPException(status_code=400, detail="이미지는 2~10장이어야 합니다.")

    try:
        tag_list: list[str] = json.loads(tags)
    except Exception:
        tag_list = []

    try:
        subtitle_list: list[str] = json.loads(subtitles)
    except Exception:
        subtitle_list = []

    # 자막 수가 이미지 수와 맞지 않으면 빈 문자열로 패딩
    image_bytes_list = [await img.read() for img in images]
    n = len(image_bytes_list)
    while len(subtitle_list) < n:
        subtitle_list.append("")

    try:
        storage_url, _storage_path, video_bytes = await build_shorts_video(
            account_id=account_id,
            image_bytes_list=image_bytes_list,
            subtitles=subtitle_list[:n],
            duration_per_slide=max(2.0, min(5.0, duration_per_slide)),
        )
    except Exception as e:
        log.exception("shorts video generation failed")
        return ShortsGenerateResponse(success=False, error=str(e)[:300])

    try:
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name
        youtube_url = await upload_to_youtube(
            account_id=account_id,
            video_path=tmp_path,
            title=title,
            description=description,
            tags=tag_list,
            privacy_status=privacy_status,
        )
        os.unlink(tmp_path)
    except Exception as e:
        log.exception("youtube upload failed")
        reels_url = ""
        reels_error = ""
        if upload_to_reels:
            try:
                from app.services.instagram import publish_reels
                reels_url = await publish_reels(
                    video_url=storage_url,
                    caption=description or title,
                    hashtags=tag_list,
                )
            except Exception as re:
                log.exception("instagram reels upload failed")
                reels_error = str(re)[:300]
        _persist_shorts_artifact(
            account_id=account_id,
            title=title,
            description=description,
            tags=tag_list,
            subtitles=subtitle_list[:n],
            youtube_url="",
            storage_url=storage_url,
            reels_url=reels_url,
            duration_per_slide=duration_per_slide,
            privacy_status=privacy_status,
            slide_count=n,
        )
        return ShortsGenerateResponse(
            success=True,
            storage_url=storage_url,
            reels_url=reels_url,
            reels_error=reels_error,
            error=f"YouTube 업로드 실패: {str(e)[:200]}",
        )

    # Instagram Reels 업로드 (선택)
    reels_url = ""
    reels_error = ""
    if upload_to_reels:
        try:
            from app.services.instagram import publish_reels
            reels_url = await publish_reels(
                video_url=storage_url,
                caption=description or title,
                hashtags=tag_list,
            )
        except Exception as e:
            log.exception("instagram reels upload failed")
            reels_error = str(e)[:300]

    _persist_shorts_artifact(
        account_id=account_id,
        title=title,
        description=description,
        tags=tag_list,
        subtitles=subtitle_list[:n],
        youtube_url=youtube_url,
        storage_url=storage_url,
        reels_url=reels_url,
        duration_per_slide=duration_per_slide,
        privacy_status=privacy_status,
        slide_count=n,
    )

    return ShortsGenerateResponse(
        success=True,
        youtube_url=youtube_url,
        storage_url=storage_url,
        reels_url=reels_url,
        reels_error=reels_error,
    )


def _persist_shorts_artifact(
    *,
    account_id: str,
    title: str,
    description: str,
    tags: list[str],
    subtitles: list[str],
    youtube_url: str,
    storage_url: str,
    reels_url: str = "",
    duration_per_slide: float,
    privacy_status: str,
    slide_count: int,
) -> None:
    """Shorts 생성 결과를 kind='artifact' type='shorts_video' 로 저장.

    metadata 에 youtube_url·storage_url·subtitles·tags 전부 담아 상세 모달에서 바로 재생/링크.
    Marketing > Social 서브허브 아래 contains 엣지로 연결.
    """
    from app.agents._artifact import pick_sub_hub_id

    try:
        sb = get_supabase()
        content = (description or "").strip()
        if subtitles:
            lines = [f"{i + 1}. {s}" for i, s in enumerate(subtitles) if s.strip()]
            if lines:
                content = (content + "\n\n") if content else ""
                content += "**자막**\n" + "\n".join(lines)
        metadata = {
            "youtube_url": youtube_url,
            "storage_url": storage_url,
            "reels_url": reels_url,
            "tags": tags,
            "subtitles": subtitles,
            "duration_per_slide": duration_per_slide,
            "privacy_status": privacy_status,
            "slide_count": slide_count,
        }
        payload = {
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "shorts_video",
            "title": title[:180] or "YouTube Shorts",
            "content": content,
            "status": "active" if youtube_url else "draft",
            "metadata": metadata,
        }
        res = sb.table("artifacts").insert(payload).execute()
        if not res.data:
            return
        artifact_id = res.data[0]["id"]
        hub_id = pick_sub_hub_id(
            sb, account_id, "marketing",
            prefer_keywords=("Social", "social", "shorts", "video"),
        )
        if hub_id:
            try:
                sb.table("artifact_edges").insert({
                    "account_id": account_id,
                    "parent_id":  hub_id,
                    "child_id":   artifact_id,
                    "relation":   "contains",
                }).execute()
            except Exception:
                pass
        try:
            sb.table("activity_logs").insert({
                "account_id":  account_id,
                "type":        "artifact_created",
                "domain":      "marketing",
                "title":       title[:180] or "YouTube Shorts",
                "description": "YouTube Shorts 생성됨",
                "metadata":    {"artifact_id": artifact_id},
            }).execute()
        except Exception:
            pass
    except Exception:
        log.exception("shorts artifact insert failed")


# ── 마케팅 성과 리포트 ────────────────────────────────────────────────────────

@router.get("/report/instagram")
async def get_instagram_report(
    account_id: str = Query(..., description="BOSS2 계정 ID"),
    days: int = Query(default=30, ge=7, le=90, description="조회 기간(일)"),
):
    """Instagram 계정/게시물 성과 데이터 조회."""
    from app.services.instagram_insights import collect_report_data
    data = await collect_report_data(days=days)
    return {"data": data, "error": data.get("error")}


@router.get("/report/youtube")
async def get_youtube_report(
    account_id: str = Query(..., description="BOSS2 계정 ID"),
    days: int = Query(default=30, ge=7, le=90, description="조회 기간(일)"),
):
    """YouTube Analytics 채널/영상 성과 데이터 조회."""
    from app.services.youtube_analytics import collect_report_data
    data = await collect_report_data(account_id=account_id, days=days)
    return {"data": data, "error": data.get("channel", {}).get("error")}


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
