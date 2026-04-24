"""Sales RAG Retriever

과거 매출 데이터 임베딩(source_type='sales', vector 1024차원)에서
현재 질문과 유사한 컨텍스트를 꺼내온다.

embed_model: BAAI/bge-m3 (1024차원)
"""
from __future__ import annotations

import logging

from app.core.embedder import embed_text
from app.core.supabase import get_supabase

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn): return fn
        return _decorator

log = logging.getLogger(__name__)


@_traceable(name="sales._retriever.retrieve_sales_context")
async def retrieve_sales_context(
    account_id: str,
    query: str,
    top_k: int = 5,
) -> str:
    """질문과 유사한 과거 매출 데이터를 꺼내온다.

    Returns:
        검색 결과를 줄바꿈으로 이은 문자열.
        결과 없거나 에러 시 빈 문자열 반환.
    """
    try:
        query_vector = embed_text(query)

        sb = get_supabase()
        results = (
            sb.rpc("match_sales_embeddings", {
                "query_embedding": query_vector,
                "match_account_id": account_id,
                "match_count": top_k,
            })
            .execute()
            .data or []
        )

        log.info("[RAG] 검색 완료 | %d건 | query=%s", len(results), query[:40])

        if not results:
            return ""

        lines = ["[관련 과거 매출 데이터]"]
        for r in results:
            lines.append(f"- {r['content']}")

        return "\n".join(lines)

    except Exception as e:
        log.warning("[RAG] retrieve_sales_context 실패: %s", e)
        return ""
