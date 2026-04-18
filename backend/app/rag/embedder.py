from app.core.embedder import embed_text
from app.core.supabase import get_supabase


async def index_artifact(account_id: str, source_type: str, source_id: str, content: str) -> None:
    """아티팩트를 임베딩 + FTS 인덱싱"""
    embedding = embed_text(content)
    sb = get_supabase()

    # 기존 임베딩 삭제 후 재삽입 (업데이트 처리)
    sb.table("embeddings").delete().eq("source_id", source_id).execute()
    sb.table("embeddings").insert({
        "account_id": account_id,
        "source_type": source_type,
        "source_id": source_id,
        "embedding": embedding,
        "fts": f"to_tsvector('simple', {repr(content)})",
        "content": content,
    }).execute()
