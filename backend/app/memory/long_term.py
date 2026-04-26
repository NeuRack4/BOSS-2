"""Long-term memory — 도메인×일자(KST) digest 기반 (v1.3).

저장 경로:
    - artifact 생성 시 `log_artifact_to_memory(...)` — 도메인별 일일 digest 에 누적.
      gpt-4o-mini 로 2~3문장 요약을 생성하고 기존 해당 날짜 digest 에 append 한 뒤 전체 재임베딩.
      `upsert_memory_long` RPC 가 (account_id, domain, digest_date) partial unique 로 upsert.
    - 세션 압축(compressor) 은 `save_memory(...)` — domain/digest_date 없이 일반 insert.
    - 사용자 Boost/Evaluations 는 각 라우터가 insert (domain/digest_date 없이).

Recall:
    - `memory_search` RPC — 7일 이내 + vector RRF + FTS RRF + importance 곱셈 가중.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.core.embedder import embed_text
from app.core.llm import chat_completion
from app.core.supabase import get_supabase

log = logging.getLogger("boss2.memory")

KST = ZoneInfo("Asia/Seoul")

_SUMMARY_MODEL = "gpt-4o-mini"

# metadata 에서 요약용으로 추출할 키들 (도메인 무관 공용)
_SUMMARY_META_KEYS = (
    "contract_subtype", "due_date", "due_label", "start_date", "end_date",
    "amount", "total_amount", "category", "platform", "gap_ratio", "eul_ratio",
    "user_role", "subsidy_name", "application_type", "doc_kind", "pay_month",
    "target_year", "period", "evaluatee", "headcount", "position",
)


def _today_kst() -> date:
    return datetime.now(KST).date()


def _time_label_kst() -> str:
    """HH:MM (KST) — digest 안의 이벤트 시각 표기."""
    return datetime.now(KST).strftime("%H:%M")


def _date_label_kst(d: date) -> str:
    """YYYY년 MM월 DD일 (KST) — digest 헤더용."""
    return f"{d.year}년 {d.month:02d}월 {d.day:02d}일 (KST)"


async def _summarize_event(
    domain: str,
    artifact_type: str,
    title: str,
    content: str | None = None,
    metadata: dict | None = None,
) -> str:
    """gpt-4o-mini 로 artifact 이벤트를 2~3문장 한국어로 요약.

    실패 시 title 로 폴백 (LLM 호출 실패가 memory 저장을 막지 않도록).
    """
    body_preview = (content or "").strip()[:1000]
    meta_parts: list[str] = []
    if metadata:
        for k in _SUMMARY_META_KEYS:
            v = metadata.get(k)
            if v is None or v == "":
                continue
            if isinstance(v, (dict, list)):
                continue
            meta_parts.append(f"{k}={v}")
    meta_str = "; ".join(meta_parts) or "없음"

    prompt = (
        "다음 artifact 를 2~3문장 한국어 평문으로 요약하세요. "
        "나중에 RAG recall 에 쓰이니 핵심 정보(대상·숫자·날짜·의도)를 담고, "
        "마크다운/리스트/이모지 금지.\n\n"
        f"- 도메인: {domain}\n"
        f"- 타입: {artifact_type}\n"
        f"- 제목: {title}\n"
        f"- 메타: {meta_str}\n"
        f"- 본문 앞부분: {body_preview or '없음'}\n"
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


async def save_memory(
    account_id: str,
    content: str,
    importance: float = 1.0,
    *,
    domain: str | None = None,
    digest_date: str | None = None,
    max_chars: int = 300,
) -> None:
    """범용 장기기억 저장.

    - domain/digest_date 모두 있으면 `upsert_memory_long` RPC 로 도메인-일자 digest upsert.
    - 둘 중 하나라도 없으면 일반 insert (compressor 요약·evaluations 등).
    - Compressor 메모리(domain=None)는 max_chars 초과시 압축, digest(domain!=None)는 압축 안 함.
    """
    final_content = content
    if not domain and len(content) > max_chars:
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
        emb_list = embed_text(final_content)
        emb_str = "[" + ",".join(f"{v:.10f}" for v in emb_list) + "]"
    except Exception:
        log.exception("[memory] embed_text failed — skipping save (account=%s domain=%s)", account_id, domain)
        return

    sb = get_supabase()
    if domain and digest_date:
        try:
            sb.rpc("upsert_memory_long", {
                "p_account_id":  account_id,
                "p_domain":      domain,
                "p_digest_date": digest_date,
                "p_content":     final_content,
                "p_embedding":   emb_str,
                "p_importance":  importance,
            }).execute()
            log.debug("[memory] upsert_memory_long ok account=%s domain=%s date=%s", account_id, domain, digest_date)
        except Exception:
            log.exception("[memory] upsert_memory_long failed account=%s domain=%s date=%s", account_id, domain, digest_date)
        return

    try:
        sb.table("memory_long").insert({
            "account_id": account_id,
            "content":    final_content,
            "embedding":  emb_str,
            "importance": importance,
        }).execute()
        log.debug("[memory] insert ok account=%s", account_id)
    except Exception:
        log.exception("[memory] insert failed account=%s", account_id)


async def log_artifact_to_memory(
    account_id: str,
    domain: str,
    artifact_type: str,
    title: str,
    content: str | None = None,
    metadata: dict | None = None,
) -> None:
    """artifact 생성 시 **도메인×오늘(KST) digest** 에 누적 요약 저장.

    동일 계정·도메인·날짜에 이미 row 가 있으면 요약을 append 해서 upsert 한다.
    전체 content 를 재임베딩하므로 recall 품질이 유지된다.
    """
    today = _today_kst()
    digest_date = today.isoformat()
    time_label = _time_label_kst()

    summary = await _summarize_event(domain, artifact_type, title, content, metadata)
    new_line = f"- [{time_label}] {artifact_type} '{title}' — {summary}"

    sb = get_supabase()
    existing = (
        sb.table("memory_long")
        .select("id,content")
        .eq("account_id", account_id)
        .eq("domain", domain)
        .eq("digest_date", digest_date)
        .limit(1)
        .execute()
        .data
        or []
    )

    if existing:
        full_content = (existing[0]["content"] or "").rstrip() + "\n" + new_line
    else:
        header = f"[{domain}] {_date_label_kst(today)}"
        full_content = header + "\n" + new_line

    try:
        await save_memory(
            account_id,
            full_content,
            importance=2.0,
            domain=domain,
            digest_date=digest_date,
        )
    except Exception:
        log.exception("[memory] log_artifact_to_memory save failed account=%s domain=%s", account_id, domain)


async def recall(account_id: str, query: str, limit: int = 5) -> list[dict]:
    """장기기억 recall — RRF(vector + FTS) × importance, 7일 recency 필터.

    Returns:
        [{id, content, importance, similarity, rrf_score, domain, digest_date, created_at}, ...]
    """
    try:
        emb_list = embed_text(query)
        emb_str = "[" + ",".join(f"{v:.10f}" for v in emb_list) + "]"
    except Exception:
        log.exception("[memory] recall embed_text failed account=%s", account_id)
        return []
    sb = get_supabase()
    try:
        result = sb.rpc("memory_search", {
            "p_account_id": account_id,
            "p_embedding":  emb_str,
            "p_query_text": query or "",
            "p_limit":      limit,
        }).execute()
        data = result.data or []
        for item in data:
            item["content"] = (item.get("content") or "")[:200]
        return data
    except Exception:
        return []
