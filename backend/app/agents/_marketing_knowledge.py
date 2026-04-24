"""마케팅 지식베이스 RAG 헬퍼 (BGE-M3 + RRF 하이브리드)

search_marketing_knowledge DB 함수를 통해
  - marketing_knowledge_chunks (소상공인보호법, 개인정보보호법)
  - subsidy_programs (정부 지원사업)
두 테이블을 벡터 + FTS RRF 병합 검색한다.

사용 (async):
  context = await marketing_knowledge_context(message)
  → 마케팅 에이전트 system 프롬프트에 주입할 컨텍스트 문자열
"""

from __future__ import annotations

import asyncio

from app.core.supabase import get_supabase
from app.core.embedder import embed_text


def _search_sync(query: str, match_count: int = 6) -> list[dict]:
    """BGE-M3로 쿼리를 임베딩 후 search_marketing_knowledge RPC 호출 (동기)."""
    embedding = embed_text(query)
    sb = get_supabase()
    try:
        result = sb.rpc(
            "search_marketing_knowledge",
            {
                "query_embedding": embedding,
                "query_text":      query,
                "match_count":     match_count,
            },
        ).execute()
        return result.data or []
    except Exception:
        return []


def search_subsidy_programs(query: str, max_results: int = 10) -> list[dict]:
    """지원사업만 필터해서 반환 (동기). GET /api/marketing/subsidies 전용."""
    rows = _search_sync(query, match_count=max_results * 2)
    subsidies = [r for r in rows if r.get("source_table") == "subsidy"]
    return subsidies[:max_results]


async def marketing_knowledge_context(message: str, match_count: int = 5) -> str:
    """
    마케팅 에이전트 system 프롬프트에 주입할 지식 컨텍스트 생성 (async).
    embed_text(BGE-M3)가 동기 함수이므로 asyncio.to_thread로 오프로드.

    - subsidy 결과 → [정부 지원사업] 섹션
    - knowledge 결과 → [관련 법령] 섹션
    관련 결과가 없으면 빈 문자열 반환.
    """
    rows = await asyncio.to_thread(_search_sync, message, match_count)
    if not rows:
        return ""

    subsidies = [r for r in rows if r.get("source_table") == "subsidy"]
    knowledge  = [r for r in rows if r.get("source_table") == "knowledge"]

    parts: list[str] = []

    if subsidies:
        lines = ["[정부 지원사업 정보 — 관련 있으면 자연스럽게 언급]"]
        for r in subsidies:
            lines.append(f"• {r['content'][:300]}")
        parts.append("\n".join(lines))

    if knowledge:
        lines = ["[관련 법령 참고]"]
        for r in knowledge:
            lines.append(f"• [{r['source_name']}] {r['content'][:200]}")
        parts.append("\n".join(lines))

    return "\n\n".join(parts)
