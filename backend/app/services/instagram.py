"""Meta Graph API를 통한 Instagram 비즈니스 계정 자동 게시.

필수 환경변수:
  META_ACCESS_TOKEN  — 장기 액세스 토큰 (60일 유효)
  INSTAGRAM_USER_ID  — Instagram 비즈니스 계정 숫자 ID

단일 이미지 게시 플로우:
  1. 이미지 URL → Supabase Storage에 저장 (공개 영구 URL 확보)
  2. POST /{ig_user_id}/media       → 미디어 컨테이너 생성
  3. 컨테이너 FINISHED 대기
  4. POST /{ig_user_id}/media_publish → 실제 게시

캐러셀(다중 이미지) 게시 플로우:
  1. 각 이미지 → Storage 저장
  2. 각 이미지마다 is_carousel_item=true 로 child 컨테이너 생성
  3. 모든 child FINISHED 대기
  4. 캐러셀 부모 컨테이너 생성 (children IDs + caption)
  5. 부모 컨테이너 FINISHED 대기
  6. POST /{ig_user_id}/media_publish → 게시
"""

from __future__ import annotations

import asyncio
import httpx
import logging

log = logging.getLogger(__name__)

_GRAPH_BASE = "https://graph.facebook.com/v19.0"


def _get_instagram_credentials(account_id: str) -> dict:
    """DB에서 account_id별 Instagram 자격증명 로드. 없으면 빈 dict 반환."""
    from app.core.supabase import get_supabase
    try:
        sb = get_supabase()
        res = (
            sb.table("platform_credentials")
            .select("credentials")
            .eq("account_id", account_id)
            .eq("platform", "instagram")
            .execute()
        )
        if res.data:
            return res.data[0]["credentials"]
    except Exception:
        pass
    return {}


async def _download_image(url: str) -> bytes:
    """이미지 URL에서 바이트 다운로드."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.content


def _crop_to_portrait(image_bytes: bytes) -> bytes:
    """이미지를 Instagram 최적 비율(4:5)로 중앙 크롭 후 JPEG bytes 반환.

    - 원본이 이미 portrait(세로 긴 이미지)이면 4:5로 맞춰 크롭
    - 원본이 square/landscape이면 가로를 줄여서 4:5로 크롭
    - 최종 리사이즈: 1080×1350 (Instagram 권장 portrait 해상도)
    """
    import io
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = img.size

    target_ratio = 4 / 5  # width / height

    if w / h > target_ratio:
        # 이미지가 너무 넓음 — 좌우 크롭
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        # 이미지가 너무 세로로 긺 — 상하 크롭 (4:5 기준)
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))

    img = img.resize((1080, 1350), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


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

    return sb.storage.from_("instagram-images").get_public_url(filename)


async def _wait_for_container_ready(
    creation_id: str,
    access_token: str,
    max_retries: int = 10,
    interval: float = 3.0,
) -> None:
    """컨테이너 상태가 FINISHED 될 때까지 폴링."""
    url = f"{_GRAPH_BASE}/{creation_id}"
    params = {"fields": "status_code", "access_token": access_token}
    async with httpx.AsyncClient(timeout=30) as client:
        for attempt in range(max_retries):
            r = await client.get(url, params=params)
            data = r.json()
            status = data.get("status_code", "")
            log.info("[instagram] container status: %s (attempt %d)", status, attempt + 1)
            if status == "FINISHED":
                return
            if status == "ERROR":
                raise RuntimeError("Instagram 미디어 컨테이너 처리 오류 (status=ERROR)")
            await asyncio.sleep(interval)
    raise RuntimeError("Instagram 미디어 컨테이너 처리 시간 초과")


async def _create_single_container(
    ig_user_id: str,
    access_token: str,
    image_url: str,
    caption: str,
) -> str:
    """단일 이미지 미디어 컨테이너 생성. creation_id 반환."""
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


async def _create_carousel_item_container(
    ig_user_id: str,
    access_token: str,
    image_url: str,
) -> str:
    """캐러셀 child 컨테이너 생성 (is_carousel_item=true). creation_id 반환."""
    url = f"{_GRAPH_BASE}/{ig_user_id}/media"
    params = {
        "image_url": image_url,
        "is_carousel_item": "true",
        "access_token": access_token,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, params=params)
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"Meta API 오류: {data['error'].get('message', data['error'])}")
        return data["id"]


async def _create_carousel_container(
    ig_user_id: str,
    access_token: str,
    children_ids: list[str],
    caption: str,
) -> str:
    """캐러셀 부모 컨테이너 생성. creation_id 반환."""
    url = f"{_GRAPH_BASE}/{ig_user_id}/media"
    params = {
        "media_type": "CAROUSEL",
        "children": ",".join(children_ids),
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
    """컨테이너 게시. permalink 반환."""
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
        post_id = data["id"]

        permalink_res = await client.get(
            f"{_GRAPH_BASE}/{post_id}",
            params={"fields": "permalink", "access_token": access_token},
        )
        permalink_data = permalink_res.json()
        return permalink_data.get("permalink", f"https://www.instagram.com/p/{post_id}/")


async def _create_reels_container(
    ig_user_id: str,
    access_token: str,
    video_url: str,
    caption: str,
    share_to_feed: bool = True,
) -> str:
    """Reels 미디어 컨테이너 생성. creation_id 반환."""
    url = f"{_GRAPH_BASE}/{ig_user_id}/media"
    params = {
        "media_type": "REELS",
        "video_url": video_url,
        "caption": caption,
        "share_to_feed": "true" if share_to_feed else "false",
        "access_token": access_token,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, params=params)
        data = r.json()
        if "error" in data:
            raise RuntimeError(f"Meta API 오류: {data['error'].get('message', data['error'])}")
        return data["id"]


async def publish_reels(
    *,
    account_id: str,
    video_url: str,
    caption: str,
    hashtags: list[str],
    share_to_feed: bool = True,
) -> str:
    """Instagram Reels에 영상 게시. 게시된 post URL 반환.

    Args:
        video_url:     공개 접근 가능한 MP4 URL (Supabase Storage public URL 등)
        caption:       릴스 설명
        hashtags:      해시태그 리스트 (caption 뒤에 자동 append)
        share_to_feed: 피드에도 함께 노출할지 여부 (기본 True)
    """
    creds = _get_instagram_credentials(account_id)
    ig_user_id   = creds.get("instagram_user_id", "")
    access_token = creds.get("meta_access_token", "")

    if not access_token or not ig_user_id:
        raise RuntimeError("Instagram 연결 설정이 없습니다. 플랫폼 연결 설정에서 Instagram을 연결해주세요.")

    tag_str = " ".join(f"#{t}" for t in hashtags) if hashtags else ""
    full_caption = f"{caption}\n\n{tag_str}".strip() if tag_str else caption

    log.info("[instagram] creating reels container: %s", video_url[:80])
    creation_id = await _create_reels_container(
        ig_user_id=ig_user_id,
        access_token=access_token,
        video_url=video_url,
        caption=full_caption,
        share_to_feed=share_to_feed,
    )
    log.info("[instagram] reels container created: %s", creation_id)

    # 영상 처리는 이미지보다 오래 걸림 — 최대 100초 대기
    await _wait_for_container_ready(creation_id, access_token, max_retries=20, interval=5.0)

    permalink = await _publish_container(
        ig_user_id=ig_user_id,
        access_token=access_token,
        creation_id=creation_id,
    )
    log.info("[instagram] reels published: %s", permalink)
    return permalink


async def publish_post(
    *,
    account_id: str,
    image_urls: list[str],
    caption: str,
    hashtags: list[str],
) -> str:
    """인스타그램 피드에 이미지(1~10장) + 캡션 게시. 게시된 post URL 반환.

    Args:
        account_id: BOSS2 계정 ID (Storage 경로용)
        image_urls: 이미지 URL 리스트 (1장이면 단일, 2~10장이면 캐러셀)
        caption:    본문 캡션
        hashtags:   해시태그 리스트 (caption 뒤에 자동 append)
    """
    creds = _get_instagram_credentials(account_id)
    ig_user_id   = creds.get("instagram_user_id", "")
    access_token = creds.get("meta_access_token", "")

    if not access_token or not ig_user_id:
        raise RuntimeError("Instagram 연결 설정이 없습니다. 플랫폼 연결 설정에서 Instagram을 연결해주세요.")
    if not image_urls:
        raise RuntimeError("이미지를 최소 1장 선택해주세요.")
    if len(image_urls) > 10:
        raise RuntimeError("Instagram 캐러셀은 최대 10장까지 지원합니다.")

    tag_str = " ".join(f"#{t}" for t in hashtags) if hashtags else ""
    full_caption = f"{caption}\n\n{tag_str}".strip() if tag_str else caption

    # 1) 모든 이미지를 4:5 portrait 크롭 후 Storage에 영구 저장
    log.info("[instagram] saving %d image(s) to storage", len(image_urls))
    public_urls: list[str] = []
    for url in image_urls:
        image_bytes = await _download_image(url)
        try:
            image_bytes = _crop_to_portrait(image_bytes)
            log.info("[instagram] cropped to 4:5 portrait (1080x1350)")
        except Exception as e:
            log.warning("[instagram] portrait crop failed, using original: %s", e)
        public_url = await _save_image_to_storage(image_bytes, account_id)
        public_urls.append(public_url)
        log.info("[instagram] stored: %s", public_url[:80])

    if len(public_urls) == 1:
        # ── 단일 이미지 ───────────────────────────────────────────────
        creation_id = await _create_single_container(
            ig_user_id=ig_user_id,
            access_token=access_token,
            image_url=public_urls[0],
            caption=full_caption,
        )
        log.info("[instagram] single container created: %s", creation_id)
        await _wait_for_container_ready(creation_id, access_token)
    else:
        # ── 캐러셀 (다중 이미지) ──────────────────────────────────────
        # child 컨테이너 병렬 생성
        child_ids = await asyncio.gather(*[
            _create_carousel_item_container(ig_user_id, access_token, u)
            for u in public_urls
        ])
        log.info("[instagram] carousel children created: %s", child_ids)

        # 모든 child FINISHED 대기 (병렬)
        await asyncio.gather(*[
            _wait_for_container_ready(cid, access_token)
            for cid in child_ids
        ])

        # 부모 캐러셀 컨테이너 생성
        creation_id = await _create_carousel_container(
            ig_user_id=ig_user_id,
            access_token=access_token,
            children_ids=list(child_ids),
            caption=full_caption,
        )
        log.info("[instagram] carousel container created: %s", creation_id)
        await _wait_for_container_ready(creation_id, access_token)

    # 게시
    permalink = await _publish_container(
        ig_user_id=ig_user_id,
        access_token=access_token,
        creation_id=creation_id,
    )
    log.info("[instagram] published: %s", permalink)
    return permalink
