from app.core.embedder import embed_text
from app.core.supabase import get_supabase


async def index_artifact(account_id: str, source_type: str, source_id: str, content: str) -> None:
    """아티팩트를 임베딩 + FTS 인덱싱 (upsert_embedding RPC 사용)."""
    embedding = embed_text(content)
    sb = get_supabase()
    sb.rpc(
        "upsert_embedding",
        {
            "p_account_id":  account_id,
            "p_source_type": source_type,
            "p_source_id":   source_id,
            "p_content":     content,
            "p_embedding":   embedding,
        },
    ).execute()
