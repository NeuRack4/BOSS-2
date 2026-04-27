"""Long-term memory v2.0 — 1 artifact = 1 markdown row + 자동 압축.

저장:
    - artifact 생성 시 `log_artifact_to_memory(...)` → 개별 markdown row insert.
      gpt-4o-mini 2~3문장 요약 → markdown 포맷 저장.
      도메인별 비압축 row 20개 초과 시 `_maybe_compress()` 자동 호출.
    - 세션 압축(compressor) / evaluations → `save_memory(...)` 단순 insert.

Recall:
    - `memory_search` RPC — 비압축 row: 7일 TTL, 압축 row: TTL 없음.
      vector RRF + FTS RRF × importance 가중.

저장 포맷 (단일 artifact):
    ## [domain] artifact_type — YYYY-MM-DD HH:MM
    **제목**: 제목
    요약 2~3문장

압축 포맷:
    ## [domain] 압축 요약 — YYYY-MM-DD ~ YYYY-MM-DD
    압축 요약문
    총 N개 기록 압축
"""
from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.embedder import embed_text
from app.core.llm import chat_completion
from app.core.supabase import get_supabase

log = logging.getLogger("boss2.memory")

KST = ZoneInfo("Asia/Seoul")

_SUMMARY_MODEL = "gpt-4o-mini"
_COMPRESS_THRESHOLD = 20  # 도메인별 비압축 row 수 초과 시 압축
_COMPRESS_KEEP = 10       # 압축 후 유지할 최신 row 수

_SUMMARY_META_KEYS = (
    "contract_subtype", "due_date", "due_label", "start_date", "end_date",
    "amount", "total_amount", "category", "platform", "gap_ratio", "eul_ratio",
    "user_role", "subsidy_name", "application_type", "doc_kind", "pay_month",
    "target_year", "period", "evaluatee", "headcount", "position",
)


def _now_kst() -> datetime:
    return datetime.now(KST)


def _emb_str(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.10f}" for v in vec) + "]"


async def _summarize_event(
    domain: str,
    artifact_type: str,
    title: str,
    content: str | None = None,
    metadata: dict | None = None,
) -> str:
    """artifact를 2~3문장 한국어 평문으로 요약. 실패 시 title 폴백."""
    body_preview = (content or "").strip()[:1000]
    meta_parts: list[str] = []
    if metadata:
        for k in _SUMMARY_META_KEYS:
            v = metadata.get(k)
            if v is None or v == "" or isinstance(v, (dict, list)):
                continue
            meta_parts.append(f"{k}={v}")
    meta_str = "; ".join(meta_parts) or "없음"

    prompt = (
        "다음 artifact 를 2~3문장 한국어 평문으로 요약하세요. "
        "RAG recall 에 쓰이니 핵심 정보(대상·숫자·날짜·의도)를 담고, "
        "마크다운/리스트/이모지 금지.\n\n"
        f"- 도메인: {domain}\n"
        f"- 타입: {artifact_type}\n"
        f"- 제목: {title}\n"
        f"- 메타: {meta_str}\n"
        f"- 본문: {body_preview or '없음'}\n"
    )
    try:
        resp = await chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=_SUMMARY_MODEL,
            max_tokens=200,
            temperature=0.3,
        )
        text = (resp.choices[0].message.content or "").strip()
        return text[:500] if text else title
    except Exception:
        return title


def _build_artifact_md(
    domain: str,
    artifact_type: str,
    title: str,
    summary: str,
    dt: datetime,
) -> str:
    date_str = dt.strftime("%Y-%m-%d")
    time_str = dt.strftime("%H:%M")
    return (
        f"## [{domain}] {artifact_type} — {date_str} {time_str}\n"
        f"**제목**: {title}\n"
        f"{summary}"
    )


async def _compress_batch(domain: str, rows: list[dict]) -> str:
    """여러 row를 하나의 요약문으로 압축. 실패 시 제목 목록 폴백."""
    lines: list[str] = []
    for r in rows:
        t = r.get("event_time") or r.get("created_at") or ""
        dt_str = t[:16].replace("T", " ") if t else "??"
        first_line = (r.get("content") or "").split("\n")[0].lstrip("# ").strip()
        lines.append(f"- {dt_str} {first_line}")

    batch_text = "\n".join(lines)
    prompt = (
        f"다음은 [{domain}] 도메인의 과거 활동 기록입니다. "
        "핵심 내용을 보존하면서 간결한 한국어 요약문으로 압축하세요. "
        "마크다운/이모지 금지. 300자 이내.\n\n" + batch_text
    )
    try:
        resp = await chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=_SUMMARY_MODEL,
            max_tokens=300,
            temperature=0.3,
        )
        return (resp.choices[0].message.content or "").strip()[:600]
    except Exception:
        return batch_text[:600]


async def _maybe_compress(account_id: str, domain: str) -> None:
    """도메인별 비압축 row가 임계값 초과 시 오래된 것들을 자동 압축."""
    sb = get_supabase()
    try:
        rows = (
            sb.table("memory_long")
            .select("id,content,event_time,created_at")
            .eq("account_id", account_id)
            .eq("domain", domain)
            .eq("is_compressed", False)
            .order("event_time", desc=False)
            .execute()
            .data
            or []
        )
    except Exception:
        log.exception("[memory] compress query failed account=%s domain=%s", account_id, domain)
        return

    if len(rows) <= _COMPRESS_THRESHOLD:
        return

    to_compress = rows[:-_COMPRESS_KEEP]
    if not to_compress:
        return

    def _date_of(r: dict) -> str:
        t = r.get("event_time") or r.get("created_at") or ""
        return t[:10] if t else "??"

    start_date = _date_of(to_compress[0])
    end_date = _date_of(to_compress[-1])

    summary = await _compress_batch(domain, to_compress)
    compressed_md = (
        f"## [{domain}] 압축 요약 — {start_date} ~ {end_date}\n"
        f"{summary}\n"
        f"총 {len(to_compress)}개 기록 압축"
    )

    try:
        vec = embed_text(compressed_md)
    except Exception:
        log.exception("[memory] compress embed failed account=%s domain=%s", account_id, domain)
        return

    now_iso = _now_kst().isoformat()
    try:
        sb.table("memory_long").insert({
            "account_id":    account_id,
            "content":       compressed_md,
            "embedding":     _emb_str(vec),
            "importance":    2.0,
            "domain":        domain,
            "is_compressed": True,
            "event_time":    now_iso,
        }).execute()
    except Exception:
        log.exception("[memory] compressed insert failed account=%s domain=%s", account_id, domain)
        return

    ids = [r["id"] for r in to_compress]
    try:
        sb.table("memory_long").delete().in_("id", ids).execute()
        log.info("[memory] compressed %d→1 account=%s domain=%s", len(ids), account_id, domain)
    except Exception:
        log.exception("[memory] compressed delete failed account=%s domain=%s", account_id, domain)


async def log_artifact_to_memory(
    account_id: str,
    domain: str,
    artifact_type: str,
    title: str,
    content: str | None = None,
    metadata: dict | None = None,
) -> None:
    """artifact 생성 시 개별 markdown row로 장기기억 저장.

    20개 초과 시 _maybe_compress() 자동 호출.
    """
    now = _now_kst()
    summary = await _summarize_event(domain, artifact_type, title, content, metadata)
    md = _build_artifact_md(domain, artifact_type, title, summary, now)

    try:
        vec = embed_text(md)
    except Exception:
        log.exception("[memory] embed failed account=%s domain=%s", account_id, domain)
        return

    sb = get_supabase()
    try:
        sb.table("memory_long").insert({
            "account_id":    account_id,
            "content":       md,
            "embedding":     _emb_str(vec),
            "importance":    2.0,
            "domain":        domain,
            "artifact_type": artifact_type,
            "event_time":    now.isoformat(),
            "is_compressed": False,
        }).execute()
        log.debug("[memory] insert ok account=%s domain=%s type=%s", account_id, domain, artifact_type)
    except Exception:
        log.exception("[memory] insert failed account=%s domain=%s", account_id, domain)
        return

    await _maybe_compress(account_id, domain)


async def save_memory(
    account_id: str,
    content: str,
    importance: float = 1.0,
    *,
    domain: str | None = None,
    digest_date: str | None = None,
    max_chars: int = 300,
) -> None:
    """범용 장기기억 저장 (compressor / evaluations 전용).

    domain/digest_date 파라미터는 하위 호환용으로 서명 유지, 내부적으로 무시됨.
    """
    final_content = content
    if len(content) > max_chars:
        try:
            final_content = await _summarize_event(
                domain="memory",
                artifact_type="session_summary",
                title="세션 요약",
                content=content,
            )
        except Exception:
            final_content = content[:max_chars]

    try:
        vec = embed_text(final_content)
    except Exception:
        log.exception("[memory] save_memory embed failed account=%s", account_id)
        return

    sb = get_supabase()
    try:
        sb.table("memory_long").insert({
            "account_id": account_id,
            "content":    final_content,
            "embedding":  _emb_str(vec),
            "importance": importance,
        }).execute()
        log.debug("[memory] save_memory ok account=%s", account_id)
    except Exception:
        log.exception("[memory] save_memory failed account=%s", account_id)


async def recall(account_id: str, query: str, limit: int = 5) -> list[dict]:
    """장기기억 recall — RRF(vector + FTS) × importance."""
    try:
        vec = embed_text(query)
    except Exception:
        log.exception("[memory] recall embed failed account=%s", account_id)
        return []

    sb = get_supabase()
    try:
        result = sb.rpc("memory_search", {
            "p_account_id": account_id,
            "p_embedding":  _emb_str(vec),
            "p_query_text": query or "",
            "p_limit":      limit,
        }).execute()
        data = result.data or []
        for item in data:
            item["content"] = (item.get("content") or "")[:200]
        return data
    except Exception:
        return []
