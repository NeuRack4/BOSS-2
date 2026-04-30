from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from app.core.embedder import embed_text
from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/memos", tags=["memos"])


class MemoCreateRequest(BaseModel):
    account_id: str
    artifact_id: Optional[str] = None
    content: str


class MemoUpdateRequest(BaseModel):
    account_id: str
    content: str


class MemoResponse(BaseModel):
    data: Any
    error: str | None = None
    meta: dict[str, Any] = {}


_index_memo = lambda account_id, memo_id, content: get_supabase().rpc(
    "upsert_embedding",
    {
        "p_account_id":  account_id,
        "p_source_type": "memo",
        "p_source_id":   memo_id,
        "p_content":     content,
        "p_embedding":   embed_text(content),
    },
).execute()


@router.get("", response_model=MemoResponse)
async def list_memos(artifact_id: str, account_id: str):
    """해당 artifact에 달린 메모 목록 (최신순)."""
    sb = get_supabase()
    res = (
        sb.table("memos")
        .select("id,artifact_id,content,created_at,updated_at")
        .eq("artifact_id", artifact_id)
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .execute()
    )
    return MemoResponse(data=res.data or [])


@router.post("", response_model=MemoResponse)
async def create_memo(req: MemoCreateRequest):
    """메모 생성 + 임베딩 인덱싱."""
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is empty")

    sb = get_supabase()
    if req.artifact_id:
        art = (
            sb.table("artifacts")
            .select("id,account_id")
            .eq("id", req.artifact_id)
            .single()
            .execute()
        ).data
        if not art:
            raise HTTPException(status_code=404, detail="artifact not found")
        if art["account_id"] != req.account_id:
            raise HTTPException(status_code=403, detail="not allowed")

    row_data: dict = {"account_id": req.account_id, "content": content}
    if req.artifact_id:
        row_data["artifact_id"] = req.artifact_id

    ins = (
        sb.table("memos")
        .insert(row_data)
        .execute()
    )
    row = (ins.data or [None])[0]
    if not row:
        raise HTTPException(status_code=500, detail="insert failed")

    _index_memo(req.account_id, row["id"], content)
    return MemoResponse(data=row)


@router.patch("/{memo_id}", response_model=MemoResponse)
async def update_memo(memo_id: str, req: MemoUpdateRequest):
    """메모 편집 + 재임베딩."""
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is empty")

    sb = get_supabase()
    cur = (
        sb.table("memos")
        .select("id,account_id")
        .eq("id", memo_id)
        .single()
        .execute()
    ).data
    if not cur:
        raise HTTPException(status_code=404, detail="memo not found")
    if cur["account_id"] != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    upd = (
        sb.table("memos")
        .update({"content": content})
        .eq("id", memo_id)
        .execute()
    )
    _index_memo(req.account_id, memo_id, content)
    return MemoResponse(data=(upd.data or [{}])[0])


@router.delete("/{memo_id}", response_model=MemoResponse)
async def delete_memo(memo_id: str, account_id: str):
    """메모 + 임베딩 삭제."""
    sb = get_supabase()
    cur = (
        sb.table("memos")
        .select("id,account_id")
        .eq("id", memo_id)
        .single()
        .execute()
    ).data
    if not cur:
        raise HTTPException(status_code=404, detail="memo not found")
    if cur["account_id"] != account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    sb.table("memos").delete().eq("id", memo_id).execute()
    sb.table("embeddings").delete().eq("source_id", memo_id).execute()
    return MemoResponse(data={"ok": True, "id": memo_id})
