"""Meta Graph API를 통한 Instagram 비즈니스 계정 자동 게시.

필수 환경변수:
  META_ACCESS_TOKEN  — 장기 액세스 토큰 (60일 유효)
  INSTAGRAM_USER_ID  — Instagram 비즈니스 계정 숫자 ID

게시 플로우:
  1. DALL-E 이미지 URL → Supabase Storage에 저장 (공개 영구 URL 확보)
  2. POST /{ig_user_id}/media       → 미디어 컨테이너 생성 (creation_id 반환)
  3. POST /{ig_user_id}/media_publish → 실제 게시 (post_id 반환)
"""

from __future__ import annotations

import httpx
import logging

log = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.facebook.com/v19.0"


async def _download_image(url: str) -> bytes:
    """이미지 URL에서 바이트 다운로드."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.content


async def _save_image_to_storage(image_bytes: bytes, account_id: str) -> str:
    """Supabase Storage의 instagram-images 버킷에 저장 후 공개 URL 반환."""
    import uuid
    from app.core.supabase import get_supabase

    sb = get_supabase()
    filename = f"{account_id}/{uuid.uuid4().hex}.jpg"

    sb.storage.from_("instagram-images").upload(
        path=filename,
        file=image_bytes,
        file_options={"content-type": "image/jpeg", "upsert": "true"},
    )

    res = sb.storage.from_("instagram-images").get_public_url(filename)
    # res는 문자열 URL
    return res


async def _create_media_container(
    ig_user_id: str,
    access_token: str,
    image_url: str,
    caption: str,
) -> str:
    """Meta Graph API — 미디어 컨테이너 생성. creation_id 반환."""
    url = f"{_GRAPH_BASE}/{ig_user_id}/media"
    params = {
        "image_url": image_url,
        "caption": caption,
        "access_token": access_token,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, params=params)
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"Meta API 오류: {data['error'].get('message', data['error'])}")
        return data["id"]


async def _publish_container(
    ig_user_id: str,
    access_token: str,
    creation_id: str,
) -> str:
    """Meta Graph API — 컨테이너 게시. post_id 반환."""
    url = f"{_GRAPH_BASE}/{ig_user_id}/media_publish"
    params = {
        "creation_id": creation_id,
        "access_token": access_token,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, params=params)
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"Meta API 오류: {data['error'].get('message', data['error'])}")
        return data["id"]


async def publish_post(
    *,
    account_id: str,
    image_url: str,
    caption: str,
    hashtags: list[str],
) -> str:
    """인스타그램 피드에 이미지 + 캡션 게시. 게시된 post URL 반환.

    Args:
        account_id: BOSS2 계정 ID (Storage 경로용)
        image_url:  DALL-E 또는 기타 이미지 URL (만료 전 다운로드)
        caption:    본문 캡션
        hashtags:   해시태그 리스트 (caption 뒤에 자동 append)

    Returns:
        게시된 인스타그램 포스트 URL
        (https://www.instagram.com/p/{shortcode}/)
    """
    from app.core.config import settings

    if not settings.meta_access_token or not settings.instagram_user_id:
        raise RuntimeError(
            "META_ACCESS_TOKEN 또는 INSTAGRAM_USER_ID 환경변수가 설정되지 않았습니다."
        )

    # 해시태그를 캡션 뒤에 붙임
    tag_str = " ".join(f"#{t}" for t in hashtags) if hashtags else ""
    full_caption = f"{caption}\n\n{tag_str}".strip() if tag_str else caption

    # 1) DALL-E URL은 1시간 후 만료 → Storage에 영구 저장
    log.info("[instagram] downloading image: %s", image_url[:80])
    image_bytes = await _download_image(image_url)
    public_url = await _save_image_to_storage(image_bytes, account_id)
    log.info("[instagram] stored at: %s", public_url)

    # 2) 미디어 컨테이너 생성
    creation_id = await _create_media_container(
        ig_user_id=settings.instagram_user_id,
        access_token=settings.meta_access_token,
        image_url=public_url,
        caption=full_caption,
    )
    log.info("[instagram] container created: %s", creation_id)

    # 3) 게시
    post_id = await _publish_container(
        ig_user_id=settings.instagram_user_id,
        access_token=settings.meta_access_token,
        creation_id=creation_id,
    )
    log.info("[instagram] published: %s", post_id)

    return f"https://www.instagram.com/p/{post_id}/"
