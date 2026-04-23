"""Square POS 연동 — 주문 동기화

주요 함수:
  fetch_square_orders(account_id, location_id, start_date, end_date)
    → Square Orders API 호출 → sales_records bulk insert → artifact 생성

Square API 엔드포인트:
  GET  /v2/locations          — 매장 위치 목록
  POST /v2/orders/search      — 기간별 주문 조회
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, date, timedelta
from typing import Any

import httpx

from app.core.config import settings
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn): return fn
        return _decorator

SQUARE_BASE = {
    "sandbox":    "https://connect.squareupsandbox.com",
    "production": "https://connect.squareup.com",
}


def _base_url() -> str:
    return SQUARE_BASE.get(settings.square_environment, SQUARE_BASE["sandbox"])


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.square_access_token}",
        "Content-Type":  "application/json",
        "Square-Version": "2024-01-17",
    }


# ── 위치 목록 ──────────────────────────────────────────────────────────────────

@_traceable(name="square.get_locations")
async def get_locations() -> list[dict]:
    """계정에 등록된 Square 매장 위치 목록 반환."""
    url = f"{_base_url()}/v2/locations"
    log.info("[Square] ▶ GET locations | env=%s | url=%s", settings.square_environment, url)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers=_headers())
        resp.raise_for_status()
        data = resp.json()
        locations = data.get("locations") or []
        log.info("[Square] ✅ locations 응답 | 위치 수=%d", len(locations))
        for loc in locations:
            log.info("[Square]   └ id=%s name=%s", loc.get("id"), loc.get("name"))
        return locations


# ── 주문 조회 ──────────────────────────────────────────────────────────────────

@_traceable(name="square.fetch_orders")
async def fetch_orders(
    location_id: str,
    start_date: date,
    end_date: date,
) -> list[dict]:
    """Square Orders API — 기간 내 주문 반환."""
    start_at = datetime(start_date.year, start_date.month, start_date.day,
                        0, 0, 0, tzinfo=timezone.utc).isoformat()
    end_at   = datetime(end_date.year,   end_date.month,   end_date.day,
                        23, 59, 59, tzinfo=timezone.utc).isoformat()
    states = ["COMPLETED", "OPEN"] if settings.square_environment == "sandbox" else ["COMPLETED"]
    log.info(
        "[Square] ▶ POST orders/search | location=%s | %s ~ %s | states=%s",
        location_id, start_date, end_date, states,
    )
    body = {
        "location_ids": [location_id],
        "query": {
            "filter": {
                "state_filter":      {"states": states},
                "date_time_filter": {
                    "created_at": {"start_at": start_at, "end_at": end_at}
                },
            },
            "sort": {"sort_field": "CREATED_AT", "sort_order": "ASC"},
        },
        "limit": 500,
    }
    orders: list[dict] = []
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            resp = await client.post(
                f"{_base_url()}/v2/orders/search",
                headers=_headers(),
                json=body,
            )
            resp.raise_for_status()
            data  = resp.json()
            batch = data.get("orders") or []
            orders.extend(batch)
            cursor = data.get("cursor")
            if not cursor:
                break
            body["cursor"] = cursor
    log.info("[Square] ✅ orders/search 완료 | 총 주문 수=%d", len(orders))
    return orders


# ── 주문 → sales_records 변환 ──────────────────────────────────────────────────

def _parse_money(money: dict | None) -> int:
    """Square Money 객체 → 원화 정수.

    KRW: 소수점 없음 → raw 값 그대로.
    USD (sandbox 테스트용): 사용자가 원화 숫자로 입력했으므로 raw 값 그대로 사용.
    실제 USD 결제 연동 시 환율 변환 필요.
    """
    if not money:
        return 0
    return int(money.get("amount") or 0)


def parse_orders_to_records(orders: list[dict]) -> list[dict]:
    """Square 주문 목록 → sales_records insert 형식 변환."""
    rows: list[dict] = []
    for order in orders:
        created_at = order.get("created_at") or ""
        try:
            recorded_date = datetime.fromisoformat(
                created_at.replace("Z", "+00:00")
            ).date().isoformat()
        except Exception:
            recorded_date = date.today().isoformat()

        line_items = order.get("line_items") or []
        if not line_items:
            # 품목 없는 주문: 합계만 기록
            total = _parse_money(order.get("total_money"))
            if total > 0:
                rows.append({
                    "recorded_date": recorded_date,
                    "item_name":     "Square 주문",
                    "category":      "기타",
                    "quantity":      1,
                    "unit_price":    total,
                    "amount":        total,
                    "source":        "pos",
                    "raw_input":     f"square_order_id={order.get('id','')}",
                    "metadata":      {"square_order_id": order.get("id")},
                })
            continue

        for item in line_items:
            name     = item.get("name") or "기타 품목"
            qty      = int(item.get("quantity") or "1")
            unit_m   = _parse_money(item.get("base_price_money"))
            total_m  = _parse_money(item.get("total_money"))
            amount   = total_m if total_m else unit_m * qty
            rows.append({
                "recorded_date": recorded_date,
                "item_name":     name,
                "category":      _guess_category(name),
                "quantity":      qty,
                "unit_price":    unit_m,
                "amount":        amount,
                "source":        "pos",
                "raw_input":     f"square_order_id={order.get('id','')}",
                "metadata":      {"square_order_id": order.get("id"), "square_item_uid": item.get("uid")},
            })
    return rows


def _guess_category(name: str) -> str:
    """품목명으로 카테고리 추론."""
    lower = name.lower()
    if any(k in lower for k in ("coffee", "라떼", "아메리카노", "에스프레소", "tea", "음료", "drink")):
        return "음료"
    if any(k in lower for k in ("cake", "cookie", "dessert", "디저트", "케이크", "빵", "croffle")):
        return "디저트"
    if any(k in lower for k in ("food", "meal", "밥", "면", "식사", "burger", "pizza")):
        return "음식"
    return "기타"


# ── sales_records 저장 + artifact 생성 ────────────────────────────────────────

@_traceable(name="square.sync_pos_to_sales")
async def sync_pos_to_sales(
    account_id: str,
    location_id: str,
    start_date: date,
    end_date: date,
) -> dict:
    """Square 주문 → sales_records bulk insert + revenue_entry artifact 생성."""
    log.info(
        "[Square] ══════════════════════════════════════════",
    )
    log.info(
        "[Square] POS 동기화 시작 | account=%s | %s ~ %s",
        account_id, start_date, end_date,
    )
    orders  = await fetch_orders(location_id, start_date, end_date)
    records = parse_orders_to_records(orders)
    log.info("[Square] 파싱 완료 | 주문=%d건 → 품목=%d개", len(orders), len(records))

    if not records:
        log.info("[Square] 저장할 품목 없음 → 종료")
        return {"saved": 0, "orders": len(orders), "artifact_id": None}

    sb = get_supabase()

    # sales_records bulk insert
    rows = [{"account_id": account_id, **r} for r in records]
    try:
        sb.table("sales_records").insert(rows).execute()
    except Exception as e:
        raise RuntimeError(f"sales_records 저장 실패: {e}")

    total_amount = sum(r["amount"] for r in records)
    period_label = f"{start_date} ~ {end_date}"

    # Revenue 서브허브 찾기
    hub_res = (
        sb.table("artifacts")
        .select("id")
        .eq("account_id", account_id)
        .eq("kind", "domain").eq("type", "category")
        .ilike("title", "%Revenue%")
        .limit(1).execute()
    )
    revenue_hub_id = hub_res.data[0]["id"] if hub_res.data else None

    # revenue_entry artifact 생성
    art_res = sb.table("artifacts").insert({
        "account_id": account_id,
        "kind":       "artifact",
        "type":       "revenue_entry",
        "domains":    ["sales"],
        "title":      f"[POS] {period_label} 매출 ({len(records)}건)",
        "content":    f"Square POS 동기화 · 총 {total_amount:,}원 · {len(records)}개 항목",
        "status":     "active",
        "metadata":   {
            "source":             "pos",
            "square_location_id": location_id,
            "period":             period_label,
            "recorded_date":      start_date.isoformat(),  # NodeDetailModal 레코드 조회용
            "total_amount":       total_amount,
            "record_count":       len(records),
            "order_count":        len(orders),
        },
    }).execute()

    artifact_id = art_res.data[0]["id"] if art_res.data else None

    if revenue_hub_id and artifact_id:
        sb.table("artifact_edges").insert({
            "account_id": account_id,
            "parent_id":  revenue_hub_id,
            "child_id":   artifact_id,
            "relation":   "contains",
        }).execute()

    # activity_log
    if artifact_id:
        try:
            sb.table("activity_logs").insert({
                "account_id":  account_id,
                "type":        "artifact_created",
                "domain":      "sales",
                "title":       f"[POS] {period_label} 매출 동기화",
                "description": f"Square POS · {len(orders)}건 주문 · 총 {total_amount:,}원",
                "metadata":    {"artifact_id": artifact_id, "source": "pos"},
            }).execute()
        except Exception:
            pass

    log.info(
        "[Square] ✅ 동기화 완료 | 저장=%d개 | 총액=%s원 | artifact=%s",
        len(records), f"{total_amount:,}", artifact_id,
    )
    log.info("[Square] ══════════════════════════════════════════")
    return {
        "saved":        len(records),
        "orders":       len(orders),
        "total_amount": total_amount,
        "artifact_id":  artifact_id,
    }
