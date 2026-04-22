"""메뉴별 수익성 분석 — sales_records 집계.

`sales.py` 의 `run_menu_analysis` 핸들러에서만 호출.
Supabase 에서 기간별 sales_records 를 조회하고 메뉴별로 집계해 순위를 반환한다.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from app.core.supabase import get_supabase

log = logging.getLogger(__name__)

# 기간 키워드 → 시작일 오프셋
_PERIOD_DAYS: dict[str, int] = {
    "오늘":    1,
    "이번주":  7,
    "7일":     7,
    "2주":     14,
    "이번달":  30,
    "30일":    30,
    "한달":    30,
    "3개월":   90,
    "90일":    90,
    "6개월":   180,
    "전체":    3650,
}


def _resolve_days(period: str) -> int:
    """period 문자열 → 조회 일수."""
    for keyword, days in _PERIOD_DAYS.items():
        if keyword in period:
            return days
    return 30  # 기본값


def _format_rank(rank: int) -> str:
    medals = {1: "🥇", 2: "🥈", 3: "🥉"}
    return medals.get(rank, f"{rank}위")


async def analyze_menu(
    *,
    account_id: str,
    period: str = "이번달",
    category: str | None = None,
    top_n: int = 10,
) -> dict[str, Any]:
    """기간별 메뉴 수익성 집계.

    반환:
    {
        "period_label": str,
        "start_date": str,
        "end_date": str,
        "total_amount": int,
        "total_quantity": int,
        "items": [
            {
                "rank": int,
                "item_name": str,
                "category": str,
                "total_quantity": int,
                "total_amount": int,
                "avg_unit_price": int,
                "revenue_ratio": float,   # 전체 대비 매출 비율 (%)
                "quantity_ratio": float,  # 전체 대비 판매량 비율 (%)
            },
            ...
        ]
    }
    """
    days = _resolve_days(period)
    today = date.today()
    start_date = (today - timedelta(days=days - 1)).isoformat()
    end_date = today.isoformat()

    sb = get_supabase()
    try:
        query = (
            sb.table("sales_records")
            .select("item_name,category,quantity,unit_price,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", start_date)
            .lte("recorded_date", end_date)
        )
        if category:
            query = query.eq("category", category)

        rows = query.execute().data or []
    except Exception as e:
        log.warning("[_menu_analysis] query failed: %s", e)
        return {"items": [], "total_amount": 0, "total_quantity": 0,
                "period_label": period, "start_date": start_date, "end_date": end_date}

    if not rows:
        return {"items": [], "total_amount": 0, "total_quantity": 0,
                "period_label": period, "start_date": start_date, "end_date": end_date}

    # 메뉴별 집계
    agg: dict[str, dict] = {}
    for row in rows:
        name = row.get("item_name", "기타")
        cat  = row.get("category", "기타")
        qty  = int(row.get("quantity") or 1)
        amt  = int(row.get("amount") or 0)

        if name not in agg:
            agg[name] = {"category": cat, "total_quantity": 0, "total_amount": 0, "price_sum": 0, "price_cnt": 0}
        agg[name]["total_quantity"] += qty
        agg[name]["total_amount"]   += amt
        if row.get("unit_price"):
            agg[name]["price_sum"] += int(row["unit_price"])
            agg[name]["price_cnt"] += 1

    total_amount   = sum(v["total_amount"]   for v in agg.values())
    total_quantity = sum(v["total_quantity"] for v in agg.values())

    # 매출 기준 정렬 후 top_n
    sorted_items = sorted(agg.items(), key=lambda x: x[1]["total_amount"], reverse=True)[:top_n]

    items = []
    for rank, (name, data) in enumerate(sorted_items, start=1):
        avg_price = (data["price_sum"] // data["price_cnt"]) if data["price_cnt"] else 0
        items.append({
            "rank":           rank,
            "item_name":      name,
            "category":       data["category"],
            "total_quantity": data["total_quantity"],
            "total_amount":   data["total_amount"],
            "avg_unit_price": avg_price,
            "revenue_ratio":  round(data["total_amount"] / total_amount * 100, 1) if total_amount else 0.0,
            "quantity_ratio": round(data["total_quantity"] / total_quantity * 100, 1) if total_quantity else 0.0,
        })

    log.info(
        "[_menu_analysis] account=%s period=%s days=%d total=%d items=%d",
        account_id, period, days, total_amount, len(items),
    )
    return {
        "period_label":   period,
        "start_date":     start_date,
        "end_date":       end_date,
        "total_amount":   total_amount,
        "total_quantity": total_quantity,
        "items":          items,
    }


def format_analysis_text(result: dict[str, Any]) -> str:
    """분석 결과 → 마크다운 텍스트."""
    items = result.get("items", [])
    if not items:
        return "해당 기간에 매출 데이터가 없어요. 매출을 먼저 입력해 주세요."

    period   = result.get("period_label", "")
    start    = result.get("start_date", "")
    end      = result.get("end_date", "")
    total    = result.get("total_amount", 0)
    total_q  = result.get("total_quantity", 0)

    lines = [
        f"## {period} 메뉴별 수익성 분석",
        f"**기간**: {start} ~ {end}  |  **총 매출**: {total:,}원  |  **총 판매량**: {total_q:,}개",
        "",
        "| 순위 | 메뉴/상품 | 카테고리 | 판매량 | 매출 | 매출비중 |",
        "|------|-----------|----------|-------:|-----:|---------:|",
    ]
    for it in items:
        rank_str = _format_rank(it["rank"])
        lines.append(
            f"| {rank_str} | {it['item_name']} | {it['category']} "
            f"| {it['total_quantity']:,}개 | {it['total_amount']:,}원 | {it['revenue_ratio']}% |"
        )

    # 인사이트 3줄
    if items:
        top   = items[0]
        worst = items[-1]
        lines += [
            "",
            "### 핵심 인사이트",
            f"- **매출 1위** {top['item_name']}이(가) 전체 매출의 **{top['revenue_ratio']}%** 를 차지해요.",
        ]
        if len(items) >= 3:
            top3_ratio = sum(i["revenue_ratio"] for i in items[:3])
            lines.append(f"- 상위 3개 메뉴가 전체 매출의 **{top3_ratio:.1f}%** 를 담당해요.")
        if len(items) >= 2:
            lines.append(
                f"- **매출 하위** {worst['item_name']}은(는) 비중이 {worst['revenue_ratio']}%로 낮아요. "
                "가격 조정 또는 프로모션을 고려해보세요."
            )

    return "\n".join(lines)
