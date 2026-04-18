from fastapi import APIRouter, HTTPException

from app.core.supabase import get_supabase
from app.models.schemas import DeleteArtifactRequest, PinRequest, ScheduleResponse

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])


@router.delete("/{artifact_id}", response_model=ScheduleResponse)
async def delete_artifact(artifact_id: str, req: DeleteArtifactRequest):
    """노드 삭제 + 부모·자식 재연결.

    삭제 대상의 모든 부모 × 자식 조합에 대해 새 엣지를 만들고
    (자식이 가지고 있던 relation 그대로 승계), 기존 엣지와 artifact를 삭제.
    """
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,kind")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    if art.get("kind") == "anchor":
        raise HTTPException(status_code=400, detail="anchor 노드는 삭제할 수 없습니다")
    if art.get("kind") == "domain":
        raise HTTPException(status_code=400, detail="domain 노드는 삭제할 수 없습니다")

    parents = (
        sb.table("artifact_edges")
        .select("parent_id,relation")
        .eq("child_id", artifact_id)
        .execute()
    ).data or []
    children = (
        sb.table("artifact_edges")
        .select("child_id,relation")
        .eq("parent_id", artifact_id)
        .execute()
    ).data or []

    new_edges: list[dict] = []
    for p in parents:
        for c in children:
            new_edges.append(
                {
                    "parent_id": p["parent_id"],
                    "child_id": c["child_id"],
                    "relation": c.get("relation") or p.get("relation") or "contains",
                }
            )
    if new_edges:
        # (parent_id, child_id) 중복 가능성이 있으므로 필터링 후 insert
        seen = set()
        unique = []
        for e in new_edges:
            key = (e["parent_id"], e["child_id"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(e)
        # 이미 존재하는 edge 제외
        if unique:
            existing = (
                sb.table("artifact_edges")
                .select("parent_id,child_id")
                .in_("parent_id", list({e["parent_id"] for e in unique}))
                .in_("child_id", list({e["child_id"] for e in unique}))
                .execute()
            ).data or []
            existing_keys = {(r["parent_id"], r["child_id"]) for r in existing}
            to_insert = [
                e
                for e in unique
                if (e["parent_id"], e["child_id"]) not in existing_keys
            ]
            if to_insert:
                sb.table("artifact_edges").insert(to_insert).execute()

    # artifact와 관련된 엣지 삭제
    sb.table("artifact_edges").delete().eq("child_id", artifact_id).execute()
    sb.table("artifact_edges").delete().eq("parent_id", artifact_id).execute()
    sb.table("artifacts").delete().eq("id", artifact_id).execute()

    return ScheduleResponse(
        data={"ok": True, "reparented": len(new_edges), "id": artifact_id}
    )


@router.patch("/{artifact_id}/pin", response_model=ScheduleResponse)
async def pin_artifact(artifact_id: str, req: PinRequest):
    """위치 고정/해제. metadata.pinned + metadata.position 에 저장."""
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,metadata")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    metadata = dict(art.get("metadata") or {})
    metadata["pinned"] = bool(req.pinned)
    if req.pinned and req.position is not None:
        metadata["position"] = {"x": req.position.get("x"), "y": req.position.get("y")}
    elif not req.pinned:
        metadata.pop("position", None)

    sb.table("artifacts").update({"metadata": metadata}).eq("id", artifact_id).execute()
    return ScheduleResponse(data={"ok": True, "pinned": req.pinned})
