"""메뉴 마스터 관리 — sales capability 헬퍼

upsert_menu      : 메뉴 등록(신규) 또는 가격 업데이트(기존)
list_menus_with_profit : 메뉴 목록 + 마진율 계산
"""
from __future__ import annotations

from app.core.supabase import get_supabase


async def upsert_menu(
    account_id: str,
    name: str,
    category: str,
    price: int,
    cost_price: int = 0,
    memo: str = "",
) -> dict:
    """메뉴 등록(신규) 또는 수정(기존 동일 이름)."""
    sb = get_supabase()

    existing = (
        sb.table("menus")
        .select("id")
        .eq("account_id", account_id)
        .eq("name", name)
        .execute()
    )

    if existing.data:
        menu_id = existing.data[0]["id"]
        result = (
            sb.table("menus")
            .update({
                "price":      price,
                "cost_price": cost_price,
                "category":   category,
                "memo":       memo,
            })
            .eq("id", menu_id)
            .execute()
        )
        return {"action": "updated", "menu": result.data[0]}

    result = (
        sb.table("menus")
        .insert({
            "account_id": account_id,
            "name":       name,
            "category":   category,
            "price":      price,
            "cost_price": cost_price,
            "memo":       memo,
        })
        .execute()
    )
    return {"action": "created", "menu": result.data[0]}


async def list_menus_with_profit(account_id: str) -> dict:
    """활성 메뉴 목록 + 마진율·마진액 계산."""
    sb = get_supabase()

    result = (
        sb.table("menus")
        .select("*")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .order("category")
        .order("name")
        .execute()
    )
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

    return {"menus": menus, "by_category": by_category, "total": len(menus)}
