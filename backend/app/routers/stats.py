"""매출/비용 통합 통계 API

엔드포인트:
  GET /api/stats/overview                  — 당월 매출·비용·순이익 + 전달 대비 변화율
  GET /api/stats/monthly-trend             — 최근 N개월 월별 추이 (차트용)
  GET /api/stats/daily                     — 특정 월의 일별 매출·비용 시리즈 (차트용)
  GET /api/stats/top-items                 — 기간 내 매출 상위 N개 항목 랭킹
  GET /api/stats/category-breakdown        — 카테고리별 매출 비중 (파이/바 차트용)
  GET /api/stats/hourly                    — 시간대별 매출 분포 (KST created_at 기준)
  GET /api/stats/available-compare-periods — 선택 가능한 비교 기간 목록 (드롭박스용)
  GET /api/stats/personal-benchmark        — 선택 기간 대비 비교 + 요일 패턴 (adaptive)
  GET /api/stats/benchmark-insight         — 성장 단계 + Claude Haiku 분석 + 예상 월매출
"""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)

from calendar import monthrange
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn): return fn
        return _decorator

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


_MONTH_KO = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"]


def _subtract_months(y: int, m: int, n: int) -> tuple[int, int]:
    """(y, m) 에서 n개월 빼기."""
    m -= n
    while m <= 0:
        m += 12
        y -= 1
    return y, m


def _compare_label(months_ago: int, cy: int, cm: int) -> str:
    """비교 기간 레이블 — 실제 연월 포함."""
    mon = _MONTH_KO[cm - 1]
    if months_ago == 12:
        return f"1년 전 동월 ({cy}년 {mon})"
    if months_ago == 24:
        return f"2년 전 동월 ({cy}년 {mon})"
    return f"{months_ago}개월 전 ({mon})"


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

# ── GET /api/stats/available-compare-periods ──────────────────────────────────

_COMPARE_OPTIONS = [1, 2, 3, 6, 12, 24]  # 제공할 비교 기간(개월) 후보


@router.get("/available-compare-periods")
async def available_compare_periods(account_id: str = Query(...)):
    """선택 가능한 비교 기간 목록.

    보유 데이터 기간 안에 있는 후보만 반환하고,
    각 달의 레코드 수를 조회해 데이터 충분 여부(has_sufficient_data)를 함께 반환.
    """
    today = date.today()
    sb = get_supabase()

    try:
        first_res = (
            sb.table("sales_records")
            .select("recorded_date")
            .eq("account_id", account_id)
            .order("recorded_date")
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

    if not first_res.data:
        return {"data": {"periods": [], "months_of_data": 0}, "error": None, "meta": {}}

    first_d = date.fromisoformat(first_res.data[0]["recorded_date"])
    months_of_data = (today.year - first_d.year) * 12 + (today.month - first_d.month) + 1

    periods = []
    for months_ago in _COMPARE_OPTIONS:
        if months_ago > months_of_data - 1:  # 현재 달 제외
            continue
        cy, cm = _subtract_months(today.year, today.month, months_ago)
        start, end = _month_range(cy, cm)
        try:
            cnt_res = (
                sb.table("sales_records")
                .select("id", count="exact")
                .eq("account_id", account_id)
                .gte("recorded_date", start)
                .lte("recorded_date", end)
                .execute()
            )
            record_count = cnt_res.count or 0
        except Exception:
            record_count = 0

        periods.append({
            "months_ago":          months_ago,
            "label":               _compare_label(months_ago, cy, cm),
            "year":                cy,
            "month":               cm,
            "record_count":        record_count,
            "has_sufficient_data": record_count >= 5,
        })

    return {
        "data": {"periods": periods, "months_of_data": months_of_data},
        "error": None,
        "meta": {},
    }


# ── GET /api/stats/personal-benchmark ────────────────────────────────────────

@router.get("/personal-benchmark")
async def personal_benchmark(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
    compare_months_ago: int = Query(default=1, ge=1, le=36),
):
    """이번달 vs 선택한 과거 달 비교 + 요일별 매출 패턴.

    compare_months_ago: 몇 개월 전과 비교할지 (기본 1 = 지난달).
    요일 패턴 집계 윈도우: 보유 데이터가 8주 미만이면 전체 기간 사용.
    """
    today = date.today()
    y = year or today.year
    m = month or today.month

    cy, cm = _subtract_months(y, m, compare_months_ago)
    cur_start, cur_end   = _month_range(y, m)
    cmp_start, cmp_end   = _month_range(cy, cm)

    DOW_KR = ["월", "화", "수", "목", "금", "토", "일"]
    _empty = {
        "data": {
            "year": y, "month": m,
            "vs_compare": {
                "current": 0, "previous": 0, "change_rate": None,
                "label": _compare_label(compare_months_ago, cy, cm),
                "months_ago": compare_months_ago,
            },
            "months_of_data": 0,
            "dow_avg": [{"day": d, "avg": 0} for d in DOW_KR],
            "best_day_of_week": None,
            "dow_reliable": False,
        },
        "error": None, "meta": {},
    }

    sb = get_supabase()
    try:
        cur_sales = _fetch_sales_total(sb, account_id, cur_start, cur_end)
        cmp_sales = _fetch_sales_total(sb, account_id, cmp_start, cmp_end)
    except Exception as e:
        log.error("[personal-benchmark] 매출 집계 실패: %s", e, exc_info=True)
        return _empty

    # 요일 패턴: 데이터 보유 기간 파악 후 윈도우 결정
    try:
        first_res = (
            sb.table("sales_records")
            .select("recorded_date")
            .eq("account_id", account_id)
            .order("recorded_date")
            .limit(1)
            .execute()
        )
        if first_res.data:
            first_d = date.fromisoformat(first_res.data[0]["recorded_date"])
            months_of_data = (today.year - first_d.year) * 12 + (today.month - first_d.month) + 1
            eight_weeks_ago = max(first_d, today - timedelta(weeks=8)).isoformat()
        else:
            months_of_data = 0
            eight_weeks_ago = (today - timedelta(weeks=8)).isoformat()
    except Exception:
        months_of_data = 0
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
        log.error("[personal-benchmark] 요일 집계 실패: %s", e, exc_info=True)
        return _empty

    dow_totals: dict[int, int] = {i: 0 for i in range(7)}
    dow_counts: dict[int, int] = {i: 0 for i in range(7)}
    for r in (dow_res.data or []):
        d = date.fromisoformat(r["recorded_date"])
        dow_totals[d.weekday()] += r["amount"]
        dow_counts[d.weekday()] += 1

    dow_avg = {i: (dow_totals[i] // dow_counts[i] if dow_counts[i] else 0) for i in range(7)}
    best_dow_idx = max(dow_avg, key=lambda i: dow_avg[i])
    best_day = DOW_KR[best_dow_idx] if dow_avg[best_dow_idx] > 0 else None
    dow_reliable = months_of_data >= 2

    return {
        "data": {
            "year":  y,
            "month": m,
            "vs_compare": {
                "current":      cur_sales,
                "previous":     cmp_sales,
                "change_rate":  _change_rate(cur_sales, cmp_sales),
                "label":        _compare_label(compare_months_ago, cy, cm),
                "compare_year":  cy,
                "compare_month": cm,
                "months_ago":    compare_months_ago,
            },
            "months_of_data":  months_of_data,
            "dow_avg":         [{"day": DOW_KR[i], "avg": dow_avg[i]} for i in range(7)],
            "best_day_of_week": best_day,
            "dow_reliable":    dow_reliable,
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


# ── GET /api/stats/category-breakdown ────────────────────────────────────────

@router.get("/category-breakdown")
async def category_breakdown(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
):
    """카테고리별 매출 비중.

    sales_records.category 로 그룹핑. 비중(pct)은 전체 합 기준 %.
    """
    today = date.today()
    y = year or today.year
    m = month or today.month
    start, end = _month_range(y, m)

    sb = get_supabase()
    try:
        res = (
            sb.table("sales_records")
            .select("category,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", start)
            .lte("recorded_date", end)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

    agg: dict[str, int] = {}
    for r in (res.data or []):
        cat = r.get("category") or "기타"
        agg[cat] = agg.get(cat, 0) + r["amount"]

    total = sum(agg.values())
    items = sorted(
        [
            {
                "category": k,
                "amount":   v,
                "pct":      round(v / total * 100, 1) if total else 0.0,
            }
            for k, v in agg.items()
        ],
        key=lambda x: x["amount"],
        reverse=True,
    )

    return {
        "data": {"year": y, "month": m, "total": total, "items": items},
        "error": None,
        "meta": {"period": f"{y}-{m:02d}"},
    }


# ── GET /api/stats/hourly ─────────────────────────────────────────────────────

_KST = ZoneInfo("Asia/Seoul")

_SLOT_MAP: dict[str, range] = {
    "새벽": range(0, 6),
    "오전": range(6, 12),
    "점심": range(12, 14),
    "오후": range(14, 18),
    "저녁": range(18, 22),
    "심야": range(22, 24),
}


def _hour_to_slot(h: int) -> str:
    for label, rng in _SLOT_MAP.items():
        if h in rng:
            return label
    return "기타"


@router.get("/hourly")
async def hourly_stats(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
):
    """시간대별 매출 분포.

    sales_records.created_at 을 KST 로 변환해 시(0~23)별 합산.
    데이터 입력 시각 기준이므로 실제 판매 시각과 차이가 있을 수 있음.
    """
    today = date.today()
    y = year or today.year
    m = month or today.month
    start, end = _month_range(y, m)

    sb = get_supabase()
    try:
        res = (
            sb.table("sales_records")
            .select("created_at,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", start)
            .lte("recorded_date", end)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"조회 실패: {e}")

    hourly: dict[int, int] = {h: 0 for h in range(24)}
    for r in (res.data or []):
        try:
            dt = datetime.fromisoformat(
                r["created_at"].replace("Z", "+00:00")
            ).astimezone(_KST)
            hourly[dt.hour] += r["amount"]
        except Exception:
            pass

    series = [
        {
            "hour":   h,
            "label":  f"{h}시",
            "amount": hourly[h],
            "slot":   _hour_to_slot(h),
        }
        for h in range(24)
    ]

    has_data = any(hourly[h] > 0 for h in range(24))
    peak_hour = max(range(24), key=lambda h: hourly[h]) if has_data else None

    return {
        "data": {
            "year":       y,
            "month":      m,
            "series":     series,
            "peak_hour":  peak_hour,
            "peak_slot":  _hour_to_slot(peak_hour) if peak_hour is not None else None,
        },
        "error": None,
        "meta": {"period": f"{y}-{m:02d}"},
    }


# ── GET /api/stats/benchmark-insight ─────────────────────────────────────────

@router.get("/benchmark-insight")
async def benchmark_insight(
    account_id: str = Query(...),
    year: int = Query(default=0),
    month: int = Query(default=0),
    compare_months_ago: int = Query(default=1, ge=1, le=36),
):
    """성장 단계 감지 + Claude Haiku 구조화 분석 + 예상 월매출.

    매출·비용·메뉴 실적·목표 달성률을 종합해 JSON 형식 인사이트를 반환.
    growth_stage:
      early   — 데이터 1개월 이하 or 매출 없음
      growing — 2~6개월차
      stable  — 7개월 이상
    """
    import json as _json
    from app.core.config import settings as _settings

    today = date.today()
    y = year or today.year
    m = month or today.month
    sb = get_supabase()

    # ── 데이터 보유 기간 ──────────────────────────────────────────────────────
    try:
        first_res = (
            sb.table("sales_records").select("recorded_date")
            .eq("account_id", account_id).order("recorded_date").limit(1).execute()
        )
        if first_res.data:
            first_d = date.fromisoformat(first_res.data[0]["recorded_date"])
            months_of_data = (today.year - first_d.year) * 12 + (today.month - first_d.month) + 1
        else:
            months_of_data = 0
    except Exception:
        months_of_data = 0

    # ── 기간 설정 ─────────────────────────────────────────────────────────────
    cur_start, cur_end = _month_range(y, m)
    cy, cm             = _subtract_months(y, m, compare_months_ago)
    cmp_start, cmp_end = _month_range(cy, cm)

    # ── 매출·비용 집계 ────────────────────────────────────────────────────────
    try:
        cur_sales  = _fetch_sales_total(sb, account_id, cur_start, cur_end)
        prev_sales = _fetch_sales_total(sb, account_id, cmp_start, cmp_end)
        cur_costs  = _fetch_costs_total(sb, account_id, cur_start, cur_end)
        prev_costs = _fetch_costs_total(sb, account_id, cmp_start, cmp_end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"집계 실패: {e}")

    cur_profit  = cur_sales - cur_costs
    prev_profit = prev_sales - prev_costs
    profit_margin = round(cur_profit / cur_sales * 100, 1) if cur_sales else 0

    # ── 메뉴 TOP 3 ───────────────────────────────────────────────────────────
    top_items: list[dict] = []
    try:
        items_res = (
            sb.table("sales_records").select("item_name,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", cur_start).lte("recorded_date", cur_end).execute()
        )
        agg: dict[str, int] = {}
        for r in (items_res.data or []):
            n = r["item_name"]
            agg[n] = agg.get(n, 0) + r["amount"]
        top_items = sorted(
            [{"name": k, "amount": v, "pct": round(v / cur_sales * 100, 1) if cur_sales else 0}
             for k, v in agg.items()],
            key=lambda x: x["amount"], reverse=True,
        )[:3]
    except Exception:
        pass

    # ── 카테고리별 매출 ───────────────────────────────────────────────────────
    category_lines: list[str] = []
    try:
        cat_res = (
            sb.table("sales_records").select("category,amount")
            .eq("account_id", account_id)
            .gte("recorded_date", cur_start).lte("recorded_date", cur_end).execute()
        )
        cat_agg: dict[str, int] = {}
        for r in (cat_res.data or []):
            c = r.get("category") or "기타"
            cat_agg[c] = cat_agg.get(c, 0) + r["amount"]
        for cat, amt in sorted(cat_agg.items(), key=lambda x: x[1], reverse=True):
            pct = round(amt / cur_sales * 100, 1) if cur_sales else 0
            category_lines.append(f"  {cat}: {amt:,}원 ({pct}%)")
    except Exception:
        pass

    # ── 월 목표 ───────────────────────────────────────────────────────────────
    monthly_goal = 0
    achievement_rate: float | None = None
    remaining: int | None = None
    try:
        prof_res = (
            sb.table("profiles").select("profile_meta")
            .eq("id", account_id).execute()
        )
        meta = (prof_res.data or [{}])[0].get("profile_meta") or {}
        monthly_goal = int(meta.get("monthly_sales_goal", 0))
        if monthly_goal > 0:
            achievement_rate = round(cur_sales / monthly_goal * 100, 1)
            remaining = max(monthly_goal - cur_sales, 0)
    except Exception:
        pass

    # ── 예상 월매출 ───────────────────────────────────────────────────────────
    total_days = monthrange(y, m)[1]
    elapsed    = today.day if (y == today.year and m == today.month) else total_days
    daily_avg_pred = round(cur_sales / elapsed) if elapsed > 0 and cur_sales > 0 else 0
    monthly_prediction = (
        round(daily_avg_pred * total_days) if daily_avg_pred > 0 else None
    )
    prediction_basis = {
        "elapsed_days": elapsed,
        "total_days":   total_days,
        "daily_avg":    daily_avg_pred,
    } if monthly_prediction else None

    # ── 성장 단계 ─────────────────────────────────────────────────────────────
    if months_of_data <= 1 or cur_sales == 0:
        growth_stage = "early"
    elif months_of_data <= 6:
        growth_stage = "growing"
    else:
        growth_stage = "stable"

    # ── Claude Haiku 구조화 분석 ──────────────────────────────────────────────
    ai_result: dict | None = None
    narrative = ""

    if cur_sales > 0:
        def _rate(cur: int, prev: int) -> str:
            if prev == 0:
                return "비교 불가"
            return f"{(cur - prev) / prev * 100:+.1f}%"

        stage_label    = {"early": "창업 초기", "growing": "성장 중", "stable": "안정 운영"}[growth_stage]
        compare_label  = _compare_label(compare_months_ago, cy, cm)
        top_items_text = "\n".join(
            f"  {i+1}. {t['name']}: {t['amount']:,}원 (전체의 {t['pct']}%)"
            for i, t in enumerate(top_items)
        ) or "  데이터 없음"
        cat_text   = "\n".join(category_lines) or "  데이터 없음"
        goal_text  = (
            f"{monthly_goal:,}원 목표 중 {achievement_rate}% 달성, 잔여 {remaining:,}원"
            if monthly_goal > 0 else "목표 미설정"
        )

        prompt = f"""소상공인 매출 분석 전문가로서 아래 데이터를 종합 분석하고, 반드시 JSON만 출력하세요.

[이번달 현황]
- 매출: {cur_sales:,}원 ({compare_label} 대비 {_rate(cur_sales, prev_sales)})
- 비용: {cur_costs:,}원 ({compare_label} 대비 {_rate(cur_costs, prev_costs)})
- 순이익: {cur_profit:,}원 (이익률 {profit_margin}%)
- 월 목표: {goal_text}

[메뉴 실적 TOP3]
{top_items_text}

[카테고리별 매출]
{cat_text}

[운영 현황]
- 운영 기간: {months_of_data}개월째 ({stage_label})

다음 JSON 형식으로만 답하세요 (다른 텍스트 절대 금지):
{{
  "summary": "핵심 한 줄 요약 — 숫자 나열 금지, 의미 중심으로 작성",
  "highlights": [
    {{"type": "positive", "text": "잘 된 점: 구체적인 이유와 맥락까지 설명 (2~3문장)"}},
    {{"type": "warning", "text": "주의할 점: 왜 주의해야 하는지 이유 포함 (2~3문장)"}},
    {{"type": "insight", "text": "발견한 패턴·기회: 데이터에서 발견한 인사이트와 활용 방법 (2~3문장)"}}
  ],
  "action": "오늘 당장 실천 가능한 구체적 행동 — 왜 이 행동이 효과적인지 이유까지 설명"
}}"""

        @_traceable(name="stats.benchmark_insight.llm", run_type="llm")
        async def _call_llm(p: str) -> dict:
            from app.core.llm import chat_completion
            log.info("[benchmark-insight] OpenAI gpt-4o-mini 호출")
            resp = await chat_completion(
                messages=[{"role": "user", "content": p}],
                model="gpt-4o-mini",
                max_tokens=700,
                temperature=0.5,
            )
            raw = resp.choices[0].message.content.strip()
            log.info("[benchmark-insight] LLM raw: %s", raw[:300])
            if "```" in raw:
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return _json.loads(raw)

        try:
            ai_result = await _call_llm(prompt)
        except Exception as e:
            log.error("[benchmark-insight] LLM 분석 실패: %s", e, exc_info=True)
            narrative = "AI 분석을 불러오는 중 문제가 발생했어요."

    return {
        "data": {
            "growth_stage":       growth_stage,
            "months_of_data":     months_of_data,
            "ai_result":          ai_result,
            "narrative":          narrative,
            "monthly_prediction": monthly_prediction,
            "prediction_basis":   prediction_basis,
            "cur_sales":          cur_sales,
            "prev_sales":         prev_sales,
        },
        "error": None,
        "meta": {"period": f"{y}-{m:02d}"},
    }
