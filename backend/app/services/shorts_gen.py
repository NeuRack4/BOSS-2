"""YouTube Shorts 영상 생성 서비스.

이미지 슬라이드 + AI 자막 → FFmpeg → MP4 (9:16 세로 1080×1920)
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

log = logging.getLogger(__name__)

# Malgun Gothic (Windows 기본 한글 폰트)
_FONT_PATH = r"C:/Windows/Fonts/malgun.ttf"
# FFmpeg drawtext에서 콜론을 이스케이프해야 함
_FONT_PATH_ESC = _FONT_PATH.replace(":", r"\:")


# ── 자막 생성 (GPT-4o Vision) ─────────────────────────────────────────────────

async def _generate_subtitle_for_image(image_bytes: bytes, context: str = "") -> str:
    """이미지 한 장에 대한 Shorts 자막 1줄 생성."""
    from app.core.llm import client as openai_client
    from app.core.config import settings

    b64 = base64.b64encode(image_bytes).decode()
    system = (
        "당신은 YouTube Shorts 자막 전문가입니다.\n"
        "이미지를 보고 해당 장면에 어울리는 자막을 한국어로 1줄 작성하세요.\n"
        "규칙: 20자 이내, 임팩트 있게, 말줄임표 금지, 해시태그 금지."
    )
    user_text = f"비즈니스 맥락: {context}\n\n위 이미지에 어울리는 자막 1줄을 작성해주세요." if context else "위 이미지에 어울리는 자막 1줄을 작성해주세요."

    resp = await asyncio.to_thread(
        openai_client.chat.completions.create,
        model=settings.openai_chat_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}},
                {"type": "text", "text": user_text},
            ]},
        ],
        max_tokens=60,
        temperature=0.7,
    )
    return resp.choices[0].message.content.strip().strip('"').strip("'")


async def generate_subtitles_for_images(
    image_bytes_list: list[bytes],
    context: str = "",
) -> list[str]:
    """모든 이미지에 대해 병렬로 자막 생성."""
    tasks = [_generate_subtitle_for_image(img, context) for img in image_bytes_list]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    subtitles = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            log.warning("[shorts] subtitle %d failed: %s", i, r)
            subtitles.append("")
        else:
            subtitles.append(r)
    return subtitles


# ── FFmpeg 영상 합성 ──────────────────────────────────────────────────────────

def _build_ffmpeg_cmd(
    img_paths: list[str],
    subtitles: list[str],
    output_path: str,
    duration: float,
) -> list[str]:
    """FFmpeg 명령어 리스트 조립."""
    n = len(img_paths)

    cmd = ["ffmpeg", "-y"]

    # 입력: 각 이미지를 duration 초 루프
    for p in img_paths:
        cmd += ["-loop", "1", "-t", str(duration), "-i", p]

    # filter_complex 조립
    filters = []

    # 1단계: 각 이미지 → 1080×1920 패드 + 자막 오버레이
    for i, subtitle in enumerate(subtitles):
        # 자막 이스케이프 (FFmpeg drawtext 특수문자)
        safe_text = (
            subtitle
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace(":", "\\:")
            .replace("[", "\\[")
            .replace("]", "\\]")
        )
        scale_pad = (
            f"[{i}:v]"
            f"scale=1080:1920:force_original_aspect_ratio=increase,"
            f"crop=1080:1920"
        )
        if safe_text:
            drawtext = (
                f",drawtext="
                f"fontfile='{_FONT_PATH_ESC}':"
                f"text='{safe_text}':"
                f"fontsize=68:"
                f"fontcolor=white:"
                f"bordercolor=black:"
                f"borderw=5:"
                f"shadowcolor=black@0.6:"
                f"shadowx=3:"
                f"shadowy=3:"
                f"x=(w-text_w)/2:"
                f"y=h*0.80"
            )
        else:
            drawtext = ""
        filters.append(f"{scale_pad}{drawtext}[v{i}]")

    # 2단계: xfade 체인으로 이어붙이기
    if n == 1:
        # 슬라이드 1장이면 그냥 출력
        filters.append(f"[v0]copy[out]")
    else:
        prev = "v0"
        for i in range(1, n):
            offset = round(i * duration - 0.4, 2)
            nxt = "out" if i == n - 1 else f"x{i}"
            filters.append(
                f"[{prev}][v{i}]xfade=transition=fade:duration=0.4:offset={offset}[{nxt}]"
            )
            prev = nxt

    filter_complex = ";".join(filters)

    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-movflags", "+faststart",
        output_path,
    ]
    return cmd


async def build_shorts_video(
    *,
    account_id: str,
    image_bytes_list: list[bytes],
    subtitles: list[str],
    duration_per_slide: float = 3.0,
) -> tuple[str, str, bytes]:
    """
    이미지 + 자막 → MP4 합성 → Supabase Storage 업로드.
    Returns (storage_public_url, storage_path)
    """
    from app.core.supabase import get_supabase

    with tempfile.TemporaryDirectory() as tmpdir:
        # 이미지 저장
        img_paths = []
        for i, img_bytes in enumerate(image_bytes_list):
            p = os.path.join(tmpdir, f"slide_{i:03d}.jpg")
            with open(p, "wb") as f:
                f.write(img_bytes)
            img_paths.append(p)

        output_path = os.path.join(tmpdir, "output.mp4")
        cmd = _build_ffmpeg_cmd(img_paths, subtitles, output_path, duration_per_slide)

        log.info("[shorts] running ffmpeg: %d slides", len(img_paths))
        result = await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            log.error("[shorts] ffmpeg stderr: %s", result.stderr[-1000:])
            raise RuntimeError(f"영상 생성 실패: {result.stderr[-300:]}")

        with open(output_path, "rb") as f:
            video_bytes = f.read()

    # Supabase Storage 업로드
    sb = get_supabase()
    storage_path = f"{account_id}/{uuid.uuid4().hex}.mp4"
    sb.storage.from_("youtube-shorts").upload(
        path=storage_path,
        file=video_bytes,
        file_options={"content-type": "video/mp4", "upsert": "true"},
    )
    public_url = sb.storage.from_("youtube-shorts").get_public_url(storage_path)
    log.info("[shorts] video stored: %s", public_url[:80])
    return public_url, storage_path, video_bytes
