"""채용공고 HTML 포스터 생성 — GPT-4o 로 standalone HTML 작성 + 이중 저장.

흐름:
  1. 대상 `job_posting_set` artifact 에서 제목/본문 추출.
  2. GPT-4o 에 포스터 디자인 프롬프트 + 본문을 넘겨 완전한 HTML(<!DOCTYPE..></html>) 수신.
  3. Supabase Storage `recruitment-posters` 버킷에 `.html` 업로드 (public URL 확보).
  4. artifact 저장: `type='job_posting_poster'`, `content` 에 HTML 전문,
     `metadata.public_url / storage_path / for_platform / format='html'`.
  5. 부모 세트와 `derives_from` 엣지 + activity_logs + 임베딩.

DALL-E 를 걷어낸 이유: 한국어 텍스트 렌더링이 구조적으로 약해 오타/깨짐 빈발.
HTML 은 폰트·레이아웃을 정확히 보장하고, 프론트에서 iframe srcDoc 으로 바로 렌더 가능.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Literal

from app.agents._recruit_templates import PLATFORM_LABELS, VALID_PLATFORMS
from app.core.config import settings
from app.core.llm import chat_completion
from app.core.supabase import get_supabase

log = logging.getLogger("boss2.poster_gen")

_BUCKET = "recruitment-posters"

_SYSTEM_PROMPT = """당신은 한국 소상공인 채용공고 디자인 전문가입니다.
주어진 채용 정보를 바탕으로 **인쇄 가능한 standalone HTML 채용공고 1페이지**를 만들어주세요.

규칙:
- <!DOCTYPE html> 부터 </html> 까지 완전한 standalone HTML.
- 외부 CDN·이미지·폰트 로드 없음. 모든 CSS 는 <style> 블록으로 인라인.
- 폰트: system-ui, -apple-system, 'Pretendard', 'Apple SD Gothic Neo', sans-serif.
- A4 기준 한 페이지. `@media print { @page { size: A4; margin: 0; } }` 포함.
- 모던·깔끔. 제목 / 시급 / 근무시간 / 근무지 / CTA 가 한눈에 드러나야 함.
- 플랫폼별 권장 비율:
  * karrot(당근알바) · albamon(알바천국): 1:1 정사각 또는 세로 4:5 (SNS/피드)
  * saramin(사람인): 가로 3:2 (배너/채용사이트)
- 과한 이모지·gradient·애니메이션 금지. 읽기 쉬운 정보 계층 우선.
- 출력은 **HTML 코드만**. 설명, 주석, ```html 블록 금지."""


def _build_user_prompt(
    *,
    platform: str,
    posting_title: str,
    content_snippet: str,
    style_prompt: str,
) -> str:
    label = PLATFORM_LABELS.get(platform, platform)
    base_style = style_prompt.strip() or "모던하고 따뜻한 톤, 브라운·베이지 파스텔 계열, 미니멀"
    return (
        f"[플랫폼] {label}\n"
        f"[디자인 스타일] {base_style}\n\n"
        f"[세트 제목]\n{posting_title}\n\n"
        f"[공고 본문]\n{content_snippet[:3000]}\n\n"
        "위 정보를 모두 반영한 채용공고 포스터 HTML 을 만들어 출력하세요."
    )


def _extract_html(raw: str) -> str:
    """LLM 응답에서 HTML 블록만 추출."""
    m = re.search(r"```html\s*([\s\S]*?)```", raw)
    if m:
        return m.group(1).strip()
    m = re.search(r"```\s*([\s\S]*?)```", raw)
    if m and "<html" in m.group(1).lower():
        return m.group(1).strip()
    return raw.strip()


def _storage_key(account_id: str, platform: str) -> str:
    return f"{account_id}/{platform}-{uuid.uuid4().hex}.html"


def _public_url(storage_path: str) -> str:
    sb = get_supabase()
    try:
        res = sb.storage.from_(_BUCKET).get_public_url(storage_path)
        if isinstance(res, str):
            return res
        if isinstance(res, dict):
            return (res.get("publicUrl") or res.get("publicURL") or "").rstrip("?")
    except Exception:
        pass
    return f"{settings.supabase_url}/storage/v1/object/public/{_BUCKET}/{storage_path}"


Platform = Literal["karrot", "albamon", "saramin"]


async def generate_job_posting_poster(
    *,
    account_id: str,
    posting_set_id: str,
    platform: Platform = "karrot",
    style_prompt: str = "",
) -> dict:
    """메인 진입점 — GPT-4o 로 HTML 생성 + Storage 업로드 + artifact 저장.

    반환: { artifact_id, storage_path, public_url, platform, posting_set_id }
    """
    if platform not in VALID_PLATFORMS:
        platform = "karrot"

    sb = get_supabase()

    # 1. 부모 세트 로드
    rows = (
        sb.table("artifacts")
        .select("id,title,content,metadata")
        .eq("id", posting_set_id)
        .eq("account_id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise ValueError(f"posting_set {posting_set_id} 을(를) 찾을 수 없습니다.")
    parent = rows[0]
    title = parent.get("title") or "채용공고"
    content = parent.get("content") or ""

    # 2. GPT-4o 로 HTML 생성
    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(
                    platform=platform,
                    posting_title=title,
                    content_snippet=content,
                    style_prompt=style_prompt,
                )},
            ],
            max_tokens=4000,
            temperature=0.4,
        )
    except Exception as exc:
        log.exception("poster LLM call failed")
        raise RuntimeError(f"포스터 생성 실패: {str(exc)[:160]}") from exc

    raw = resp.choices[0].message.content or ""
    html = _extract_html(raw)
    if not html or "<html" not in html.lower():
        raise RuntimeError("HTML 생성 결과가 유효하지 않습니다 (<html> 태그 누락).")

    # 3. Storage 업로드
    storage_path = _storage_key(account_id, platform)
    try:
        sb.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=html.encode("utf-8"),
            file_options={"content-type": "text/html; charset=utf-8", "upsert": "false"},
        )
    except Exception as exc:
        raise RuntimeError(
            f"Storage 업로드 실패: {str(exc)[:160]} "
            f"(버킷 '{_BUCKET}' 이 존재하는지 확인하세요)"
        ) from exc

    public_url = _public_url(storage_path)

    # 4. artifact 저장 (content 에 HTML 전문)
    poster_title = f"{title} — {PLATFORM_LABELS[platform]} 포스터"
    metadata = {
        "bucket":         _BUCKET,
        "storage_path":   storage_path,
        "public_url":     public_url,
        "for_platform":   platform,
        "posting_set_id": posting_set_id,
        "format":         "html",
        "model":          settings.openai_chat_model,
        "style_prompt":   style_prompt[:500],
    }
    insert = (
        sb.table("artifacts")
        .insert({
            "account_id": account_id,
            "domains":    ["recruitment"],
            "kind":       "artifact",
            "type":       "job_posting_poster",
            "title":      poster_title[:180],
            "content":    html,
            "status":     "active",
            "metadata":   metadata,
        })
        .execute()
    )
    if not insert.data:
        raise RuntimeError("job_posting_poster artifact 저장 실패")
    artifact_id = insert.data[0]["id"]

    # 5. derives_from 엣지
    try:
        sb.table("artifact_edges").insert({
            "account_id": account_id,
            "parent_id":  posting_set_id,
            "child_id":   artifact_id,
            "relation":   "derives_from",
        }).execute()
    except Exception:
        log.exception("derives_from edge insert failed")

    # 6. activity_logs + 임베딩 (best-effort)
    try:
        sb.table("activity_logs").insert({
            "account_id":  account_id,
            "type":        "artifact_created",
            "domain":      "recruitment",
            "title":       poster_title,
            "description": f"채용공고 HTML 포스터 생성 ({PLATFORM_LABELS[platform]})",
            "metadata":    {"artifact_id": artifact_id, **metadata},
        }).execute()
    except Exception:
        pass
    try:
        from app.rag.embedder import index_artifact
        await index_artifact(account_id, "recruitment", artifact_id, f"{poster_title}\n{title}")
    except Exception:
        pass

    return {
        "artifact_id":    artifact_id,
        "storage_path":   storage_path,
        "public_url":     public_url,
        "platform":       platform,
        "posting_set_id": posting_set_id,
    }
