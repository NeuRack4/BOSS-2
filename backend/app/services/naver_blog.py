"""
네이버 블로그 자동 업로드 서비스

uvicorn Windows asyncio 이벤트 루프 충돌을 우회하기 위해
별도 Python 프로세스(naver_blog_runner.py)로 Playwright를 실행한다.
"""

import sys
import json
import asyncio
import subprocess
from pathlib import Path

_RUNNER = Path(__file__).parent / "naver_blog_runner.py"


def _get_naver_credentials(account_id: str) -> tuple[str, list]:
    """DB에서 account_id별 네이버 블로그 자격증명(blog_id, cookies) 반환."""
    from app.core.supabase import get_supabase
    sb = get_supabase()
    res = (
        sb.table("platform_credentials")
        .select("credentials")
        .eq("account_id", account_id)
        .eq("platform", "naver_blog")
        .execute()
    )
    if not res.data:
        raise RuntimeError("네이버 블로그 쿠키가 없습니다. 플랫폼 연결 설정에서 쿠키를 업로드해 주세요.")
    creds = res.data[0]["credentials"]
    blog_id = creds.get("blog_id", "")
    cookies = creds.get("cookies", [])
    if not blog_id or not cookies:
        raise RuntimeError("네이버 블로그 설정이 불완전합니다. 다시 업로드해 주세요.")
    return blog_id, cookies


def _run_subprocess(
    blog_id: str,
    title: str,
    content: str,
    tags: list[str],
    image_urls: list[str] | None = None,
    cookies: list | None = None,
) -> str:
    payload = json.dumps({
        "blog_id":    blog_id,
        "title":      title,
        "content":    content,
        "tags":       tags,
        "image_urls": image_urls or [],
        "cookies":    cookies or [],
    })
    result = subprocess.run(
        [sys.executable, str(_RUNNER)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=120,
    )
    output = result.stdout.strip()
    if not output:
        stderr = result.stderr.strip()
        raise RuntimeError(f"업로드 프로세스 오류: {stderr or '알 수 없는 오류'}")
    data = json.loads(output)
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["url"]


async def upload_post(
    account_id: str,
    title: str,
    content: str,
    tags: list[str] | None = None,
    image_urls: list[str] | None = None,
) -> str:
    """DB에서 account_id별 자격증명을 로드해 네이버 블로그에 업로드.
    반환값: 게시된 포스트 URL (또는 블로그 홈 URL).
    """
    blog_id, cookies = _get_naver_credentials(account_id)
    return await asyncio.to_thread(
        _run_subprocess, blog_id, title, content, tags or [], image_urls or [], cookies
    )
