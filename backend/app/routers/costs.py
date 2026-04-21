"""비용 도메인 REST API

엔드포인트:
  POST   /api/costs         — 비용 다건 저장 + 자동 임베딩
  GET    /api/costs         — 기간별 비용 조회
  GET    /api/costs/summary — 일/주/월 집계
  DELETE /api/costs/{id}   — 단건 삭제
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from app.core.supabase import get_supabase
from app.rag.embedder import index_artifact

router = APIRouter(prefix="/api/costs", tags=["costs"])

VALID_CATEGORIES = {"재료비", "인건비", "임대료", "공과금", "마케팅", "기타"}

# ── 스키마 ────────────────────────────────────────────────────────────────────

class CostItemIn(BaseModel):
    item_name: str
    category: str = "기타"
    amount: int
    memo: str = ""
    recorded_date: str          # YYYY-MM-DD
    source: str = "chat"

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        return v if v in VALID_CATEGORIES else "기타"

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v: int) -> int:
        if v < 0:
            raise ValueError("amount must be >= 0")
        return v


class CostBulkRequest(BaseModel):
    account_id: str
    items: list[CostItemIn]


class CostDeleteRequest(BaseModel):
    account_id: str


# ── POST /api/costs ───────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_costs(req: CostBulkRequest):
    """비용 항목 다건 저장 + 임베딩 인덱싱."""
    if not req.items:
        raise HTTPException(status_code=400, detail="items가 비어있습니다.")

    sb = get_supabase()
    rows = [
        {
            "account_id": req.account_id,
            "recorded_date": it.recorded_date,
            "item_name": it.item_name,
            "category": it.category,
            "amount": it.amount,
            "memo": it.memo,
            "source": it.source,
        }
        for it in req.items
    ]

    try:
        result = sb.table("cost_records").insert(rows).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"저장 실패: {e}")

    saved = result.data or []

    for record in saved:
        content = _record_to_text(record)
        try:
            await index_artifact(
                account_id=req.account_id,
                source_type="sales",
                source_id=f"cost_{record['id']}",
                content=content,
            )
        except Exception:
            pass

    # cost_report artifact 생성 — Costs 서브허브에 연결
    artifact_id: str | None = None
    try:
        recorded_date = req.items[0].recorded_date
        total_amount = sum(it.amount for it in req.items)

        hub_res = (
            sb.table("artifacts")
            .select("id")
            .eq("account_id", req.account_id)
            .eq("kind", "domain")
            .eq("type", "category")
            .ilike("title", "%Costs%")
            .limit(1)
            .execute()
        )
        costs_hub_id = hub_res.data[0]["id"] if hub_res.data else None

        art_res = sb.table("artifacts").insert({
            "account_id": req.account_id,
            "kind": "artifact",
            "type": "cost_report",
            "domains": ["sales"],
            "title": f"{recorded_date} 비용 ({len(saved)}건)",
            "content": f"총 {total_amount:,}원 · {len(saved)}개 항목",
            "status": "active",
            "metadata": {
                "recorded_date": recorded_date,
                "record_count": len(saved),
                "total_amount": total_amount,
            },
        }).execute()

        if art_res.data:
            artifact_id = art_res.data[0]["id"]
            if costs_hub_id and artifact_id:
                sb.table("artifact_edges").insert({
                    "account_id": req.account_id,
                    "parent_id": costs_hub_id,
                    "child_id": artifact_id,
                    "relation": "contains",
                }).execute()
    except Exception:
        pass

    return {
        "data": {"saved": len(saved), "records": saved, "artifact_id": artifact_id},
        "error": None,
        "meta": {},
    }


# ── GET /api/costs ────────────────────────────────────────────────────────────

@router.get("")
async def list_costs(
    account_id: str = Query(...),
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=500),
):
    """기간별 비용 조회."""
    if not start_date:
        start_date = (date.today() - timedelta(days=30)).isoformat()
    if not end_date:
        end_date = date.today().isoformat()

    sb = get_supabase()
    try:
        result = (
            sb.table("cost_records")
            .select("*")
            .eq("account_id", account_id)
            .gte("recorded_date", start_date)
            .lte("recorded_date", end_date)
            .order("recorded_date", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

    records = result.data or []
    return {
        "data": {"records": records, "total": len(records)},
        "error": None,
        "meta": {"start_date": start_date, "end_date": end_date},
    }


# ── GET /api/costs/summary ────────────────────────────────────────────────────

@router.get("/summary")
async def costs_summary(
    account_id: str = Query(...),
    period: str = Query(default="month", description="day | week | month"),
    base_date: str = Query(default=""),
):
    """기간별 비용 집계."""
    today = date.today()
    pivot = date.fromisoformat(base_date) if base_date else today

    if period == "day":
        start = end = pivot
    elif period == "week":
        start = pivot - timedelta(days=pivot.weekday())
        end = start + timedelta(days=6)
    else:
        start = pivot.replace(day=1)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = next_month - timedelta(days=1)

    sb = get_supabase()
    try:
        result = (
            sb.table("cost_records")
            .select("item_name,category,amount,recorded_date")
            .eq("account_id", account_id)
            .gte("recorded_date", start.isoformat())
            .lte("recorded_date", end.isoformat())
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"집계 실패: {e}")

    records = result.data or []
    by_category: dict[str, int] = {}
    by_item: dict[str, dict] = {}
    total_amount = 0

    for r in records:
        cat = r.get("category", "기타")
        name = r["item_name"]
        amount = r.get("amount", 0)
        by_category[cat] = by_category.get(cat, 0) + amount
        if name not in by_item:
            by_item[name] = {"item_name": name, "category": cat, "amount": 0}
        by_item[name]["amount"] += amount
        total_amount += amount

    return {
        "data": {
            "period": period,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "total_amount": total_amount,
            "by_category": [
                {"category": k, "amount": v}
                for k, v in sorted(by_category.items(), key=lambda x: x[1], reverse=True)
            ],
            "by_item": sorted(by_item.values(), key=lambda x: x["amount"], reverse=True),
            "record_count": len(records),
        },
        "error": None,
        "meta": {},
    }


# ── DELETE /api/costs/{id} ────────────────────────────────────────────────────

@router.delete("/{record_id}")
async def delete_cost(record_id: str, account_id: str = Query(...)):
    """비용 단건 삭제."""
    sb = get_supabase()

    check = (
        sb.table("cost_records")
        .select("id")
        .eq("id", record_id)
        .eq("account_id", account_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")

    try:
        sb.table("cost_records").delete().eq("id", record_id).execute()
        sb.table("embeddings").delete().eq("source_id", f"cost_{record_id}").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"삭제 실패: {e}")

    return {"data": {"deleted": record_id}, "error": None, "meta": {}}


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _record_to_text(record: dict) -> str:
    return (
        f"{record.get('recorded_date','')} "
        f"비용 {record.get('item_name','')} "
        f"{record.get('amount',0):,}원 "
        f"분류:{record.get('category','기타')} "
        f"{record.get('memo','')}"
    ).strip()
