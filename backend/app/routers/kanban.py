from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

DOMAINS = ("recruitment", "marketing", "sales", "documents")


class MoveRequest(BaseModel):
    account_id: str
    artifact_id: str
    to_sub_hub_id: str


@router.get("/{domain}")
async def get_board(domain: str, account_id: str = Query(...)):
    if domain not in DOMAINS:
        raise HTTPException(status_code=400, detail="invalid domain")

    sb = get_supabase()

    sub_hubs_res = (
        sb.table("artifacts")
        .select("id,title,metadata,created_at")
        .eq("account_id", account_id)
        .eq("kind", "domain")
        .eq("type", "category")
        .contains("domains", [domain])
        .order("created_at")
        .execute()
    )
    sub_hubs = sub_hubs_res.data or []
    sub_hub_ids = [s["id"] for s in sub_hubs]

    arts_res = (
        sb.table("artifacts")
        .select("id,kind,type,title,status,metadata,created_at,domains")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .neq("type", "archive")
        .contains("domains", [domain])
        .neq("status", "archived")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
    )
    arts = arts_res.data or []

    if not arts:
        return {
            "data": {
                "sub_hubs": sub_hubs,
                "cards": {sid: [] for sid in sub_hub_ids},
                "unassigned": [],
            }
        }

    art_ids = [a["id"] for a in arts]

    edges_res = (
        sb.table("artifact_edges")
        .select("parent_id,child_id,relation")
        .eq("account_id", account_id)
        .eq("relation", "contains")
        .in_("child_id", art_ids)
        .in_("parent_id", sub_hub_ids or [""])
        .execute()
    )
    edges = edges_res.data or []

    child_to_parent: dict[str, str] = {}
    for e in edges:
        child_to_parent.setdefault(e["child_id"], e["parent_id"])

    cards: dict[str, list] = {sid: [] for sid in sub_hub_ids}
    unassigned: list = []
    for a in arts:
        parent = child_to_parent.get(a["id"])
        if parent and parent in cards:
            cards[parent].append(a)
        else:
            unassigned.append(a)

    return {
        "data": {
            "sub_hubs": sub_hubs,
            "cards": cards,
            "unassigned": unassigned,
        }
    }


@router.patch("/move")
async def move_card(req: MoveRequest):
    sb = get_supabase()

    art_res = (
        sb.table("artifacts")
        .select("id,account_id,domains")
        .eq("id", req.artifact_id)
        .single()
        .execute()
    )
    art = art_res.data
    if not art:
        raise HTTPException(status_code=404, detail="artifact not found")
    if art.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")

    hub_res = (
        sb.table("artifacts")
        .select("id,account_id,kind,type,domains")
        .eq("id", req.to_sub_hub_id)
        .single()
        .execute()
    )
    hub = hub_res.data
    if not hub:
        raise HTTPException(status_code=404, detail="sub-hub not found")
    if hub.get("account_id") != req.account_id:
        raise HTTPException(status_code=403, detail="not allowed")
    if hub.get("kind") != "domain" or hub.get("type") != "category":
        raise HTTPException(status_code=400, detail="target is not a sub-hub")

    target_domain = (hub.get("domains") or [None])[0]
    art_domains = set(art.get("domains") or [])
    if target_domain and target_domain not in art_domains:
        raise HTTPException(
            status_code=400,
            detail=f"artifact does not belong to {target_domain}",
        )

    same_domain_hubs_res = (
        sb.table("artifacts")
        .select("id")
        .eq("account_id", req.account_id)
        .eq("kind", "domain")
        .eq("type", "category")
        .contains("domains", [target_domain])
        .execute()
    )
    same_domain_hub_ids = [h["id"] for h in (same_domain_hubs_res.data or [])]

    if same_domain_hub_ids:
        (
            sb.table("artifact_edges")
            .delete()
            .eq("account_id", req.account_id)
            .eq("child_id", req.artifact_id)
            .eq("relation", "contains")
            .in_("parent_id", same_domain_hub_ids)
            .execute()
        )

    sb.table("artifact_edges").insert(
        {
            "account_id": req.account_id,
            "parent_id": req.to_sub_hub_id,
            "child_id": req.artifact_id,
            "relation": "contains",
        }
    ).execute()

    return {"data": {"ok": True, "artifact_id": req.artifact_id, "sub_hub_id": req.to_sub_hub_id}}
