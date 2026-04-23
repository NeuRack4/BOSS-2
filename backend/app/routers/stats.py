"""매출/비용 통합 통계 API

엔드포인트:
  GET /api/stats/overview        — 당월 매출·비용·순이익 + 전달 대비 변화율
  GET /api/stats/monthly-trend   — 최근 N개월 월별 추이 (차트용)
  GET /api/stats/daily           — 특정 월의 일별 매출·비용 시리즈 (차트용)
  GET /api/stats/top-items       — 기간 내 매출 상위 N개 항목 랭킹
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator

from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/stats", tags=["stats"])


# ── 내부 헬퍼 ────────────────────────────────────────────────────────────────

def _month_range(year: int, month: int) -> tuple[str, str]:
    last_day = monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"


def _prev_month(year: int, month: int) -> tuple[int, int]:
    if month == 1:
        return year - 1, 12
    return year, month - 1


def _fetch_sales_total(sb, account_id: str, start: str, end: str) -> int:
    res = (
        sb.table("sales_records")
        .select("amount")
        .eq("account_id", account_id)
        .gte("recorded_date", start)
        .lte("recorded_date", end)
        .execute()
    )
    return sum(r["amount"] for r in (res.data or []))


def _fetch_costs_total(sb, account_id: str, start: str, end: str) -> int:
    res = (
        sb.table("cost_records")
        .select("amount")
        .eq("account_id", account_id)
        .gte("recorded_date", start)
        .lte("recorded_date", end)
        .execute()
    )
    return sum(r["amount"] for r in (res.data or []))


def _change_rate(current: int, previous: int) -> float | None:
    """전달 대비 변화율(%). 전달이 0이면 None."""
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


# ── GET /api/stats/overview ───────────────────────────────────────────────────

@router.get("/overview")
async def stats_overview(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
):
    """당월 매출·비용·순이익 요약 + 전달 대비 변화율.

    year/month 생략 시 현재 월 기준.
    """
    today = date.today()
    y = year or today.year
    m = month or today.month

    cur_start, cur_end = _month_range(y, m)
    py, pm = _prev_month(y, m)
    prev_start, prev_end = _month_range(py, pm)

    sb = get_supabase()
    try:
        cur_sales  = _fetch_sales_total(sb, account_id, cur_start, cur_end)
        cur_costs  = _fetch_costs_total(sb, account_id, cur_start, cur_end)
        prev_sales = _fetch_sales_total(sb, account_id, prev_start, prev_end)
        prev_costs = _fetch_costs_total(sb, account_id, prev_start, prev_end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"집계 실패: {e}")

    cur_profit  = cur_sales  - cur_costs
    prev_profit = prev_sales - prev_costs

    # 일평균 매출: 오늘 기준 경과 일수 (당월이면 오늘까지, 과거 월이면 전체 일수)
    if y == today.year and m == today.month:
        elapsed_days = today.day
    else:
        elapsed_days = monthrange(y, m)[1]
    daily_avg = round(cur_sales / elapsed_days) if elapsed_days else 0

    return {
        "data": {
            "year": y,
            "month": m,
            "sales": {
                "total":       cur_sales,
                "prev_total":  prev_sales,
                "change_rate": _change_rate(cur_sales, prev_sales),
                "daily_avg":   daily_avg,
            },
            "costs": {
                "total":       cur_costs,
                "prev_total":  prev_costs,
                "change_rate": _change_rate(cur_costs, prev_costs),
            },
            "profit": {
                "total":       cur_profit,
                "prev_total":  prev_profit,
                "change_rate": _change_rate(cur_profit, prev_profit),
            },
        },
        "error": None,
        "meta": {"period": f"{y}-{m:02d}"},
    }


# ── GET /api/stats/monthly-trend ─────────────────────────────────────────────

@router.get("/monthly-trend")
async def monthly_trend(
    account_id: str = Query(...),
    months: int = Query(default=6, ge=1, le=24),
):
    """최근 N개월 월별 매출·비용·순이익 시리즈.

    차트 라이브러리에 바로 넘길 수 있는 배열 반환.
    """
    today = date.today()
    sb = get_supabase()

    series: list[dict] = []
    y, m = today.year, today.month

    # 최근 months개월치를 역순으로 수집 후 시간순 정렬
    for _ in range(months):
        start, end = _month_range(y, m)
        try:
            sales = _fetch_sales_total(sb, account_id, start, end)
            costs = _fetch_costs_total(sb, account_id, start, end)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"집계 실패: {e}")

        series.append({
            "year":   y,
            "month":  m,
            "label":  f"{m}월",
            "sales":  sales,
            "costs":  costs,
            "profit": sales - costs,
        })
        y, m = _prev_month(y, m)

    series.reverse()  # 오래된 달 → 최근 달 순

    return {
        "data": {"series": series, "months": months},
        "error": None,
        "meta": {},
    }


# ── GET /api/stats/daily ──────────────────────────────────────────────────────

@router.get("/daily")
async def daily_stats(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
):
    """특정 월의 일별 매출·비용 시리즈.

    빠진 날짜는 0으로 채워서 반환 (차트 연속성 보장).
    """
    today = date.today()
    y = year or today.year
    m = month or today.month

    start_str, end_str = _month_range(y, m)
    start_d = date(y, m, 1)
    end_d   = date(y, m, monthrange(y, m)[1])

    sb = get_supabase()
    try:
        sales_res = (
            sb.table("sales_records")
            .select("recorded_date,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", start_str)
            .lte("recorded_date", end_str)
            .execute()
        )
        costs_res = (
            sb.table("cost_records")
            .select("recorded_date,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", start_str)
            .lte("recorded_date", end_str)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

    # 날짜별 합산
    sales_by_day: dict[str, int] = {}
    for r in (sales_res.data or []):
        d = r["recorded_date"]
        sales_by_day[d] = sales_by_day.get(d, 0) + r["amount"]

    costs_by_day: dict[str, int] = {}
    for r in (costs_res.data or []):
        d = r["recorded_date"]
        costs_by_day[d] = costs_by_day.get(d, 0) + r["amount"]

    # 전체 날짜 채우기
    series: list[dict] = []
    cur = start_d
    while cur <= end_d:
        ds = cur.isoformat()
        s = sales_by_day.get(ds, 0)
        c = costs_by_day.get(ds, 0)
        series.append({
            "date":   ds,
            "day":    cur.day,
            "sales":  s,
            "costs":  c,
            "profit": s - c,
        })
        cur += timedelta(days=1)

    return {
        "data": {
            "year":   y,
            "month":  m,
            "series": series,
        },
        "error": None,
        "meta": {"period": f"{y}-{m:02d}"},
    }


# ── GET /api/stats/top-items ──────────────────────────────────────────────────

@router.get("/top-items")
async def top_items(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
    limit: int = Query(default=10, ge=1, le=50),
):
    """기간 내 매출 상위 N개 항목 랭킹.

    같은 item_name 기준으로 판매량·매출액 합산 후 매출액 내림차순 정렬.
    """
    today = date.today()
    y = year or today.year
    m = month or today.month

    start, end = _month_range(y, m)
    sb = get_supabase()

    try:
        res = (
            sb.table("sales_records")
            .select("item_name,category,quantity,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", start)
            .lte("recorded_date", end)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

    # 항목별 합산
    agg: dict[str, dict] = {}
    for r in (res.data or []):
        name = r["item_name"]
        if name not in agg:
            agg[name] = {
                "item_name": name,
                "category":  r.get("category", "기타"),
                "quantity":  0,
                "amount":    0,
                "rank":      0,
            }
        agg[name]["quantity"] += r.get("quantity", 1)
        agg[name]["amount"]   += r.get("amount", 0)

    # 매출액 내림차순 정렬 + 순위 부여
    ranked = sorted(agg.values(), key=lambda x: x["amount"], reverse=True)
    for i, item in enumerate(ranked[:limit], start=1):
        item["rank"] = i

    return {
        "data": {
            "year":  y,
            "month": m,
            "items": ranked[:limit],
            "total_items": len(ranked),
        },
        "error": None,
        "meta": {},
    }


# ── GET /api/stats/personal-benchmark ────────────────────────────────────────

@router.get("/personal-benchmark")
async def personal_benchmark(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
):
    """이번달 vs 지난달 vs 전년 동월 비교 + 최근 8주 요일별 최고 매출 분석."""
    today = date.today()
    y = year or today.year
    m = month or today.month

    cur_start, cur_end   = _month_range(y, m)
    py, pm               = _prev_month(y, m)
    prev_start, prev_end = _month_range(py, pm)
    ly_start, ly_end     = _month_range(y - 1, m)

    sb = get_supabase()
    try:
        cur_sales  = _fetch_sales_total(sb, account_id, cur_start, cur_end)
        prev_sales = _fetch_sales_total(sb, account_id, prev_start, prev_end)
        ly_sales   = _fetch_sales_total(sb, account_id, ly_start, ly_end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"집계 실패: {e}")

    eight_weeks_ago = (today - timedelta(weeks=8)).isoformat()
    try:
        dow_res = (
            sb.table("sales_records")
            .select("recorded_date,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", eight_weeks_ago)
            .lte("recorded_date", today.isoformat())
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"요일 집계 실패: {e}")

    DOW_KR = ["월", "화", "수", "목", "금", "토", "일"]
    dow_totals: dict[int, int] = {i: 0 for i in range(7)}
    dow_counts: dict[int, int] = {i: 0 for i in range(7)}
    for r in (dow_res.data or []):
        d = date.fromisoformat(r["recorded_date"])
        dow_totals[d.weekday()] += r["amount"]
        dow_counts[d.weekday()] += 1

    dow_avg = {i: (dow_totals[i] // dow_counts[i] if dow_counts[i] else 0) for i in range(7)}
    best_dow_idx = max(dow_avg, key=lambda i: dow_avg[i])
    best_day = DOW_KR[best_dow_idx] if dow_avg[best_dow_idx] > 0 else None

    return {
        "data": {
            "year":  y,
            "month": m,
            "vs_last_month": {
                "current":     cur_sales,
                "previous":    prev_sales,
                "change_rate": _change_rate(cur_sales, prev_sales),
                "label":       "지난달 대비",
            },
            "vs_last_year": {
                "current":     cur_sales,
                "previous":    ly_sales,
                "change_rate": _change_rate(cur_sales, ly_sales),
                "label":       "전년 동월 대비",
            },
            "best_day_of_week": best_day,
            "dow_avg": [{"day": DOW_KR[i], "avg": dow_avg[i]} for i in range(7)],
        },
        "error": None,
        "meta": {},
    }


# ── POST /api/stats/goal + GET /api/stats/goal ────────────────────────────────

class GoalRequest(BaseModel):
    account_id: str
    monthly_goal: int

    @field_validator("monthly_goal")
    @classmethod
    def validate_goal(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("목표 매출은 0보다 커야 합니다.")
        return v


@router.post("/goal", status_code=201)
async def set_monthly_goal(req: GoalRequest):
    """월 목표 매출 저장 (profiles.profile_meta.monthly_sales_goal)."""
    sb = get_supabase()
    try:
        profile = sb.table("profiles").select("profile_meta").eq("id", req.account_id).execute()
        meta = (profile.data or [{}])[0].get("profile_meta") or {}
        meta["monthly_sales_goal"] = req.monthly_goal
        sb.table("profiles").update({"profile_meta": meta}).eq("id", req.account_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"저장 실패: {e}")

    return {"data": {"monthly_goal": req.monthly_goal}, "error": None, "meta": {}}


@router.get("/goal")
async def get_monthly_goal(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
):
    """월 목표 대비 현재 달성률."""
    today = date.today()
    y = year or today.year
    m = month or today.month

    sb = get_supabase()
    try:
        profile = sb.table("profiles").select("profile_meta").eq("id", account_id).execute()
        meta = (profile.data or [{}])[0].get("profile_meta") or {}
        goal = int(meta.get("monthly_sales_goal", 0))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"목표 조회 실패: {e}")

    cur_start, cur_end = _month_range(y, m)
    try:
        current = _fetch_sales_total(sb, account_id, cur_start, cur_end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"매출 조회 실패: {e}")

    achievement_rate = round(current / goal * 100, 1) if goal > 0 else None

    return {
        "data": {
            "monthly_goal":     goal,
            "current_sales":    current,
            "achievement_rate": achievement_rate,
            "remaining":        max(goal - current, 0) if goal > 0 else None,
        },
        "error": None,
        "meta": {"period": f"{y}-{m:02d}"},
    }
