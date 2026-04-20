"""매출 도메인 에이전트

서브허브별 지원 타입:
  Revenue   — revenue_entry   (매출 입력/기록)
  Costs     — cost_report     (비용/원가 기록)
  Pricing   — price_strategy  (가격 전략)
  Customers — customer_script, customer_analysis
  Reports   — sales_report    (분석 리포트)
  공용      — promotion, checklist
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date

from app.core.llm import chat_completion
from app.agents.orchestrator import (
    CLARIFY_RULE,
    NICKNAME_RULE,
    PROFILE_RULE,
    ARTIFACT_RULE,
)
from app.agents._feedback import feedback_context
from app.agents._suggest import suggest_today_for_domain
from app.agents._artifact import (
    save_artifact_from_reply,
    list_sub_hub_titles,
    today_context,
)

log = logging.getLogger(__name__)

# ── 타입 정의 ────────────────────────────────────────────────────────────────

VALID_TYPES: tuple[str, ...] = (
    "revenue_entry",      # Revenue  — 매출 입력/기록
    "cost_report",        # Costs    — 비용/원가 기록
    "price_strategy",     # Pricing  — 가격 전략
    "customer_script",    # Customers — 고객 응대 스크립트
    "customer_analysis",  # Customers — 고객 분석
    "sales_report",       # Reports  — 매출 분석 리포트
    "promotion",          # Revenue/Pricing — 할인·프로모션
    "checklist",          # 공용 — 체크리스트
)

# 타입 → 서브허브 매핑 (sub_domain 필드에 자동 주입)
_TYPE_TO_SUBHUB: dict[str, str] = {
    "revenue_entry":     "Revenue",
    "cost_report":       "Costs",
    "price_strategy":    "Pricing",
    "customer_script":   "Customers",
    "customer_analysis": "Customers",
    "sales_report":      "Reports",
    "promotion":         "Revenue",
    "checklist":         "Reports",
}

# 매출 입력 의도 감지 정규식 (숫자 + 단위 패턴)
_REVENUE_INPUT_RE = re.compile(
    r"(\d[\d,]*)\s*(잔|개|판|건|명|그릇|장|병|세트|인분|컵|팩|박스|원|만원)",
    re.IGNORECASE,
)

# [ACTION] 마커 파싱
_ACTION_RE = re.compile(r"\[ACTION:OPEN_SALES_TABLE:(.*?)\]", re.DOTALL)

# 표 직접 입력 의도 감지 (숫자 없이 표/직접 입력 요청)
_TABLE_INPUT_RE = re.compile(
    r"(표로|직접\s*입력|직접\s*작성|다른\s*방법|표\s*입력|입력\s*표|직접\s*넣)",
    re.IGNORECASE,
)

# 막연한 매출 입력 의도 감지 ("매출 입력하고 싶어", "기록할래" 등 — 수량 없음)
_VAGUE_ENTRY_RE = re.compile(
    r"(매출|판매|팔았|영업).{0,20}(입력|기록|넣|저장|하고\s*싶|할래|어떻게|방법|시작)",
    re.IGNORECASE,
)

# "글로 입력하기" 클릭 감지 — vague_entry 제외 대상 (ACTION 마커 재삽입 방지)
_EXPLICIT_TEXT_RE = re.compile(r"글로\s*(입력|작성|쓸|쓰)", re.IGNORECASE)

# 저장 의도 감지 — history에서 마지막 ACTION 마커를 재삽입
_SAVE_INTENT_RE = re.compile(
    r"(저장|기록해|넣어줘|기록해줘|확인|맞아|응|ㅇㅇ|그래|ok)",
    re.IGNORECASE,
)


def _find_last_action_marker(history: list[dict]) -> str | None:
    """history에서 가장 최근 items가 있는 [ACTION:OPEN_SALES_TABLE:...] 마커를 반환."""
    PREFIX = "[ACTION:OPEN_SALES_TABLE:"
    for msg in reversed(history):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", "")
        start = content.find(PREFIX)
        if start == -1:
            continue
        json_start = start + len(PREFIX)
        depth = 0
        json_end = -1
        for i in range(json_start, len(content)):
            if content[i] == "{":
                depth += 1
            elif content[i] == "}":
                depth -= 1
                if depth == 0:
                    json_end = i
                    break
        if json_end == -1:
            continue
        marker_end = json_end + 1
        while marker_end < len(content) and content[marker_end] != "]":
            marker_end += 1
        marker_end += 1
        try:
            data = json.loads(content[json_start:json_end + 1])
            if not data.get("items"):  # 빈 items 마커는 건너뜀
                continue
        except Exception:
            continue
        return content[start:marker_end]
    return None


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "sales")


def _strip_action_marker(text: str) -> str:
    """[ACTION:OPEN_SALES_TABLE:{...}] 마커를 중괄호 깊이 기반으로 제거."""
    prefix = "[ACTION:OPEN_SALES_TABLE:"
    start = text.find(prefix)
    if start == -1:
        return text
    json_start = start + len(prefix)
    depth = 0
    json_end = -1
    for i in range(json_start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                json_end = i
                break
    if json_end == -1:
        return text
    marker_end = json_end + 1
    while marker_end < len(text) and text[marker_end] != "]":
        marker_end += 1
    marker_end += 1
    return (text[:start] + text[marker_end:]).strip()


# ── 형식 가이드 ──────────────────────────────────────────────────────────────

_REVENUE_ENTRY_FORMAT = """
[revenue_entry 출력 형식 — 매출 입력 확인]
1. 간단한 확인 멘트 1줄 (닉네임 있으면 호칭 사용)
2. 마크다운 표:
   | 메뉴/상품 | 수량 | 단가 | 금액 |
   |-----------|------|------|------|
   | ...       | ...  | ...  | ...  |
   | **합계**  |      |      | **N원** |
3. 빈 줄
4. "저장할까요? 수정이 필요하면 말씀해 주세요."
5. [ACTION:OPEN_SALES_TABLE:{JSON}] 마커 (표 뒤에 반드시 삽입)

JSON 형식:
{"date":"YYYY-MM-DD","items":[{"item_name":"...","category":"...","quantity":N,"unit_price":N}]}

규칙:
- 단가를 모르면 0으로 두고 "단가를 알려주시면 금액을 계산해 드릴게요" 멘트 추가
- 날짜 언급 없으면 오늘 날짜 사용
- 카테고리: 업종에 맞게 자유 분류 (음료/디저트/도서/의류 등)
"""

_COST_REPORT_FORMAT = """
[cost_report 출력 형식 — 비용 기록]
1. 비용 항목 마크다운 표:
   | 항목 | 금액 | 분류 | 메모 |
   |------|------|------|------|
2. 총 비용 합계
3. 전월 대비 코멘트 (데이터 있을 때만)
"""

_SALES_REPORT_FORMAT = """
[sales_report 출력 형식 — 매출 분석]
1. 핵심 요약 (3줄 이내)
2. 기간별/항목별 분석
3. 인사이트 및 개선 포인트 (2~3개)
4. 다음 액션 추천 1개
수치는 컨텍스트에 제공된 실데이터만 사용. 추측 금지.
"""

_PRICE_STRATEGY_FORMAT = """
[price_strategy 출력 형식 — 가격 전략]
1. 현재 가격 분석 (제공된 경우)
2. 경쟁/시장 기준 포지셔닝
3. 추천 가격대 및 근거
4. 구체적 실행 방안 (2~3개)
"""

_CUSTOMER_FORMAT = """
[customer_script 출력 형식 — 고객 응대]
상황: {응대 상황}
---
[인사] ...
[상황 파악] ...
[해결/안내] ...
[마무리] ...
---
톤: 친근하고 전문적으로. 감정적 대응 금지.

[customer_analysis 출력 형식 — 고객 분석]
1. 고객 유형 분류
2. 주요 패턴 및 특징
3. 개선/대응 전략
"""

_REQUIRED_FIELDS = """
[필수 필드 매트릭스 — 모두 확정되기 전엔 [ARTIFACT] 출력 금지]

공통: 업종/가게 정보 (프로필에 있으면 자동 사용)

revenue_entry:  날짜, 항목명, 수량 (단가는 선택)
cost_report:    날짜, 비용 항목, 금액
price_strategy: 현재 가격, 경쟁/시장 기준
customer_script: 응대 상황 (문의/컴플레인/업셀), 톤
customer_analysis: 분석 기간 또는 고객 유형
sales_report:   분석 기간, 핵심 KPI
promotion:      시작일(start_date), 종료일(end_date), 혜택 구조
checklist:      체크리스트 목적/상황
"""

# ── 시스템 프롬프트 ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    """당신은 소상공인 매출 관리 전문 AI 에이전트입니다.
카페, 음식점, 책방, 의류점, 뷰티샵, 편의점 등 모든 업종의 매출·비용·가격·고객을 담당합니다.
사용자 프로필(업종·상호·위치·목표)을 최대한 활용해 맞춤형 분석과 전략을 제공합니다.

가능한 작업:
- revenue_entry:     오늘/기간 매출 입력 및 기록 (텍스트 → 표 변환 + 저장)
- cost_report:       재료비·운영비·인건비 등 비용 기록
- price_strategy:    메뉴/상품 가격 전략 및 할인 정책
- customer_script:   고객 응대 스크립트 (문의/컴플레인/업셀)
- customer_analysis: 고객 유형·패턴 분석
- sales_report:      기간별 매출 분석 리포트 및 인사이트
- promotion:         기간성 할인·프로모션 기획
- checklist:         매출/운영 관련 체크리스트

허용 type: revenue_entry | cost_report | price_strategy | customer_script | customer_analysis | sales_report | promotion | checklist

[매출 입력 감지 규칙]
사용자 메시지에 "N잔", "N개", "N원", "N판" 등 수량+단위 패턴이 있으면
→ revenue_entry 의도로 판단
→ 파싱 후 마크다운 표(방식 B) + [ACTION:OPEN_SALES_TABLE] 마커 출력

[표 직접 입력 제안 규칙]
사용자가 아래 중 하나라도 해당하면 표 입력 옵션을 먼저 제안하라:
- 매출 입력 방법을 묻는 경우 ("어떻게 입력해", "다른 방법 없어" 등)
- "표로 입력", "직접 입력", "직접 작성" 언급
- 매출을 기록하고 싶지만 구체적인 수량이 없는 경우

제안 방식:
1. "표로 직접 작성하실 수 있어요! 아래 버튼을 눌러 열어보세요." 멘트
2. 반드시 [ACTION:OPEN_SALES_TABLE:{"date":"오늘날짜","items":[]}] 마커 출력
   (items가 비어있어도 마커 출력 — 빈 표가 열려 사용자가 직접 채울 수 있음)

[서브허브 매핑 규칙]
artifact 저장 시 sub_domain 필드를 반드시 포함:
- revenue_entry, promotion → sub_domain: Revenue
- cost_report             → sub_domain: Costs
- price_strategy          → sub_domain: Pricing
- customer_script, customer_analysis → sub_domain: Customers
- sales_report, checklist → sub_domain: Reports
"""
    + _REQUIRED_FIELDS
    + _REVENUE_ENTRY_FORMAT
    + _COST_REPORT_FORMAT
    + _SALES_REPORT_FORMAT
    + _PRICE_STRATEGY_FORMAT
    + _CUSTOMER_FORMAT
    + ARTIFACT_RULE
    + CLARIFY_RULE
    + NICKNAME_RULE
    + PROFILE_RULE
    + """
작성 원칙:
- 프로필에 업종·가게명·위치 정보가 있으면 반드시 반영해 맞춤형으로 작성
- 없는 수치(매출·방문자 수 등)는 절대 추측하지 않음
- 실용적이고 바로 사용 가능한 한국어로 작성

예시 (정보 부족 시):
"매출 관련해서 무엇을 도와드릴까요?
[CHOICES]
매출 분석 리포트 보기
가격 전략 수립
고객 응대 스크립트
비용 기록하기
[/CHOICES]"
"""
)


# ── 매출 텍스트 파싱 ─────────────────────────────────────────────────────────

def _is_revenue_input(message: str) -> bool:
    """메시지가 매출 입력 의도인지 빠르게 판별."""
    return bool(_REVENUE_INPUT_RE.search(message))


async def _parse_sales_from_message(message: str) -> dict | None:
    """GPT-4o structured output으로 매출 데이터 추출.

    반환: {"date": "YYYY-MM-DD", "items": [...], "is_revenue_input": bool}
    실패 시 None.
    """
    today = date.today().isoformat()
    try:
        resp = await chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"오늘 날짜: {today}\n"
                        "사용자 메시지에서 매출 데이터를 추출해서 아래 JSON 형식으로만 반환해. "
                        "다른 텍스트 절대 포함하지 마.\n"
                        '{"date":"YYYY-MM-DD","items":['
                        '{"item_name":"메뉴명","category":"카테고리","quantity":수량,"unit_price":단가}],'
                        '"is_revenue_input":true/false}\n'
                        "- 날짜 언급 없으면 오늘 날짜\n"
                        "- 단가 모르면 0\n"
                        "- 카테고리: 음료/디저트/도서/의류 등 업종에 맞게\n"
                        "- 매출 입력 의도가 아니면 is_revenue_input=false, items=[]"
                    ),
                },
                {"role": "user", "content": message},
            ],
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        return json.loads(raw)
    except Exception as e:
        log.warning("sales parse error: %s", e)
        return None


def _build_markdown_table(parsed: dict) -> str:
    """파싱 결과를 마크다운 표(방식 B)로 포맷."""
    items = parsed.get("items", [])
    if not items:
        return ""

    lines = [
        "| 메뉴/상품 | 수량 | 단가 | 금액 |",
        "|-----------|-----:|-----:|-----:|",
    ]
    total = 0
    for it in items:
        qty = it.get("quantity", 1)
        price = it.get("unit_price", 0)
        amount = qty * price
        total += amount
        price_str = f"{price:,}원" if price else "-"
        amount_str = f"{amount:,}원" if price else "-"
        lines.append(f"| {it.get('item_name','')} | {qty} | {price_str} | {amount_str} |")

    lines.append(f"| **합계** | | | **{total:,}원** |")
    return "\n".join(lines)


def _build_action_marker(parsed: dict) -> str:
    """[ACTION:OPEN_SALES_TABLE:{...}] 마커 생성."""
    payload = {
        "date": parsed.get("date", date.today().isoformat()),
        "items": parsed.get("items", []),
    }
    return f"[ACTION:OPEN_SALES_TABLE:{json.dumps(payload, ensure_ascii=False)}]"


def strip_action_marker(text: str) -> tuple[str, dict | None]:
    """응답에서 ACTION 마커를 제거하고 (clean_text, action_data) 반환."""
    m = _ACTION_RE.search(text)
    if not m:
        return text, None
    try:
        data = json.loads(m.group(1))
    except Exception:
        data = None
    clean = _ACTION_RE.sub("", text).strip()
    return clean, data


# ── 메인 run ─────────────────────────────────────────────────────────────────

async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    # 매출 입력 의도 빠른 감지 → 파싱 선행
    parsed_sales: dict | None = None
    wants_table_input = bool(_TABLE_INPUT_RE.search(message))
    save_intent = (
        bool(_SAVE_INTENT_RE.search(message))
        and not _is_revenue_input(message)
        and not wants_table_input
    )
    vague_entry = (
        not _is_revenue_input(message)
        and not wants_table_input
        and not save_intent
        and not bool(_EXPLICIT_TEXT_RE.search(message))
        and bool(_VAGUE_ENTRY_RE.search(message))
    )
    if _is_revenue_input(message):
        parsed_sales = await _parse_sales_from_message(message)
        if parsed_sales and not parsed_sales.get("is_revenue_input"):
            parsed_sales = None

    # 저장 의도 + history에 ACTION 마커 있으면 GPT 없이 바로 반환 (GPT가 "저장됐습니다" 오답 방지)
    if save_intent:
        last_marker = _find_last_action_marker(history)
        if last_marker:
            return (
                "입력하신 매출 내역을 아래 표에서 확인 후 **저장** 버튼을 눌러주세요.\n\n"
                + last_marker
            )

    system = SYSTEM_PROMPT + "\n\n" + today_context()

    hubs = list_sub_hub_titles(account_id, "sales")
    if hubs:
        system += "\n\n[이 계정의 sales 서브허브]\n- " + "\n- ".join(hubs)

    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"

    if rag_context:
        system += f"\n\n{rag_context}"

    fb = feedback_context(account_id, "sales")
    if fb:
        system += f"\n\n{fb}"

    # 파싱 성공 시 — 파싱 결과를 시스템 컨텍스트에 주입해 GPT가 표를 정확히 생성하게
    if parsed_sales and parsed_sales.get("items"):
        system += (
            f"\n\n[파싱된 매출 데이터 — 이 데이터로 revenue_entry 표를 작성하세요]\n"
            f"{json.dumps(parsed_sales, ensure_ascii=False)}\n"
            "응답 마지막에 반드시 [ACTION:OPEN_SALES_TABLE:...] 마커를 삽입하세요."
        )

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content or ""

    # 파싱은 됐는데 GPT가 마커를 빠뜨린 경우 — 직접 삽입
    if parsed_sales and parsed_sales.get("items") and "[ACTION:OPEN_SALES_TABLE:" not in reply:
        table = _build_markdown_table(parsed_sales)
        marker = _build_action_marker(parsed_sales)
        reply = (
            f"{reply}\n\n{table}\n\n"
            "저장할까요? 수정이 필요하면 말씀해 주세요.\n\n"
            f"[매출 입력 표로 직접 수정하기]\n{marker}"
        )

    # 표 직접 입력 요청 또는 막연한 매출 입력 의도 → 빈 표 마커 주입
    if (wants_table_input or vague_entry) and "[ACTION:OPEN_SALES_TABLE:" not in reply:
        reply = _strip_action_marker(reply)
        empty_marker = _build_action_marker({"date": date.today().isoformat(), "items": []})
        reply = f"{reply}\n\n{empty_marker}"


    await save_artifact_from_reply(
        account_id,
        "sales",
        reply,
        default_title="매출 자료",
        valid_types=VALID_TYPES,
    )
    return reply
