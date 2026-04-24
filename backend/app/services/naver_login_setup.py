"""
네이버 로그인 쿠키 저장 스크립트 (최초 1회 실행)
브라우저 창이 열리면 직접 로그인하세요. 로그인 후 쿠키가 자동 저장됩니다.

실행:
    cd backend
    python -m app.services.naver_login_setup
"""

import json
from pathlib import Path
from playwright.sync_api import sync_playwright

COOKIE_PATH = Path(__file__).parent / "naver_cookies.json"


def main():
    print("브라우저가 열립니다. 네이버에 직접 로그인하세요.")
    print("로그인 완료 후 엔터를 누르세요...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="ko-KR",
        )
        page = context.new_page()
        page.goto("https://nid.naver.com/nidlogin.login")

        input("로그인 완료 후 여기서 엔터를 누르세요: ")

        cookies = context.cookies()
        COOKIE_PATH.write_text(json.dumps(cookies, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"쿠키 저장 완료: {COOKIE_PATH}")
        browser.close()


if __name__ == "__main__":
    main()
