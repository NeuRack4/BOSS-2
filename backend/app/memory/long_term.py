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
