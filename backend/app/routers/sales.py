"""매출 도메인 REST API

엔드포인트:
  POST   /api/sales          — 매출 다건 저장 + 자동 임베딩
  GET    /api/sales          — 기간별 매출 조회
  GET    /api/sales/summary  — 일/주/월 집계
  DELETE /api/sales/{id}     — 단건 삭제
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from app.core.supabase import get_supabase
from app.rag.embedder import index_artifact

router = APIRouter(prefix="/api/sales", tags=["sales"])


# ── 스키마 ────────────────────────────────────────────────────────────────────

class SaleItemIn(BaseModel):
    item_name: str
    category: str = "기타"
    quantity: int = 1
    unit_price: int = 0
    amount: int
    recorded_date: str          # YYYY-MM-DD
    source: str = "chat"        # chat | ocr | csv | excel
    raw_input: str = ""
    metadata: dict[str, Any] = {}

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: str) -> str:
        if v not in {"chat", "ocr", "csv", "excel"}:
            raise ValueError("source must be chat | ocr | csv | excel")
        return v

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("quantity must be > 0")
        return v


class SalesBulkRequest(BaseModel):
    account_id: str
    items: list[SaleItemIn]


class SalesDeleteRequest(BaseModel):
    account_id: str


# ── POST /api/sales ───────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_sales(req: SalesBulkRequest):
    """매출 항목 다건 저장 + 각 항목 임베딩 인덱싱."""
    if not req.items:
        raise HTTPException(status_code=400, detail="items가 비어있습니다.")

    sb = get_supabase()
    rows = [
        {
            "account_id": req.account_id,
            "recorded_date": it.recorded_date,
            "item_name": it.item_name,
            "category": it.category,
            "quantity": it.quantity,
            "unit_price": it.unit_price,
            "amount": it.amount,
            "source": it.source,
            "raw_input": it.raw_input,
            "metadata": it.metadata,
        }
        for it in req.items
    ]

    try:
        result = sb.table("sales_records").insert(rows).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"저장 실패: {e}")

    saved = result.data or []

    # 임베딩 — 챗봇 RAG 검색을 위해 각 항목을 텍스트화해서 인덱싱
    for record in saved:
        content = _record_to_text(record)
        try:
            await index_artifact(
                account_id=req.account_id,
                source_type="sales",
                source_id=str(record["id"]),
                content=content,
            )
        except Exception:
            pass  # 임베딩 실패해도 저장은 유지

    # revenue_entry artifact 생성 — 캔버스 Revenue 허브에 노드 추가
    artifact_id: str | None = None
    try:
        recorded_date = req.items[0].recorded_date
        total_amount = sum(it.amount for it in req.items)

        # Revenue 서브허브 찾기
        hub_res = (
            sb.table("artifacts")
            .select("id")
            .eq("account_id", req.account_id)
            .eq("kind", "domain")
            .eq("type", "category")
            .ilike("title", "%Revenue%")
            .limit(1)
            .execute()
        )
        revenue_hub_id = hub_res.data[0]["id"] if hub_res.data else None

        art_res = sb.table("artifacts").insert({
            "account_id": req.account_id,
            "kind": "artifact",
            "type": "revenue_entry",
            "domains": ["sales"],
            "title": f"{recorded_date} 매출 ({len(saved)}건)",
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
            if revenue_hub_id and artifact_id:
                sb.table("artifact_edges").insert({
                    "account_id": req.account_id,
                    "parent_id": revenue_hub_id,
                    "child_id": artifact_id,
                    "relation": "contains",
                }).execute()
    except Exception:
        pass  # artifact 생성 실패해도 records 저장은 유지

    return {
        "data": {"saved": len(saved), "records": saved, "artifact_id": artifact_id},
        "error": None,
        "meta": {},
    }


# ── GET /api/sales ────────────────────────────────────────────────────────────

@router.get("")
async def list_sales(
    account_id: str = Query(...),
    start_date: str = Query(default=""),
    end_date: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=500),
):
    """기간별 매출 조회. start_date/end_date 없으면 최근 30일."""
    if not start_date:
        start_date = (date.today() - timedelta(days=30)).isoformat()
    if not end_date:
        end_date = date.today().isoformat()

    sb = get_supabase()
    try:
        result = (
            sb.table("sales_records")
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


# ── GET /api/sales/summary ────────────────────────────────────────────────────

@router.get("/summary")
async def sales_summary(
    account_id: str = Query(...),
    period: str = Query(default="month", description="day | week | month"),
    base_date: str = Query(default="", description="기준 날짜 YYYY-MM-DD, 없으면 오늘"),
):
    """기간별 매출 집계 — 항목별 소계 + 카테고리별 소계 + 총합계."""
    today = date.today()
    pivot = date.fromisoformat(base_date) if base_date else today

    if period == "day":
        start = pivot
        end = pivot
    elif period == "week":
        start = pivot - timedelta(days=pivot.weekday())  # 해당 주 월요일
        end = start + timedelta(days=6)
    else:  # month
        start = pivot.replace(day=1)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        end = next_month - timedelta(days=1)

    sb = get_supabase()
    try:
        result = (
            sb.table("sales_records")
            .select("item_name,category,quantity,unit_price,amount,recorded_date")
            .eq("account_id", account_id)
            .gte("recorded_date", start.isoformat())
            .lte("recorded_date", end.isoformat())
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"집계 실패: {e}")

    records = result.data or []

    # 항목별 집계
    by_item: dict[str, dict] = {}
    by_category: dict[str, int] = {}
    total_amount = 0

    for r in records:
        name = r["item_name"]
        cat = r.get("category", "기타")
        amount = r.get("amount", 0)
        qty = r.get("quantity", 1)

        if name not in by_item:
            by_item[name] = {"item_name": name, "category": cat, "quantity": 0, "amount": 0}
        by_item[name]["quantity"] += qty
        by_item[name]["amount"] += amount

        by_category[cat] = by_category.get(cat, 0) + amount
        total_amount += amount

    return {
        "data": {
            "period": period,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "total_amount": total_amount,
            "by_item": sorted(by_item.values(), key=lambda x: x["amount"], reverse=True),
            "by_category": [
                {"category": k, "amount": v}
                for k, v in sorted(by_category.items(), key=lambda x: x[1], reverse=True)
            ],
            "record_count": len(records),
        },
        "error": None,
        "meta": {},
    }


# ── DELETE /api/sales/{id} ────────────────────────────────────────────────────

@router.delete("/{record_id}")
async def delete_sale(record_id: str, account_id: str = Query(...)):
    """매출 단건 삭제 + 임베딩 제거."""
    sb = get_supabase()

    # 본인 소유 확인
    check = (
        sb.table("sales_records")
        .select("id")
        .eq("id", record_id)
        .eq("account_id", account_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="항목을 찾을 수 없습니다.")

    try:
        sb.table("sales_records").delete().eq("id", record_id).execute()
        sb.table("embeddings").delete().eq("source_id", record_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"삭제 실패: {e}")

    return {"data": {"deleted": record_id}, "error": None, "meta": {}}


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _record_to_text(record: dict) -> str:
    """sales_record 한 행을 RAG 검색용 텍스트로 변환."""
    return (
        f"{record.get('recorded_date','')} "
        f"{record.get('item_name','')} "
        f"{record.get('quantity',1)}개 "
        f"단가 {record.get('unit_price',0):,}원 "
        f"합계 {record.get('amount',0):,}원 "
        f"카테고리:{record.get('category','기타')}"
    )
