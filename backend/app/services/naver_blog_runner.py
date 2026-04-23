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


def insert_image_by_file(page, image_url: str) -> bool:
    """이미지 URL을 임시 파일로 다운로드 후 SE One 에디터에 파일 업로드 방식으로 삽입.
    Playwright expect_file_chooser()로 OS 파일 다이얼로그를 인터셉트하므로 팝업이 사용자에게 보이지 않는다.
    """
    import tempfile
    import urllib.request
    import os

    # 1. URL에서 이미지 다운로드
    suffix = ".png" if image_url.lower().endswith(".png") else ".jpg"
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    os.close(tmp_fd)
    try:
        req = urllib.request.Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            with open(tmp_path, "wb") as f:
                f.write(resp.read())
    except Exception:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        return False

    try:
        # 2. 이미지 툴바 버튼 클릭
        clicked = page.evaluate("""() => {
            const selectors = [
                'button[data-name="image"]',
                '.se-toolbar button[title*="사진"]',
                '.se-toolbar button[title*="이미지"]',
                '.se-toolbar button[title*="Image"]',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) { el.dispatchEvent(new MouseEvent('click', {bubbles:true})); return sel; }
            }
            const btns = [...document.querySelectorAll('.se-toolbar button')];
            const btn = btns.find(b =>
                b.title?.includes('사진') || b.title?.includes('이미지') ||
                b.title?.toLowerCase().includes('image')
            );
            if (btn) { btn.dispatchEvent(new MouseEvent('click', {bubbles:true})); return 'found'; }
            return null;
        }""")
        if not clicked:
            return False
        time.sleep(1.2)

        # 3. 파일 선택 인터셉트 → '내 컴퓨터' or file input 클릭
        from playwright.sync_api import TimeoutError as PWTimeout
        try:
            with page.expect_file_chooser(timeout=8000) as fc_info:
                page.evaluate("""() => {
                    // '내 컴퓨터' 탭/버튼 클릭
                    const popupEls = [...document.querySelectorAll(
                        '.se-popup button, .se-popup li, .se-popup [role="tab"], .se-popup label'
                    )];
                    const pcBtn = popupEls.find(el => {
                        const t = (el.innerText || el.textContent || '').trim();
                        return t.includes('내 컴퓨터') || t === 'PC' || t.includes('파일');
                    });
                    if (pcBtn) { pcBtn.click(); return; }
                    // 팝업 내 file input 직접 클릭
                    const fi = document.querySelector('.se-popup input[type="file"]');
                    if (fi) { fi.click(); return; }
                    // 전체 페이지에서 file input 탐색
                    const allFi = document.querySelector('input[type="file"]');
                    if (allFi) { allFi.click(); }
                }""")
            file_chooser = fc_info.value
            file_chooser.set_files(tmp_path)
            time.sleep(2.5)
            return True
        except PWTimeout:
            # file chooser 타임아웃 → 팝업 닫기
            for close_sel in [".se-popup-button-cancel", "button:has-text('취소')", ".se-popup-close"]:
                try:
                    cl = page.locator(close_sel)
                    if cl.count() > 0:
                        cl.first.click(force=True)
                        break
                except Exception:
                    pass
            return False

    except Exception:
        return False
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def main():
    data = json.loads(sys.stdin.read())
    content = data["content"]
    blog_id = data["blog_id"]
    title_override = data.get("title", "")
    tags_override = data.get("tags", [])
    image_urls = data.get("image_urls", [])

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

            # 이미지 삽입 (본문 첫 단락 앞, 파일 업로드 방식)
            if image_urls:
                for img_url in image_urls:
                    inserted = insert_image_by_file(page, img_url)
                    page.wait_for_timeout(600)
                    if inserted:
                        # 삽입 후 본문 영역 재포커스
                        for sel in BODY_SELECTORS:
                            loc = page.locator(sel)
                            if loc.count() > 0:
                                loc.last.click(force=True)
                                page.wait_for_timeout(400)
                                break
                        page.keyboard.press("Enter")
                        page.wait_for_timeout(200)

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
