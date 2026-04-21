"""장기 기억(memory_long) CRUD 엔드포인트.

PATCH  /api/memory/long/{id}  — 내용 수정 + 재임베딩
DELETE /api/memory/long/{id}  — 단건 삭제
POST   /api/memory/boost      — artifact 요약을 장기기억으로 핀 (importance 1~5)
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.supabase import get_supabase
from app.memory.long_term import save_memory
from app.models.schemas import MemoryBoostRequest, MemoryBoostResponse

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryPatch(BaseModel):
    content: str
    account_id: str


@router.patch("/long/{memory_id}")
async def patch_memory(memory_id: str, body: MemoryPatch):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="content가 비어있습니다.")

    sb = get_supabase()
    row = (
        sb.table("memory_long")
        .select("id,account_id")
        .eq("id", memory_id)
        .eq("account_id", body.account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not row:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")

    try:
        from app.core.embedder import embed_text
        embedding = embed_text(body.content)
    except Exception:
        embedding = None

    update: dict = {"content": body.content.strip()}
    if embedding is not None:
        update["embedding"] = embedding

    try:
        sb.table("memory_long").update(update).eq("id", memory_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"수정 실패: {e}")

    return {"data": {"id": memory_id}, "error": None, "meta": {}}


@router.delete("/long/{memory_id}")
async def delete_memory(memory_id: str, account_id: str = Query(...)):
    sb = get_supabase()
    row = (
        sb.table("memory_long")
        .select("id")
        .eq("id", memory_id)
        .eq("account_id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not row:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")

    try:
        sb.table("memory_long").delete().eq("id", memory_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"삭제 실패: {e}")

    return {"data": {"deleted": memory_id}, "error": None, "meta": {}}


@router.post("/boost", response_model=MemoryBoostResponse)
async def boost_artifact_to_memory(req: MemoryBoostRequest):
    """Node Detail Modal 의 ⭐ Memory Boost — artifact 를 장기기억으로 저장.

    importance 는 1~5 별점을 0.2 ~ 1.0 로 매핑해 넘긴다.
    같은 artifact 를 여러 번 핀하면 관점별로 누적 저장된다 (중복 방지 없음).
    """
    if not (0.0 < req.importance <= 1.0):
        raise HTTPException(status_code=400, detail="importance는 0~1 사이 값이어야 합니다.")

    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,title,content,type,domains")
        .eq("id", req.artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    title   = (art.get("title") or "").strip()
    body    = (req.note or (art.get("content") or "")).strip()[:1200]
    domains = art.get("domains") or []
    dom_tag = f"[{domains[0]}] " if domains else ""
    content = f"{dom_tag}[Pinned: {title}]\n{body}".strip()

    try:
        await save_memory(req.account_id, content, importance=req.importance)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"저장 실패: {e}")

    return MemoryBoostResponse(data={
        "ok":         True,
        "artifact_id": req.artifact_id,
        "importance":  req.importance,
    })
