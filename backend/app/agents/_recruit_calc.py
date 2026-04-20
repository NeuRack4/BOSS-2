"""채용 도메인 — 주휴수당 / 월 인건비 / 4대보험 의무 계산.

v1 BOSS(`backend/agents/hiring.py`) 에서 이식. 공식은 동일하되 2026년 기준으로 업데이트.

- 주 15시간 이상: 주휴수당 발생 + 4대보험 가입 의무 (근기법 §55·§18, 국민연금법 등).
- 월 환산: 주 근무시간 × 4.345주 (연 52주 ÷ 12월).
"""

from __future__ import annotations

# 2026년 최저임금 (시간당) — 고용노동부 고시. 연 1회 갱신.
MIN_WAGE_2026: int = 10_320

# 표시용 레거시 alias (v1 호환)
MIN_WAGE_2025 = MIN_WAGE_2026


def calc_weekly_holiday_pay(hourly_wage: int, weekly_hours: float) -> int:
    """주휴수당 (주 15h 이상 + 소정근로일 개근 시 1일분 유급)."""
    if weekly_hours < 15:
        return 0
    daily_wage = hourly_wage * (weekly_hours / 5)
    return int(daily_wage)


def calc_total_labor_cost(hourly_wage: int, weekly_hours: float) -> dict:
    """월 총 인건비 시뮬레이션.

    반환 키:
      hourly_wage / weekly_hours / weekly_holiday_pay /
      monthly_base_pay / monthly_holiday_pay / monthly_total /
      four_insurance_required / note
    """
    weekly_holiday = calc_weekly_holiday_pay(hourly_wage, weekly_hours)
    monthly_base = int(hourly_wage * weekly_hours * 4.345)
    monthly_holiday = int(weekly_holiday * 4.345)
    monthly_total = monthly_base + monthly_holiday
    four_insurance = weekly_hours >= 15

    notes: list[str] = []
    if four_insurance:
        notes.append("주 15시간 이상 → 4대보험 가입 의무")
    else:
        notes.append("주 15시간 미만 → 주휴수당 미발생, 4대보험 미가입 가능")

    return {
        "hourly_wage": hourly_wage,
        "weekly_hours": weekly_hours,
        "weekly_holiday_pay": weekly_holiday,
        "monthly_base_pay": monthly_base,
        "monthly_holiday_pay": monthly_holiday,
        "monthly_total": monthly_total,
        "four_insurance_required": four_insurance,
        "note": " / ".join(notes),
    }


def format_wage_line(
    *,
    wage_mode: str = "hourly",
    hourly_wage: int = MIN_WAGE_2026,
    annual_salary: int = 0,
    weekly_hours: float = 20.0,
) -> str:
    """시급제/연봉제 공통 표기 — LLM 프롬프트에 그대로 주입 가능."""
    if wage_mode == "annual" and annual_salary > 0:
        monthly = annual_salary // 12
        return f"세전 연봉 {annual_salary:,}원 (월 환산 {monthly:,}원)"
    sim = calc_total_labor_cost(hourly_wage, weekly_hours)
    return (
        f"시급 {hourly_wage:,}원 / 월 예상 {sim['monthly_total']:,}원 (주휴수당 포함, 주 {weekly_hours}h)"
    )
