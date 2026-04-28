"""Sales 도메인 DeepAgent 터미널 툴 + 결과 저장소.

marketing.py 의 _marketing_tools.py 와 동일 패턴.
각 터미널 툴은 결과를 ContextVar 에 저장하고 즉시 종료한다.
_run_sales_agent() 가 저장된 결과를 꺼내 execute 함수로 라우팅한다.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import Any

from langchain_core.tools import tool

_sales_result: ContextVar[dict[str, Any] | None] = ContextVar(
    "boss2.sales_result", default=None
)
_sales_extra: ContextVar[dict[str, Any]] = ContextVar(
    "boss2.sales_extra", default={}
)


def init_sales_result_store(extra: dict | None = None) -> None:
    _sales_result.set(None)
    _sales_extra.set(extra or {})


def get_sales_result_store() -> dict[str, Any] | None:
    return _sales_result.get()


def get_sales_extra() -> dict[str, Any]:
    return _sales_extra.get()


# ── Terminal tools ────────────────────────────────────────────────────────────

@tool
def write_price_strategy(
    title: str,
    content: str,
    target: str,
    current_price: str = "",
    benchmark: str = "",
    goal: str = "",
    sub_domain: str = "Pricing",
) -> str:
    """가격 전략(price_strategy) artifact를 저장한다.

    Args:
        title: 제목 (예: '아메리카노 가격 전략')
        content: 전략 본문 (마크다운)
        target: 대상 메뉴·상품
        current_price: 현재 가격 (선택)
        benchmark: 경쟁·시장 기준 (선택)
        goal: 목표 (선택)
        sub_domain: 서브허브 (기본 Pricing)
    """
    _sales_result.set({
        "action": "write_price_strategy",
        "title": title,
        "content": content,
        "target": target,
        "current_price": current_price,
        "benchmark": benchmark,
        "goal": goal,
        "sub_domain": sub_domain,
    })
    return "[가격 전략 저장 준비 완료]"


@tool
def write_customer_script(
    title: str,
    content: str,
    situation: str,
    tone: str = "",
    channel: str = "",
    sub_domain: str = "Customers",
) -> str:
    """고객 응대 스크립트(customer_script) artifact를 저장한다.

    Args:
        title: 제목 (예: '환불 요청 응대 스크립트')
        content: 스크립트 본문
        situation: 응대 상황 (예: '환불 요청', '컴플레인', '예약 변경')
        tone: 톤 (예: '친근', '전문적') (선택)
        channel: 채널 (예: '매장', '전화', '카톡') (선택)
        sub_domain: 서브허브 (기본 Customers)
    """
    _sales_result.set({
        "action": "write_customer_script",
        "title": title,
        "content": content,
        "situation": situation,
        "tone": tone,
        "channel": channel,
        "sub_domain": sub_domain,
    })
    return "[고객 응대 스크립트 저장 준비 완료]"


@tool
def write_customer_analysis(
    title: str,
    content: str,
    sub_domain: str = "Customers",
) -> str:
    """고객 분석(customer_analysis) artifact를 저장한다.

    Args:
        title: 제목 (예: '주요 고객 유형 분석')
        content: 분석 본문 (마크다운)
        sub_domain: 서브허브 (기본 Customers)
    """
    _sales_result.set({
        "action": "write_customer_analysis",
        "title": title,
        "content": content,
        "sub_domain": sub_domain,
    })
    return "[고객 분석 저장 준비 완료]"


@tool
def write_promotion(
    title: str,
    content: str,
    start_date: str,
    end_date: str,
    benefit: str,
    target: str = "",
    sub_domain: str = "Reports",
) -> str:
    """할인·프로모션(promotion) 기획서를 저장한다. D-리마인드 알림 자동 설정.

    Args:
        title: 프로모션명
        content: 기획서 본문
        start_date: 시작일 (YYYY-MM-DD)
        end_date: 종료일 (YYYY-MM-DD)
        benefit: 혜택 구조 (예: '10% 할인', '1+1 증정')
        target: 대상 고객·메뉴 (선택)
        sub_domain: 서브허브 (기본 Reports)
    """
    _sales_result.set({
        "action": "write_promotion",
        "title": title,
        "content": content,
        "start_date": start_date,
        "end_date": end_date,
        "benefit": benefit,
        "target": target,
        "sub_domain": sub_domain,
    })
    return "[프로모션 기획 저장 준비 완료]"


@tool
def write_checklist(
    title: str,
    content: str,
    topic: str,
    sub_domain: str = "Reports",
) -> str:
    """매출·운영 체크리스트(checklist) artifact를 저장한다.

    Args:
        title: 제목 (예: '월말 재고 점검 체크리스트')
        content: 체크리스트 본문 (마크다운 목록 권장)
        topic: 주제·목적
        sub_domain: 서브허브 (기본 Reports)
    """
    _sales_result.set({
        "action": "write_checklist",
        "title": title,
        "content": content,
        "topic": topic,
        "sub_domain": sub_domain,
    })
    return "[체크리스트 저장 준비 완료]"


@tool
def ask_user(question: str, choices: list[str] | None = None) -> str:
    """추가 정보가 필요할 때 사용자에게 질문한다.

    Args:
        question: 질문 내용
        choices: 선택지 목록 (선택)
    """
    _sales_result.set({
        "action": "ask_user",
        "question": question,
        "choices": choices or [],
    })
    return "[질문 준비 완료]"


SALES_TOOLS = [
    write_price_strategy,
    write_customer_script,
    write_customer_analysis,
    write_promotion,
    write_checklist,
    ask_user,
]

SALES_TERMINAL_TOOL_NAMES = {t.name for t in SALES_TOOLS}
