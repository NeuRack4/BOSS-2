"""메뉴 마스터 REST API

엔드포인트:
  POST   /api/menus          — 메뉴 등록
  GET    /api/menus          — 메뉴 목록 조회 (카테고리별 그룹화)
  PATCH  /api/menus/{id}     — 메뉴 수정
  DELETE /api/menus/{id}     — 메뉴 삭제
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/menus", tags=["menus"])


# ── 스키마 ────────────────────────────────────────────────────────────────────

class MenuCreateRequest(BaseModel):
    account_id: str
    name: str
    category: str = "기타"
    price: int = 0
    cost_price: int = 0
    memo: str = ""

    @field_validator("price", "cost_price")
    @classmethod
    def validate_price(cls, v: int) -> int:
        if v < 0:
            raise ValueError("가격은 0 이상이어야 합니다.")
        return v


class MenuPatchRequest(BaseModel):
    account_id: str
    name: str | None = None
    category: str | None = None
    price: int | None = None
    cost_price: int | None = None
    is_active: bool | None = None
    memo: str | None = None


# ── POST /api/menus ───────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_menu(req: MenuCreateRequest):
    """메뉴 등록. 동일 이름 존재 시 409."""
    sb = get_supabase()

    existing = (
        sb.table("menus")
        .select("id")
        .eq("account_id", req.account_id)
        .eq("name", req.name)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail=f"'{req.name}' 메뉴가 이미 존재합니다.")

    try:
        result = (
            sb.table("menus")
            .insert({
                "account_id": req.account_id,
                "name":       req.name,
                "category":   req.category,
                "price":      req.price,
                "cost_price": req.cost_price,
                "memo":       req.memo,
            })
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"등록 실패: {e}")

    return {"data": {"menu": result.data[0]}, "error": None, "meta": {}}


# ── GET /api/menus ────────────────────────────────────────────────────────────

@router.get("")
async def list_menus(
    account_id: str = Query(...),
    category: str = Query(default=""),
    active_only: bool = Query(default=True),
):
    """메뉴 목록 조회. 카테고리별 그룹화 + 마진율 계산 포함."""
    sb = get_supabase()

    query = (
        sb.table("menus")
        .select("*")
        .eq("account_id", account_id)
        .order("category")
        .order("name")
    )
    if active_only:
        query = query.eq("is_active", True)
    if category:
        query = query.eq("category", category)

    try:
        result = query.execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

    menus = result.data or []

    for m in menus:
        price = m.get("price", 0)
        cost  = m.get("cost_price", 0)
        if price > 0:
            m["margin_rate"]   = round((price - cost) / price * 100, 1)
            m["margin_amount"] = price - cost
        else:
            m["margin_rate"]   = None
            m["margin_amount"] = None

    by_category: dict[str, list] = {}
    for m in menus:
        by_category.setdefault(m["category"], []).append(m)

    return {
        "data": {
            "menus":       menus,
            "by_category": by_category,
            "total":       len(menus),
        },
        "error": None,
        "meta": {},
    }


# ── PATCH /api/menus/{id} ─────────────────────────────────────────────────────

@router.patch("/{menu_id}")
async def update_menu(menu_id: str, req: MenuPatchRequest):
    """메뉴 수정. 전달된 필드만 업데이트."""
    sb = get_supabase()

    check = (
        sb.table("menus")
        .select("id")
        .eq("id", menu_id)
        .eq("account_id", req.account_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="메뉴를 찾을 수 없습니다.")

    updates = {
        k: v for k, v in {
            "name":       req.name,
            "category":   req.category,
            "price":      req.price,
            "cost_price": req.cost_price,
            "is_active":  req.is_active,
            "memo":       req.memo,
        }.items() if v is not None
    }
    if not updates:
        raise HTTPException(status_code=400, detail="수정할 필드가 없습니다.")

    try:
        result = (
            sb.table("menus")
            .update(updates)
            .eq("id", menu_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"수정 실패: {e}")

    return {"data": {"menu": result.data[0]}, "error": None, "meta": {}}


# ── DELETE /api/menus/{id} ────────────────────────────────────────────────────

@router.delete("/{menu_id}")
async def delete_menu(menu_id: str, account_id: str = Query(...)):
    """메뉴 삭제."""
    sb = get_supabase()

    check = (
        sb.table("menus")
        .select("id")
        .eq("id", menu_id)
        .eq("account_id", account_id)
        .execute()
    )
    if not check.data:
        raise HTTPException(status_code=404, detail="메뉴를 찾을 수 없습니다.")

    try:
        sb.table("menus").delete().eq("id", menu_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"삭제 실패: {e}")

    return {"data": {"deleted": menu_id}, "error": None, "meta": {}}
