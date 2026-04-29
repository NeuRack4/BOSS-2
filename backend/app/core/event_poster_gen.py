"""이벤트·프로모션 포스터 HTML 생성 — GPT-4o로 standalone HTML 작성 + Supabase Storage 저장.

흐름:
  1. 이벤트 제목·내용·스타일 힌트를 GPT-4o에 전달해 완전한 HTML(<!DOCTYPE..></html>) 수신.
  2. Supabase Storage `event-posters` 버킷에 .html 업로드 (public URL 확보).
  3. artifact 저장: type='event_poster', domain='marketing',
     content에 HTML 전문, metadata.public_url / storage_path / format='html'.
  4. 이벤트 기획안(source_artifact_id)이 있으면 derives_from 엣지 추가.
"""

from __future__ import annotations

import logging
import re
import uuid

from app.core.config import settings
from app.core.llm import chat_completion
from app.core.supabase import get_supabase

log = logging.getLogger("boss2.event_poster_gen")

_BUCKET = "event-posters"

_SYSTEM_PROMPT = """당신은 한국 소상공인 이벤트 포스터 디자인 전문가입니다.
주어진 이벤트 정보를 바탕으로 **인쇄 가능한 standalone HTML 이벤트 포스터 1페이지**를 만들어주세요.

규칙:
- <!DOCTYPE html>부터 </html>까지 완전한 standalone HTML.
- 외부 CDN·이미지·폰트 로드 없음. 모든 CSS는 <style> 블록으로 인라인.
- 폰트: system-ui, -apple-system, 'Pretendard', 'Apple SD Gothic Neo', sans-serif.
- A4 세로(210mm × 297mm) 기준. body에 width: 794px, min-height: 1123px, margin: 0 auto 설정.
- `@media print { @page { size: A4 portrait; margin: 0; } body { width: 210mm; } }` 포함.
- 모던하고 눈에 띄는 디자인. 이벤트명·날짜·혜택이 한눈에 드러나야 함.
- 색상: 사용자 스타일 힌트를 따르되, 기본은 선명한 포인트 컬러(그라데이션 헤더) + 화이트 바탕.
- 이벤트 성격에 맞는 이모지를 제목·혜택에 적극 활용.
- 중요 정보(날짜·혜택)는 박스/배지로 강조. 읽기 쉬운 정보 계층 우선.
- 출력은 **HTML 코드만**. 설명, 주석, ```html 블록 금지."""


def _build_user_prompt(
    *,
    event_title: str,
    event_content: str,
    style_prompt: str,
) -> str:
    style = style_prompt.strip() or "밝고 활기찬 톤, 선명한 포인트 컬러, 현대적 레이아웃"
    return (
        f"[디자인 스타일] {style}\n\n"
        f"[이벤트명]\n{event_title}\n\n"
        f"[이벤트 내용]\n{event_content[:3000]}\n\n"
        "위 정보를 모두 반영한 이벤트 포스터 HTML을 만들어 출력하세요."
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


def _storage_key(account_id: str) -> str:
    return f"{account_id}/{uuid.uuid4().hex}.html"


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


async def generate_event_poster(
    *,
    account_id: str,
    event_title: str,
    event_content: str,
    style_prompt: str = "",
    source_artifact_id: str | None = None,
) -> dict:
    """이벤트 포스터 HTML 생성 + Storage 업로드 + artifact 저장.

    반환: { artifact_id, html, title, public_url }
    """
    sb = get_supabase()

    # 1. GPT-4o로 HTML 생성
    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(
                    event_title=event_title,
                    event_content=event_content,
                    style_prompt=style_prompt,
                )},
            ],
            max_tokens=4000,
            temperature=0.4,
        )
    except Exception as exc:
        log.exception("event poster LLM call failed")
        raise RuntimeError(f"포스터 생성 실패: {str(exc)[:160]}") from exc

    raw = resp.choices[0].message.content or ""
    html = _extract_html(raw)
    if not html or "<html" not in html.lower():
        raise RuntimeError("HTML 생성 결과가 유효하지 않습니다 (<html> 태그 누락).")

    # 2. Storage 업로드
    storage_path = _storage_key(account_id)
    try:
        sb.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=html.encode("utf-8"),
            file_options={"content-type": "text/html; charset=utf-8", "upsert": "false"},
        )
    except Exception as exc:
        raise RuntimeError(
            f"Storage 업로드 실패: {str(exc)[:160]} "
            f"(버킷 '{_BUCKET}'이 존재하는지 확인하세요)"
        ) from exc

    public_url = _public_url(storage_path)

    # 3. artifact 저장
    poster_title = f"{event_title} — 이벤트 포스터"
    metadata: dict = {
        "bucket": _BUCKET,
        "storage_path": storage_path,
        "public_url": public_url,
        "format": "html",
        "model": settings.openai_chat_model,
        "style_prompt": style_prompt[:500],
    }
    if source_artifact_id:
        metadata["source_artifact_id"] = source_artifact_id

    insert = (
        sb.table("artifacts")
        .insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "event_poster",
            "title": poster_title[:180],
            "content": html,
            "status": "active",
            "metadata": metadata,
        })
        .execute()
    )
    if not insert.data:
        raise RuntimeError("event_poster artifact 저장 실패")
    artifact_id = insert.data[0]["id"]

    # 4. derives_from 엣지 (이벤트 기획안이 있으면)
    if source_artifact_id:
        try:
            sb.table("artifact_edges").insert({
                "account_id": account_id,
                "parent_id": source_artifact_id,
                "child_id": artifact_id,
                "relation": "derives_from",
            }).execute()
        except Exception:
            log.exception("derives_from edge insert failed")

    # 5. activity_logs + 임베딩 (best-effort)
    try:
        sb.table("activity_logs").insert({
            "account_id": account_id,
            "type": "artifact_created",
            "domain": "marketing",
            "title": poster_title,
            "description": f"이벤트 포스터 HTML 생성: {event_title}",
            "metadata": {"artifact_id": artifact_id, **metadata},
        }).execute()
    except Exception:
        pass
    try:
        from app.rag.embedder import index_artifact
        await index_artifact(account_id, "marketing", artifact_id, f"{poster_title}\n{event_title}")
    except Exception:
        pass
    try:
        from app.memory.long_term import log_artifact_to_memory
        await log_artifact_to_memory(
            account_id, "marketing", "event_poster", poster_title,
            content=event_title,
            metadata=metadata,
        )
    except Exception:
        pass

    return {
        "artifact_id": artifact_id,
        "html": html,
        "title": poster_title,
        "public_url": public_url,
    }
