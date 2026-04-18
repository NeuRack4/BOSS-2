from app.core.embedder import embed_text
from app.core.supabase import get_supabase


async def hybrid_search(account_id: str, query: str, limit: int = 5) -> list[dict]:
    """RRF 하이브리드 서치 (pgvector + BM25) + 사용자 평가 가중치."""
    embedding = embed_text(query)
    sb = get_supabase()
    # 평가 boost 가 작용할 여지를 두고 넉넉히 가져온 뒤 정렬
    fetch_limit = max(limit * 3, 10)
    raw = (
        sb.rpc(
            "hybrid_search",
            {
                "p_account_id": account_id,
                "p_embedding": embedding,
                "p_query": query,
                "p_limit": fetch_limit,
            },
        )
        .execute()
        .data
        or []
    )

    if not raw:
        return []

    artifact_ids = [r.get("source_id") for r in raw if r.get("source_id")]
    rating_map: dict[str, str] = {}
    if artifact_ids:
        evals = (
            sb.table("evaluations")
            .select("artifact_id,rating")
            .eq("account_id", account_id)
            .in_("artifact_id", artifact_ids)
            .execute()
            .data
            or []
        )
        rating_map = {e["artifact_id"]: e["rating"] for e in evals}

    def boost_key(r: dict) -> tuple[int, float]:
        rt = rating_map.get(r.get("source_id"))
        # 0=up(맨 앞), 1=중립, 2=down(맨 뒤). 같은 그룹 내에선 RRF 점수 유지.
        if rt == "up":
            tier = 0
        elif rt == "down":
            tier = 2
        else:
            tier = 1
        return (tier, -float(r.get("score", 0) or 0))

    raw.sort(key=boost_key)
    return raw[:limit]


def format_context(chunks: list[dict]) -> str:
    if not chunks:
        return ""
    lines = ["[참고 자료]"]
    for c in chunks:
        lines.append(f"- {c['content'][:300]}")
    return "\n".join(lines)
