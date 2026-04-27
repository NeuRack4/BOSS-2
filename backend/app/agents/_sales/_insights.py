"""Sales AI 인사이트 4섹션 분석

generate_sales_insight(account_id, period) → 4섹션 마크다운 리포트

4섹션 구조:
  1. 핵심 요약   — 기간 매출·비용·순이익 + 전기 대비 변화
  2. 원인 분석   — 잘된 요인 / 아쉬운 요인
  3. 추천 액션   — 구체적 행동 3가지
  4. 마케팅 제안 — 다음 달 프로모션·이벤트 아이디어
"""

from __future__ import annotations

import logging
from calendar import monthrange
from datetime import date, timedelta

from app.core.supabase import get_supabase
from app.core.llm import client as _openai_client

log = logging.getLogger(__name__)


# ── 기간 파싱 ─────────────────────────────────────────────────────────────────

def _parse_period(period: str) -> tuple[date, date, date, date]:
    """기간 문자열 → (cur_start, cur_end, prev_start, prev_end).

    지원 형식: 이번달 / 지난달 / 최근N일 / YYYY-MM / 이번주 / 1분기~4분기
    """
    today = date.today()

    def month_range(y: int, m: int) -> tuple[date, date]:
        last = monthrange(y, m)[1]
        return date(y, m, 1), date(y, m, last)

    def prev_month(y: int, m: int) -> tuple[int, int]:
        return (y - 1, 12) if m == 1 else (y, m - 1)

    p = period.strip().lower().replace(" ", "")

    # YYYY-MM 형식
    if len(p) == 7 and p[4] == "-":
        try:
            y, m = int(p[:4]), int(p[5:])
            cs, ce = month_range(y, m)
            py, pm = prev_month(y, m)
            ps, pe = month_range(py, pm)
            return cs, ce, ps, pe
        except ValueError:
            pass

    # 이번달 / 당월
    if any(k in p for k in ("이번달", "이번 달", "당월", "thismonth")):
        cs, ce = month_range(today.year, today.month)
        py, pm = prev_month(today.year, today.month)
        ps, pe = month_range(py, pm)
        return cs, ce, ps, pe

    # 지난달
    if any(k in p for k in ("지난달", "지난 달", "전월", "lastmonth")):
        py, pm = prev_month(today.year, today.month)
        cs, ce = month_range(py, pm)
        ppy, ppm = prev_month(py, pm)
        ps, pe = month_range(ppy, ppm)
        return cs, ce, ps, pe

    # 이번주
    if any(k in p for k in ("이번주", "이번 주", "thisweek")):
        mon = today - timedelta(days=today.weekday())
        cs, ce = mon, mon + timedelta(days=6)
        ps, pe = mon - timedelta(days=7), mon - timedelta(days=1)
        return cs, ce, ps, pe

    # 최근N일
    for kw in ("최근", "last", "recent"):
        if kw in p:
            num_str = "".join(c for c in p if c.isdigit())
            days = int(num_str) if num_str else 30
            ce = today
            cs = today - timedelta(days=days - 1)
            pe = cs - timedelta(days=1)
            ps = pe - timedelta(days=days - 1)
            return cs, ce, ps, pe

    # 분기
    quarter_map = {"1분기": (1, 3), "2분기": (4, 6), "3분기": (7, 9), "4분기": (10, 12)}
    for qk, (sm, em) in quarter_map.items():
        if qk in p:
            cs = date(today.year, sm, 1)
            ce = date(today.year, em, monthrange(today.year, em)[1])
            # 전년 동분기
            ps = date(today.year - 1, sm, 1)
            pe = date(today.year - 1, em, monthrange(today.year - 1, em)[1])
            return cs, ce, ps, pe

    # fallback: 이번달
    cs, ce = month_range(today.year, today.month)
    py, pm = prev_month(today.year, today.month)
    ps, pe = month_range(py, pm)
    return cs, ce, ps, pe


# ── DB 데이터 조회 ────────────────────────────────────────────────────────────

def _fetch_sales(sb, account_id: str, start: date, end: date) -> list[dict]:
    res = (
        sb.table("sales_records")
        .select("item_name,category,quantity,amount,recorded_date")
        .eq("account_id", account_id)
        .gte("recorded_date", start.isoformat())
        .lte("recorded_date", end.isoformat())
        .execute()
    )
    return res.data or []


def _fetch_costs(sb, account_id: str, start: date, end: date) -> list[dict]:
    res = (
        sb.table("cost_records")
        .select("item_name,category,amount,recorded_date")
        .eq("account_id", account_id)
        .gte("recorded_date", start.isoformat())
        .lte("recorded_date", end.isoformat())
        .execute()
    )
    return res.data or []


def _aggregate(records: list[dict]) -> dict:
    total = sum(r["amount"] for r in records)
    by_item: dict[str, int] = {}
    by_cat: dict[str, int] = {}
    for r in records:
        name = r.get("item_name", "기타")
        cat  = r.get("category",  "기타")
        by_item[name] = by_item.get(name, 0) + r["amount"]
        by_cat[cat]   = by_cat.get(cat,   0) + r["amount"]

    top_items = sorted(by_item.items(), key=lambda x: x[1], reverse=True)[:5]
    top_cats  = sorted(by_cat.items(),  key=lambda x: x[1], reverse=True)[:3]
    return {
        "total": total,
        "top_items": top_items,
        "top_cats": top_cats,
        "record_count": len(records),
    }


def _change_rate(cur: int, prev: int) -> str:
    if prev == 0:
        return "전기 데이터 없음"
    rate = (cur - prev) / prev * 100
    sign = "+" if rate >= 0 else ""
    return f"{sign}{rate:.1f}%"


def _fmt(n: int) -> str:
    if n >= 100_000_000:
        return f"{n / 100_000_000:.1f}억"
    if n >= 10_000:
        return f"{n / 10_000:.1f}만"
    return f"{n:,}"


# ── GPT-4o 4섹션 분석 (구조화 JSON) ────────────────────────────────────────

async def _llm_four_sections(data_summary: str, period_label: str) -> dict:
    """GPT-4o → 4섹션 구조화 JSON 반환.

    반환 스키마:
    {
      "summary": "핵심 요약 2~3줄 텍스트",
      "good_factors": ["잘된 요인1", "잘된 요인2"],
      "bad_factors":  ["아쉬운 요인1", "아쉬운 요인2"],
      "actions":      ["액션1", "액션2", "액션3"],
      "marketing":    ["제안1", "제안2"]
    }
    """
    import json as _json

    system = (
        "당신은 소상공인 전문 비즈니스 애널리스트입니다. "
        "아래 매출/비용 데이터를 분석해 반드시 JSON 형식으로만 응답하세요.\n\n"
        "JSON 스키마:\n"
        '{"summary":"핵심 요약 2~3줄",'
        '"good_factors":["잘된 요인1","잘된 요인2"],'
        '"bad_factors":["아쉬운 요인1","아쉬운 요인2"],'
        '"actions":["즉시 실행 가능한 액션1","액션2","액션3"],'
        '"marketing":["다음달 마케팅 제안1","제안2"]}\n\n'
        "규칙: 막연한 조언 금지. 데이터 기반 구체적 내용. 친근하되 전문적 톤."
    )
    user = f"[분석 기간: {period_label}]\n\n{data_summary}"

    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=800,
        )
        raw = resp.choices[0].message.content or "{}"
        return _json.loads(raw)
    except Exception as e:
        log.warning("[_insights] LLM 호출 실패: %s", e)
        return {}


# ── 메인 진입점 ───────────────────────────────────────────────────────────────

async def generate_sales_insight(
    account_id: str,
    period: str,
    target: str | None = None,
) -> str:
    """실데이터 기반 4섹션 AI 인사이트 생성."""
    sb = get_supabase()

    cur_start, cur_end, prev_start, prev_end = _parse_period(period)
    period_label = f"{cur_start} ~ {cur_end}"

    # 데이터 조회
    cur_sales  = _fetch_sales(sb, account_id, cur_start, cur_end)
    cur_costs  = _fetch_costs(sb, account_id, cur_start, cur_end)
    prev_sales = _fetch_sales(sb, account_id, prev_start, prev_end)
    prev_costs = _fetch_costs(sb, account_id, prev_start, prev_end)

    # 집계
    cs = _aggregate(cur_sales)
    cc = _aggregate(cur_costs)
    ps = _aggregate(prev_sales)
    pc = _aggregate(prev_costs)

    cur_profit  = cs["total"] - cc["total"]
    prev_profit = ps["total"] - pc["total"]

    # 데이터 없음 처리
    if cs["total"] == 0 and cc["total"] == 0:
        msg = (
            f"**{period_label}** 기간에 매출·비용 데이터가 없어요.\n\n"
            "챗봇에서 매출이나 비용을 먼저 입력해주시면 분석해드릴게요."
        )
        return {"chat_text": msg, "clean_content": msg}

    # 데이터 요약 구성 (LLM 입력용)
    top_sales_str = ", ".join(
        f"{name}({_fmt(amt)}원)" for name, amt in cs["top_items"]
    ) or "없음"
    top_cost_str = ", ".join(
        f"{cat}({_fmt(amt)}원)" for cat, amt in cc["top_cats"]
    ) or "없음"

    data_summary = f"""
[현재 기간 매출]
- 총 매출: {_fmt(cs['total'])}원 (전기 대비 {_change_rate(cs['total'], ps['total'])})
- 총 비용: {_fmt(cc['total'])}원 (전기 대비 {_change_rate(cc['total'], pc['total'])})
- 순이익:  {_fmt(cur_profit)}원 (전기 대비 {_change_rate(cur_profit, prev_profit)})
- 거래 건수: {cs['record_count']}건

[매출 상위 품목]
{top_sales_str}

[비용 상위 항목]
{top_cost_str}

[전기 기간: {prev_start} ~ {prev_end}]
- 전기 매출: {_fmt(ps['total'])}원
- 전기 비용: {_fmt(pc['total'])}원
- 전기 순이익: {_fmt(prev_profit)}원
""".strip()

    if target:
        data_summary += f"\n\n[분석 대상 집중: {target}]"

    # 4섹션 LLM 분석 (구조화 JSON)
    import json as _json

    sections = await _llm_four_sections(data_summary, period_label)

    if not sections:
        msg = (
            f"📊 **{period_label} 매출 요약**\n\n"
            f"- 매출: {_fmt(cs['total'])}원 ({_change_rate(cs['total'], ps['total'])})\n"
            f"- 비용: {_fmt(cc['total'])}원\n"
            f"- 순이익: {_fmt(cur_profit)}원\n\n"
            "상세 분석은 잠시 후 다시 시도해주세요."
        )
        return {"chat_text": msg, "clean_content": msg}

    # 카드용 JSON 마커 조립
    card_data = {
        "period":         period_label,
        "sales":          cs["total"],
        "costs":          cc["total"],
        "profit":         cur_profit,
        "sales_change":   _change_rate(cs["total"], ps["total"]),
        "costs_change":   _change_rate(cc["total"], pc["total"]),
        "profit_change":  _change_rate(cur_profit, prev_profit),
        "top_items":      [{"name": name, "amount": amt} for name, amt in cs["top_items"]],
        "summary":        sections.get("summary", ""),
        "good_factors":   sections.get("good_factors", []),
        "bad_factors":    sections.get("bad_factors", []),
        "actions":        sections.get("actions", []),
        "marketing":      sections.get("marketing", []),
    }

    # 채팅용 — 시각화 마커 포함
    marker = f"[[SALES_INSIGHT:{_json.dumps(card_data, ensure_ascii=False)}]]"
    chat_text = f"📊 **{period_label} 매출 인사이트**\n{marker}"

    # artifact 저장용 — 마커 없는 사람이 읽을 수 있는 텍스트
    good = "\n".join(f"- {f}" for f in sections.get("good_factors", []))
    bad  = "\n".join(f"- {f}" for f in sections.get("bad_factors", []))
    acts = "\n".join(f"{i+1}. {a}" for i, a in enumerate(sections.get("actions", [])))
    mkts = "\n".join(f"- {m}" for m in sections.get("marketing", []))
    clean_content = (
        f"## 핵심 요약\n{sections.get('summary', '')}\n\n"
        f"## 매출 현황\n"
        f"- 매출: {_fmt(cs['total'])}원 ({_change_rate(cs['total'], ps['total'])})\n"
        f"- 비용: {_fmt(cc['total'])}원\n"
        f"- 순이익: {_fmt(cur_profit)}원\n\n"
        f"## 원인 분석\n### 잘된 요인\n{good}\n### 아쉬운 요인\n{bad}\n\n"
        f"## 추천 액션\n{acts}\n\n"
        f"## 마케팅 제안\n{mkts}"
    )

    return {"chat_text": chat_text, "clean_content": clean_content, "card_data": card_data}
