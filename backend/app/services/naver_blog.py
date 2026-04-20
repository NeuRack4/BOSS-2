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


def _run_subprocess(
    blog_id: str,
    blog_pw: str,
    title: str,
    content: str,
    tags: list[str],
) -> str:
    payload = json.dumps({
        "blog_id": blog_id,
        "title":   title,
        "content": content,
        "tags":    tags,
    })
    result = subprocess.run(
        [sys.executable, str(_RUNNER)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=120,
        env={**__import__("os").environ, "NAVER_BLOG_PW": blog_pw},
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
    blog_id: str,
    blog_pw: str,
    title: str,
    content: str,
    tags: list[str] | None = None,
) -> str:
    """
    별도 프로세스에서 Playwright를 실행해 네이버 블로그에 업로드한다.
    반환값: 게시된 포스트 URL (또는 블로그 홈 URL).
    """
    if not blog_id or not blog_pw:
        raise ValueError("NAVER_BLOG_ID / NAVER_BLOG_PW 환경변수를 설정하세요.")
    return await asyncio.to_thread(
        _run_subprocess, blog_id, blog_pw, title, content, tags or []
    )
