from datetime import datetime, timezone

from app.core.supabase import get_supabase
from app.core.embedder import embed_text


async def save_memory(account_id: str, content: str, importance: float = 1.0) -> None:
    embedding = embed_text(content)
    sb = get_supabase()
    sb.table("memory_long").insert({
        "account_id": account_id,
        "content": content,
        "embedding": embedding,
        "importance": importance,
    }).execute()


async def log_artifact_to_memory(
    account_id: str,
    domain: str,
    artifact_type: str,
    title: str,
) -> None:
    """노드 생성 시 '언제 무슨 작업을 했다'는 사실을 장기기억에 저장."""
    now = datetime.now(timezone.utc)
    label = now.strftime("%Y년 %m월 %d일 %H시")
    content = f"[{domain}] {artifact_type} '{title}' 생성 — {label}"
    try:
        await save_memory(account_id, content, importance=2.0)
    except Exception:
        pass


async def recall(account_id: str, query: str, limit: int = 5) -> list[dict]:
    """벡터 유사도로 장기 기억 recall"""
    embedding = embed_text(query)
    sb = get_supabase()
    result = sb.rpc("memory_search", {
        "p_account_id": account_id,
        "p_embedding": embedding,
        "p_limit": limit,
    }).execute()
    return result.data or []
