from datetime import datetime, timezone

from croniter import croniter
from fastapi import APIRouter, HTTPException, Query

from app.core.supabase import get_supabase
from app.models.schemas import (
    ArtifactDetailResponse,
    ArtifactPatchRequest,
    DeleteArtifactRequest,
    PinRequest,
    ScheduleResponse,
)

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])


_PERIOD_KEYS = ("start_date", "end_date", "due_date", "due_label")
_SCHEDULE_KEYS = ("cron", "next_run", "schedule_status", "executed_at", "last_run_status", "last_error")


def _compute_next_run(cron_expr: str | None, base: datetime) -> str | None:
    if not cron_expr:
        return None
    try:
        return croniter(cron_expr, base).get_next(datetime).isoformat()
    except Exception:
        return None


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
                    "account_id": req.account_id,
                    "parent_id":  p["parent_id"],
                    "child_id":   c["child_id"],
                    "relation":   c.get("relation") or p.get("relation") or "contains",
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

    # artifact와 관련된 엣지 및 activity_logs 삭제
    sb.table("artifact_edges").delete().eq("child_id", artifact_id).execute()
    sb.table("artifact_edges").delete().eq("parent_id", artifact_id).execute()
    sb.table("activity_logs").delete().eq("account_id", req.account_id).eq("metadata->>artifact_id", artifact_id).execute()
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


@router.get("/{artifact_id}/detail", response_model=ArtifactDetailResponse)
async def artifact_detail(artifact_id: str, account_id: str = Query(...)):
    """통합 Node Detail 모달용 전체 번들.

    반환:
      artifact        — 본문 + metadata
      parent_hub      — domain(메인 허브) + sub_hub(서브허브, 있을 때)
      edges.parents   — [{id,title,kind,type,relation}]
      edges.children  — [{id,title,kind,type,relation}]
      memos           — 오래된 순
      evaluation      — {up,down,my_rating}
      logs            — 자식 kind='log' (executed_at desc)
    """
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,domains,kind,type,title,content,status,metadata,created_at")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    # parents + children edges → collect ids then batch fetch titles
    parents_e = (
        sb.table("artifact_edges")
        .select("parent_id,relation")
        .eq("child_id", artifact_id)
        .execute()
    ).data or []
    children_e = (
        sb.table("artifact_edges")
        .select("child_id,relation")
        .eq("parent_id", artifact_id)
        .execute()
    ).data or []

    neighbor_ids = list({e["parent_id"] for e in parents_e} | {e["child_id"] for e in children_e})
    neighbors: dict[str, dict] = {}
    if neighbor_ids:
        n_res = (
            sb.table("artifacts")
            .select("id,title,kind,type,domains,status,metadata")
            .in_("id", neighbor_ids)
            .execute()
        )
        for r in n_res.data or []:
            neighbors[r["id"]] = r

    def _decorate(e: dict, fk: str) -> dict:
        n = neighbors.get(e[fk]) or {}
        return {
            "id":       e[fk],
            "title":    n.get("title") or "",
            "kind":     n.get("kind"),
            "type":     n.get("type"),
            "relation": e["relation"],
            "status":   n.get("status"),
        }

    parent_edges   = [_decorate(e, "parent_id") for e in parents_e]
    children_edges = [_decorate(e, "child_id")  for e in children_e]

    # domain/subhub parent — contains 엣지 우선
    domain_hub = None
    sub_hub    = None
    for p in parent_edges:
        if p["kind"] == "domain" and (p.get("relation") == "contains"):
            if (neighbors.get(p["id"]) or {}).get("type") == "category":
                sub_hub = p
            elif sub_hub is None:
                domain_hub = p
    # sub_hub 의 부모가 domain_hub 일 수 있으므로 한 번 더 올라가서 보강
    if sub_hub and not domain_hub:
        sh_parent_e = (
            sb.table("artifact_edges")
            .select("parent_id,relation")
            .eq("child_id", sub_hub["id"])
            .eq("relation", "contains")
            .execute()
        ).data or []
        if sh_parent_e:
            pid = sh_parent_e[0]["parent_id"]
            pr = (
                sb.table("artifacts")
                .select("id,title,kind,type,status")
                .eq("id", pid)
                .single()
                .execute()
            ).data
            if pr and pr.get("kind") == "domain":
                domain_hub = {**pr, "relation": "contains"}

    # memos (ascending, timeline 스타일)
    memos_res = (
        sb.table("memos")
        .select("id,artifact_id,content,created_at,updated_at")
        .eq("artifact_id", artifact_id)
        .eq("account_id", account_id)
        .order("created_at", desc=False)
        .execute()
    )

    # evaluations count + user's vote
    eval_res = (
        sb.table("evaluations")
        .select("rating,account_id")
        .eq("artifact_id", artifact_id)
        .execute()
    )
    up = down = 0
    my_rating: str | None = None
    for r in eval_res.data or []:
        if r.get("rating") == "up":
            up += 1
        elif r.get("rating") == "down":
            down += 1
        if r.get("account_id") == account_id:
            my_rating = r.get("rating")

    # child logs (kind='log' via logged_from)
    log_ids = [c["id"] for c in children_edges if c["kind"] == "log" and c.get("relation") == "logged_from"]
    logs = []
    if log_ids:
        logs_res = (
            sb.table("artifacts")
            .select("id,title,status,metadata,created_at")
            .in_("id", log_ids)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        for r in logs_res.data or []:
            meta = r.get("metadata") or {}
            logs.append({
                "id":          r["id"],
                "title":       r["title"],
                "status":      r["status"],
                "executed_at": meta.get("executed_at"),
            })

    return ArtifactDetailResponse(data={
        "artifact":   art,
        "parent_hub": {"domain": domain_hub, "sub": sub_hub},
        "edges": {"parents": parent_edges, "children": children_edges},
        "memos":      memos_res.data or [],
        "evaluation": {"up": up, "down": down, "my_rating": my_rating},
        "logs":       logs,
    })


@router.patch("/{artifact_id}", response_model=ScheduleResponse)
async def patch_artifact(artifact_id: str, req: ArtifactPatchRequest):
    """디테일 모달 편집용. content / period(토글) / schedule(토글) 업데이트."""
    sb = get_supabase()
    art_res = (
        sb.table("artifacts")
        .select("id,account_id,domains,kind,title,content,metadata")
        .eq("id", artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    if art.get("kind") in ("anchor", "domain"):
        raise HTTPException(status_code=400, detail="허브 노드는 편집할 수 없습니다")

    patch: dict = {}
    metadata = dict(art.get("metadata") or {})
    metadata_changed = False

    # content
    content_changed = False
    if req.content is not None and req.content != art.get("content"):
        patch["content"] = req.content
        content_changed = True

    # period toggle
    if req.period_enabled is not None:
        if req.period_enabled:
            metadata["period_enabled"] = True
            for key in ("start_date", "end_date", "due_date", "due_label"):
                val = getattr(req, key)
                if val is not None:
                    metadata[key] = val or None
                    if not val:
                        metadata.pop(key, None)
        else:
            metadata.pop("period_enabled", None)
            for key in _PERIOD_KEYS:
                metadata.pop(key, None)
        metadata_changed = True
    elif any(getattr(req, k) is not None for k in _PERIOD_KEYS):
        # period 토글은 유지하면서 개별 필드만 수정
        for key in _PERIOD_KEYS:
            val = getattr(req, key)
            if val is None:
                continue
            if val == "":
                metadata.pop(key, None)
            else:
                metadata[key] = val
        metadata_changed = True

    # schedule toggle
    if req.schedule_enabled is not None:
        if req.schedule_enabled:
            cron = req.cron or metadata.get("cron")
            if not cron:
                raise HTTPException(status_code=400, detail="cron이 필요합니다")
            metadata["schedule_enabled"] = True
            metadata["schedule_status"]  = req.schedule_status or metadata.get("schedule_status") or "active"
            metadata["cron"]             = cron
            nxt = _compute_next_run(cron, datetime.now(timezone.utc))
            if nxt:
                metadata["next_run"] = nxt
        else:
            for key in ("schedule_enabled", *_SCHEDULE_KEYS):
                metadata.pop(key, None)
        metadata_changed = True
    else:
        if req.cron is not None and metadata.get("schedule_enabled"):
            metadata["cron"] = req.cron
            nxt = _compute_next_run(req.cron, datetime.now(timezone.utc))
            if nxt:
                metadata["next_run"] = nxt
            metadata_changed = True
        if req.schedule_status is not None and metadata.get("schedule_enabled"):
            if req.schedule_status not in ("active", "paused"):
                raise HTTPException(status_code=400, detail="schedule_status must be active|paused")
            metadata["schedule_status"] = req.schedule_status
            metadata_changed = True

    if metadata_changed:
        patch["metadata"] = metadata

    if not patch:
        return ScheduleResponse(data={"ok": True, "updated": False})

    sb.table("artifacts").update(patch).eq("id", artifact_id).execute()

    # 임베딩 재인덱싱 (content 변경 시)
    if content_changed:
        try:
            from app.rag.embedder import index_artifact
            source_type = (art.get("domains") or ["documents"])[0]
            title = art.get("title") or ""
            await index_artifact(
                req.account_id, source_type, artifact_id,
                f"{title}\n{req.content or ''}"[:4000],
            )
        except Exception:
            pass

    return ScheduleResponse(data={"ok": True, "updated": True})
