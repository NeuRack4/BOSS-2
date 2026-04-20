# 네이버 블로그 업로드 실행 스크립트 (독립 프로세스용)
# BOSS automation/naver_blog_runner.py에서 이식
import sys
import json
import re
import base64
import subprocess
import time
from pathlib import Path

COOKIE_PATH = Path(__file__).parent / "naver_cookies.json"

_JS_CLICK_SEL = "(selector) => { const el = document.querySelector(selector); if (el) { el.click(); return true; } return false; }"
_JS_CLICK_TEXT = "(text) => { const btns = [...document.querySelectorAll('button')]; const el = btns.find(b => b.innerText.trim().includes(text)); if (el) { el.click(); return true; } return false; }"


def set_clipboard(text: str) -> None:
    """Base64 → UTF-16LE 경유로 한글 텍스트를 안전하게 Windows 클립보드에 씁니다."""
    b64 = base64.b64encode(text.encode("utf-16-le")).decode("ascii")
    ps_cmd = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        f"$bytes = [Convert]::FromBase64String('{b64}'); "
        "$str = [Text.Encoding]::Unicode.GetString($bytes); "
        "[Windows.Forms.Clipboard]::SetText($str)"
    )
    subprocess.run(
        ["powershell", "-sta", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
        capture_output=True,
        timeout=15,
    )


def paste_text(page, text: str) -> None:
    set_clipboard(text)
    time.sleep(0.3)
    page.keyboard.press("Control+v")
    time.sleep(0.4)


def strip_markdown(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"~~~[\s\S]*?~~~", "", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\*{3}(.+?)\*{3}", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\*{2}(.+?)\*{2}", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\*(.+?)\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"_{2}(.+?)_{2}", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"_(.+?)_", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"`(.+?)`", r"\1", text)
    text = re.sub(r"\[(.+?)\]\(.+?\)", r"\1", text)
    text = re.sub(r"!\[.*?\]\(.+?\)", "", text)
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_content(raw: str) -> tuple[str, list[tuple[str, str]], list[str]]:
    SKIP_LABELS = {
        "제목", "본문", "태그", "태그 추천", "해시태그", "소개", "내용",
        "블로그 포스팅", "포스팅 초안", "네이버 블로그 포스팅", "네이버 블로그",
    }
    META_KEYWORDS = ["포스팅 초안", "블로그 초안", "네이버 블로그", "초안"]

    lines = raw.strip().splitlines()
    title = ""
    segments: list[tuple[str, str]] = []
    tags: list[str] = []
    mode = "body"

    for line in lines:
        s = line.strip()

        if not s:
            if segments and segments[-1][0] != "blank":
                segments.append(("blank", ""))
            continue

        if re.match(r"^(#[\w가-힣A-Za-z]+\s*)+$", s):
            tags = re.findall(r"#([\w가-힣A-Za-z]+)", s)
            mode = "body"
            continue

        if s.startswith("# "):
            candidate = s[2:].strip()
            if any(kw in candidate for kw in META_KEYWORDS) or candidate in SKIP_LABELS:
                continue
            if not title:
                title = strip_markdown(candidate)
            mode = "body"
            continue

        if s.startswith("## "):
            candidate = strip_markdown(s[3:].strip())
            if candidate in SKIP_LABELS or any(kw in candidate for kw in META_KEYWORDS):
                if "제목" in candidate:
                    mode = "title_next"
                elif "태그" in candidate or "해시" in candidate:
                    mode = "tags_next"
                else:
                    mode = "body"
                continue
            if not title:
                title = candidate
            else:
                segments.append(("subheading", candidate))
            mode = "body"
            continue

        m = re.match(r"^#{3,6}\s+(.+)$", s)
        if m:
            candidate = strip_markdown(m.group(1))
            if candidate not in SKIP_LABELS:
                segments.append(("subheading", candidate))
            mode = "body"
            continue

        label_m = re.match(r"^\d+\.\s+(.+)$", s)
        if label_m:
            label = label_m.group(1).strip()
            if label in SKIP_LABELS or any(kw in label for kw in META_KEYWORDS):
                if "제목" in label:
                    mode = "title_next"
                elif "태그" in label or "해시" in label:
                    mode = "tags_next"
                else:
                    mode = "body"
                continue

        if mode == "title_next":
            if not title:
                title = strip_markdown(s)
            mode = "body"
        elif mode == "tags_next":
            found = re.findall(r"#([\w가-힣A-Za-z]+)", s)
            if found:
                tags.extend(found)
            else:
                mode = "body"
                cleaned = strip_markdown(s)
                if cleaned:
                    segments.append(("body", cleaned))
        else:
            cleaned = strip_markdown(s)
            if cleaned:
                segments.append(("body", cleaned))

    if not title:
        for kind, text in segments:
            if kind == "body" and text:
                title = text[:40]
                break

    return title, segments, tags


def insert_image(page, image_path: str) -> bool:
    """SE One 에디터 본문에 로컬 이미지 파일을 삽입."""
    # 이미지 삽입 툴바 버튼 클릭
    clicked = page.evaluate("""() => {
        const selectors = [
            'button[data-name="image"]',
            '.se-toolbar button[title*="사진"]',
            '.se-toolbar button[title*="Image"]',
            '.se-toolbar button[title*="이미지"]',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) { el.dispatchEvent(new MouseEvent('click', {bubbles:true})); return sel; }
        }
        // 아이콘 클래스로 탐색
        const btns = [...document.querySelectorAll('.se-toolbar button')];
        const btn = btns.find(b =>
            b.querySelector('svg[class*="image"]') ||
            b.querySelector('i[class*="image"]') ||
            b.querySelector('span[class*="image"]') ||
            b.title?.toLowerCase().includes('image') ||
            b.title?.includes('사진') || b.title?.includes('이미지')
        );
        if (btn) { btn.dispatchEvent(new MouseEvent('click', {bubbles:true})); return 'icon-found'; }
        return null;
    }""")
    if not clicked:
        return False
    time.sleep(1.5)

    # 파일 업로드 input 찾기
    file_input = page.locator("input[type='file']").first
    if file_input.count() == 0:
        return False

    file_input.set_input_files(image_path)
    time.sleep(3)  # 업로드 완료 대기

    # 팝업 확인/삽입 버튼 클릭
    for sel in [
        "button:has-text('삽입')",
        "button:has-text('확인')",
        ".se-popup-button-confirm",
        ".se-popup button",
    ]:
        loc = page.locator(sel)
        if loc.count() > 0:
            loc.first.click(force=True)
            time.sleep(1)
            break

    page.wait_for_timeout(1000)
    return True


def main():
    data = json.loads(sys.stdin.read())
    content = data["content"]
    blog_id = data["blog_id"]
    title_override = data.get("title", "")
    tags_override = data.get("tags", [])
    image_path = data.get("image_path", "")

    parsed_title, segments, parsed_tags = parse_content(content)
    title = title_override or parsed_title
    tags = tags_override or parsed_tags

    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--no-sandbox", "--window-size=1280,900"],
        )
        context = browser.new_context(
            locale="ko-KR",
            viewport={"width": 1280, "height": 900},
        )
        page = context.new_page()

        def js_click(sel):
            return page.evaluate(_JS_CLICK_SEL, sel)

        try:
            if not COOKIE_PATH.exists():
                print(json.dumps({"error": "먼저 naver_login_setup을 실행하세요."}))
                sys.exit(1)

            cookies = json.loads(COOKIE_PATH.read_text(encoding="utf-8"))
            context.add_cookies(cookies)

            page.goto(f"https://blog.naver.com/{blog_id}", wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            page.goto(f"https://blog.naver.com/{blog_id}/postwrite", wait_until="domcontentloaded")

            if "nidlogin" in page.url or "login.naver" in page.url:
                COOKIE_PATH.unlink(missing_ok=True)
                print(json.dumps({"error": "세션 만료. naver_login_setup을 다시 실행하세요."}))
                sys.exit(1)

            try:
                page.locator("button:has-text('발행')").wait_for(timeout=30_000)
            except PWTimeout:
                print(json.dumps({"error": "에디터 로드 타임아웃."}))
                sys.exit(1)
            page.wait_for_timeout(3000)
            page.bring_to_front()

            if page.locator(".se-popup-alert-confirm").count() > 0:
                page.locator(".se-popup-alert-confirm button").first.click(force=True)
                page.wait_for_timeout(1200)
                try:
                    page.locator(".se-popup-alert-confirm").wait_for(state="hidden", timeout=5000)
                except PWTimeout:
                    pass

            if page.locator(".se-help-panel-close-button").count() > 0:
                page.locator(".se-help-panel-close-button").click(force=True)
                page.wait_for_timeout(500)

            page.wait_for_timeout(600)

            TITLE_SELECTORS = [
                ".se-title-input",
                "p.se-title-input[contenteditable]",
                ".se-section-title p[contenteditable]",
                "[data-placeholder*='제목']",
                "[contenteditable][class*='title']",
            ]

            for sel in TITLE_SELECTORS:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.click(force=True)
                    page.wait_for_timeout(600)
                    break
            else:
                page.mouse.click(640, 200)
                page.wait_for_timeout(600)

            page.keyboard.press("Control+a")
            page.wait_for_timeout(200)
            paste_text(page, title)
            page.wait_for_timeout(600)

            BODY_SELECTORS = [
                ".se-section-text p[contenteditable]",
                ".se-text-paragraph[contenteditable]",
                ".se-component-content p[contenteditable]",
                ".se-content-editor[contenteditable]",
                "div.se-main-container [contenteditable='true']",
            ]

            for sel in BODY_SELECTORS:
                loc = page.locator(sel)
                if loc.count() > 0:
                    loc.first.click(force=True)
                    page.wait_for_timeout(600)
                    break
            else:
                page.mouse.click(640, 420)
                page.wait_for_timeout(600)

            # 이미지 삽입 (본문 첫 단락 앞)
            if image_path:
                insert_image(page, image_path)
                page.wait_for_timeout(800)
                # 본문 영역 재포커스
                for sel in BODY_SELECTORS:
                    loc = page.locator(sel)
                    if loc.count() > 0:
                        loc.last.click(force=True)
                        page.wait_for_timeout(400)
                        break

            prev_kind = None
            for kind, text in segments:
                if kind == "blank":
                    if prev_kind == "body":
                        page.keyboard.press("Enter")
                        page.wait_for_timeout(80)
                    prev_kind = "blank"
                    continue
                elif kind == "subheading":
                    page.keyboard.press("Control+b")
                    time.sleep(0.15)
                    paste_text(page, text)
                    time.sleep(0.1)
                    page.keyboard.press("Control+b")
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(150)
                else:
                    paste_text(page, text)
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(120)
                prev_kind = kind

            page.wait_for_timeout(500)

            if tags:
                TAG_SELECTORS = [
                    ".se-tag-input",
                    "input[placeholder*='태그']",
                    ".se-module-tag input",
                    "[class*='tag'] input",
                    ".se-tag-area input",
                ]
                tag_field_found = False
                for sel in TAG_SELECTORS:
                    loc = page.locator(sel)
                    if loc.count() > 0:
                        loc.first.click()
                        page.wait_for_timeout(300)
                        for tag in tags:
                            paste_text(page, tag)
                            page.keyboard.press("Enter")
                            page.wait_for_timeout(150)
                        tag_field_found = True
                        break
                if not tag_field_found:
                    page.keyboard.press("Enter")
                    paste_text(page, " ".join(f"#{t}" for t in tags))

            page.wait_for_timeout(1000)

            clicked = page.evaluate("""() => {
                let el = document.querySelector("button[data-click-area='tpb.publish']");
                if (el) { el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return 'data-attr'; }
                const btns = [...document.querySelectorAll('button')];
                el = btns.find(b => b.innerText.trim() === '발행');
                if (el) { el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return 'exact-text'; }
                el = btns.find(b => b.innerText.trim().includes('발행'));
                if (el) { el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return 'includes-text'; }
                return null;
            }""")
            page.wait_for_timeout(3000)

            page.evaluate("""() => {
                const btns = [...document.querySelectorAll('button')];
                let el = btns.find(b => b.innerText.trim().includes('발행하기'));
                if (el) { el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return; }
                const matching = btns.filter(b => b.innerText.trim() === '발행');
                if (matching.length > 1) { matching[matching.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return; }
                if (matching.length === 1) { matching[0].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); return; }
                el = btns.find(b => b.innerText.trim() === '확인');
                if (el) { el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); }
            }""")

            page.wait_for_timeout(5000)

            post_url = page.url
            if "postwrite" in post_url or not post_url.startswith("https://blog.naver.com"):
                post_url = f"https://blog.naver.com/{blog_id}"

            print(json.dumps({"url": post_url}))

        except (SystemExit, json.JSONDecodeError):
            raise
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
