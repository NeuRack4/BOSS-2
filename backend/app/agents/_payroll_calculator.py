"""순수 Python 급여 계산 엔진 — 2026년 기준.

4대보험 / 소득세 / 지방소득세를 공식 요율로 계산한다.
부양가족은 본인 1인 고정 (소상공인 알바 대상).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from math import floor


# ──────────────────────────────────────────────────────────────
# 2026 공식 요율
# ──────────────────────────────────────────────────────────────
_NP_RATE         = 0.045          # 국민연금 (근로자 부담)
_NP_SALARY_CAP   = 5_900_000      # 국민연금 월 상한
_HI_RATE         = 0.03545        # 건강보험
_LTC_RATE        = 0.1295         # 장기요양보험 = 건강보험료 × 12.95%
_EI_RATE         = 0.009          # 고용보험
_MEAL_NONTAX_CAP = 200_000        # 비과세 식대 월 한도


# ──────────────────────────────────────────────────────────────
# 결과 데이터 클래스
# ──────────────────────────────────────────────────────────────
@dataclass
class PayrollResult:
    # 지급 내역
    base_pay:       int = 0
    overtime_pay:   int = 0
    night_pay:      int = 0
    holiday_pay:    int = 0
    meal_allowance: int = 0
    gross_pay:      int = 0   # 지급 합계

    # 공제 내역
    national_pension:    int = 0
    health_insurance:    int = 0
    ltc_insurance:       int = 0
    employment_insurance: int = 0
    income_tax:          int = 0
    local_income_tax:    int = 0
    total_deductions:    int = 0

    # 실수령액
    net_pay: int = 0

    # 계산에 쓰인 메타
    employment_type: str = ""
    hourly_rate:     int = 0
    hours_worked:    float = 0.0
    overtime_hours:  float = 0.0
    night_hours:     float = 0.0
    holiday_hours:   float = 0.0
    has_insurance:   bool = True   # 4대보험 적용 여부

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items()}


# ──────────────────────────────────────────────────────────────
# 소득세 계산 (2026 간이세액표 공식 근사, 부양가족 본인 1인)
# ──────────────────────────────────────────────────────────────

def _earned_income_deduction(annual_gross: int) -> int:
    """근로소득공제 (소득세법 제47조)."""
    A = annual_gross
    if A <= 5_000_000:
        d = int(A * 0.70)
    elif A <= 15_000_000:
        d = 3_500_000 + int((A - 5_000_000) * 0.40)
    elif A <= 45_000_000:
        d = 7_500_000 + int((A - 15_000_000) * 0.15)
    elif A <= 100_000_000:
        d = 12_000_000 + int((A - 45_000_000) * 0.05)
    else:
        d = 14_750_000 + int((A - 100_000_000) * 0.02)
    return min(d, 20_000_000)


def _tax_bracket(taxable: int) -> int:
    """산출세액 (소득세법 제55조)."""
    if taxable <= 0:
        return 0
    if taxable <= 14_000_000:
        return int(taxable * 0.06)
    elif taxable <= 50_000_000:
        return 840_000 + int((taxable - 14_000_000) * 0.15)
    elif taxable <= 88_000_000:
        return 6_240_000 + int((taxable - 50_000_000) * 0.24)
    elif taxable <= 150_000_000:
        return 15_360_000 + int((taxable - 88_000_000) * 0.35)
    elif taxable <= 300_000_000:
        return 37_060_000 + int((taxable - 150_000_000) * 0.38)
    elif taxable <= 500_000_000:
        return 94_060_000 + int((taxable - 300_000_000) * 0.40)
    else:
        return 174_060_000 + int((taxable - 500_000_000) * 0.42)


def _earned_income_tax_credit(calculated_tax: int, annual_gross: int) -> int:
    """근로소득세액공제 (소득세법 제59조)."""
    if calculated_tax <= 1_300_000:
        credit = int(calculated_tax * 0.55)
    else:
        credit = 715_000 + int((calculated_tax - 1_300_000) * 0.30)
    if annual_gross <= 33_000_000:
        cap = 740_000
    elif annual_gross <= 66_000_000:
        cap = 660_000
    else:
        cap = 500_000
    return min(credit, cap)


def _monthly_income_tax(monthly_gross: int, meal_allowance: int) -> tuple[int, int]:
    """월 소득세·지방소득세 산출. (income_tax, local_income_tax) 반환."""
    # 비과세 식대 공제
    non_tax_meal = min(meal_allowance, _MEAL_NONTAX_CAP)
    monthly_taxable = max(0, monthly_gross - non_tax_meal)
    annual_gross = monthly_taxable * 12

    if annual_gross == 0:
        return 0, 0

    ei_deduction = _earned_income_deduction(annual_gross)
    earned_income = max(0, annual_gross - ei_deduction)

    personal_deduction = 1_500_000  # 본인 1인
    taxable_base = max(0, earned_income - personal_deduction)

    calculated_tax = _tax_bracket(taxable_base)
    credit = _earned_income_tax_credit(calculated_tax, annual_gross)
    annual_tax = max(0, calculated_tax - credit)

    # 월 원천징수: 연간 세액 / 12, 10원 단위 절사
    monthly_tax = (annual_tax // 12 // 10) * 10
    local_tax   = (int(monthly_tax * 0.10) // 10) * 10
    return monthly_tax, local_tax


# ──────────────────────────────────────────────────────────────
# 급여 계산 메인 함수
# ──────────────────────────────────────────────────────────────

def calculate_payroll(
    employment_type: str,
    hourly_rate: int,
    monthly_salary: int,
    hours_worked: float,
    overtime_hours: float,
    night_hours: float,
    holiday_hours: float,
    meal_allowance: int = 200_000,
) -> PayrollResult:
    """직원 데이터 + 근무 기록 → PayrollResult.

    employment_type: '초단시간' | '시급제' | '월급제'
    meal_allowance: 사업장 지급 식대 (비과세 한도 내 자동 처리)
    """
    is_monthly = "월급" in employment_type
    is_ultra_short = "초단시간" in employment_type
    # 초단시간: 주 15h 미만 → 4대보험 전액 면제
    has_insurance = not is_ultra_short

    r = PayrollResult(employment_type=employment_type)
    r.hourly_rate    = hourly_rate
    r.hours_worked   = hours_worked
    r.overtime_hours = overtime_hours
    r.night_hours    = night_hours
    r.holiday_hours  = holiday_hours
    r.has_insurance  = has_insurance

    # ── 지급 내역 계산 ──────────────────────────────────────
    if is_monthly:
        r.base_pay     = monthly_salary
        # 월급제 연장·야간·휴일 수당: 통상시급 = 월급 / 209h (법정)
        통상시급 = int(monthly_salary / 209) if monthly_salary else 0
        r.overtime_pay  = int(통상시급 * overtime_hours * 1.5)
        r.night_pay     = int(통상시급 * night_hours * 0.5)
        r.holiday_pay   = int(통상시급 * holiday_hours * 1.5)
    else:
        r.base_pay     = int(hourly_rate * hours_worked)
        r.overtime_pay  = int(hourly_rate * overtime_hours * 1.5)
        r.night_pay     = int(hourly_rate * night_hours * 0.5)
        r.holiday_pay   = int(hourly_rate * holiday_hours * 1.5)

    r.meal_allowance = min(meal_allowance, _MEAL_NONTAX_CAP)
    r.gross_pay = r.base_pay + r.overtime_pay + r.night_pay + r.holiday_pay + r.meal_allowance

    # ── 4대보험 공제 ─────────────────────────────────────────
    if has_insurance:
        pension_base = min(r.base_pay + r.overtime_pay + r.night_pay + r.holiday_pay, _NP_SALARY_CAP)
        r.national_pension     = (int(pension_base * _NP_RATE) // 10) * 10
        r.health_insurance     = (int(r.gross_pay * _HI_RATE) // 10) * 10
        r.ltc_insurance        = (int(r.health_insurance * _LTC_RATE) // 10) * 10
        r.employment_insurance = (int(r.gross_pay * _EI_RATE) // 10) * 10

    # ── 소득세·지방소득세 ────────────────────────────────────
    r.income_tax, r.local_income_tax = _monthly_income_tax(r.gross_pay, r.meal_allowance)

    # ── 합계 ────────────────────────────────────────────────
    r.total_deductions = (
        r.national_pension
        + r.health_insurance
        + r.ltc_insurance
        + r.employment_insurance
        + r.income_tax
        + r.local_income_tax
    )
    r.net_pay = max(0, r.gross_pay - r.total_deductions)

    return r


def format_preview_table(r: PayrollResult, emp_name: str, pay_month: str) -> str:
    """급여 미리보기 마크다운 테이블 생성."""
    def won(n: int) -> str:
        return f"{n:,}원" if n else "—"

    lines: list[str] = [
        f"### {emp_name} · {pay_month} 급여 미리보기\n",
        "**지급 내역**\n",
        "| 항목 | 금액 |",
        "|------|-----:|",
        f"| 기본급 | {won(r.base_pay)} |",
    ]
    if r.overtime_pay:
        lines.append(f"| 연장수당 ({r.overtime_hours}h × {'1.5배'}) | {won(r.overtime_pay)} |")
    if r.night_pay:
        lines.append(f"| 야간수당 ({r.night_hours}h × {'0.5배 가산'}) | {won(r.night_pay)} |")
    if r.holiday_pay:
        lines.append(f"| 휴일수당 ({r.holiday_hours}h × {'1.5배'}) | {won(r.holiday_pay)} |")
    if r.meal_allowance:
        lines.append(f"| 식대 (비과세) | {won(r.meal_allowance)} |")
    lines += [
        f"| **지급 합계** | **{won(r.gross_pay)}** |",
        "",
        "**공제 내역**\n",
        "| 항목 | 금액 |",
        "|------|-----:|",
    ]
    if r.national_pension:
        lines.append(f"| 국민연금 (4.5%) | {won(r.national_pension)} |")
    if r.health_insurance:
        lines.append(f"| 건강보험 (3.545%) | {won(r.health_insurance)} |")
    if r.ltc_insurance:
        lines.append(f"| 장기요양보험 | {won(r.ltc_insurance)} |")
    if r.employment_insurance:
        lines.append(f"| 고용보험 (0.9%) | {won(r.employment_insurance)} |")
    if r.income_tax or r.local_income_tax:
        lines.append(f"| 소득세 | {won(r.income_tax)} |")
        lines.append(f"| 지방소득세 | {won(r.local_income_tax)} |")
    if not r.has_insurance:
        lines.append("| 4대보험 | 초단시간 면제 |")

    lines += [
        f"| **공제 합계** | **{won(r.total_deductions)}** |",
        "",
        f"> 💰 **실수령액: {won(r.net_pay)}**",
        "",
        "> ⚠️ 2026년 기준 계산값입니다. 연말정산 시 정산 가능성이 있으며, 4대보험 요율 변경 시 달라질 수 있어요.",
    ]
    return "\n".join(lines)
