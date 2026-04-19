from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Any

from app.core.supabase import get_supabase
from app.rag.retriever import hybrid_search

router = APIRouter(prefix="/api/search", tags=["search"])


class SearchResponse(BaseModel):
    data: list[dict[str, Any]]
    error: str | None = None
    meta: dict[str, Any] = {}


@router.get("", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1),
    account_id: str = Query(...),
    limit: int = Query(12, ge=1, le=50),
):
    """하이브리드(벡터+FTS) 검색 → artifact/memo 매치 결합.

    응답:
      artifact_id, kind, type, title, domains, status,
      match: 'content' | 'memo',
      snippet, score
    """
    query = q.strip()
    if not query:
        return SearchResponse(data=[])

    # 충분한 후보를 받아서 dedup 후 잘라냄
    raw = await hybrid_search(account_id, query, limit=max(limit * 2, 20))
    if not raw:
        return SearchResponse(data=[])

    sb = get_supabase()

    # memo source_id → artifact_id 매핑
    memo_ids = [
        r["source_id"] for r in raw if r.get("source_type") == "memo"
    ]
    memo_to_artifact: dict[str, str] = {}
    if memo_ids:
        memos = (
            sb.table("memos")
            .select("id,artifact_id")
            .in_("id", memo_ids)
            .eq("account_id", account_id)
            .execute()
        ).data or []
        memo_to_artifact = {m["id"]: m["artifact_id"] for m in memos}

    # 조회할 artifact id 수집
    artifact_ids: set[str] = set()
    for r in raw:
        st = r.get("source_type")
        sid = r.get("source_id")
        if not sid:
            continue
        if st == "memo":
            aid = memo_to_artifact.get(sid)
            if aid:
                artifact_ids.add(aid)
        else:
            artifact_ids.add(sid)

    art_map: dict[str, dict] = {}
    if artifact_ids:
        arts = (
            sb.table("artifacts")
            .select("id,kind,type,title,domains,status,created_at")
            .in_("id", list(artifact_ids))
            .eq("account_id", account_id)
            .execute()
        ).data or []
        art_map = {a["id"]: a for a in arts}

    results: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for r in raw:
        st = r.get("source_type") or ""
        sid = r.get("source_id") or ""
        if st == "memo":
            aid = memo_to_artifact.get(sid)
            if not aid:
                continue
            match = "memo"
        else:
            aid = sid
            match = "content"

        art = art_map.get(aid)
        if not art or art.get("kind") == "anchor":
            continue

        key = (aid, match)
        if key in seen:
            continue
        seen.add(key)

        results.append(
            {
                "artifact_id": aid,
                "kind":     art["kind"],
                "type":     art.get("type") or "",
                "title":    art.get("title") or "",
                "domains":  art.get("domains") or [],
                "status":   art.get("status") or "",
                "match":    match,
                "snippet":  (r.get("content") or "")[:160],
                "score":    float(r.get("rrf_score") or r.get("score") or 0),
            }
        )
        if len(results) >= limit:
            break

    return SearchResponse(data=results)
