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
    "revenue_entry":     "Reports",
    "cost_report":       "Costs",
    "price_strategy":    "Pricing",
    "customer_script":   "Customers",
    "customer_analysis": "Customers",
    "sales_report":      "Reports",
    "promotion":         "Reports",
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

# 비용 입력 의도 감지
_VAGUE_COST_RE = re.compile(
    r"(비용|지출|원가|경비|지출비|출금|나간\s*돈|쓴\s*돈).{0,20}(입력|기록|넣|저장|할래|하고\s*싶|어떻게|방법|시작)"
    r"|비용\s*(입력|기록|넣|저장)",
    re.IGNORECASE,
)

# 비용 저장 의도 (history의 마지막 COST 마커 재삽입용)
_COST_ACTION_RE = re.compile(r"\[ACTION:OPEN_COST_TABLE:(.*?)\]", re.DOTALL)

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
- revenue_entry, promotion, sales_report, checklist → sub_domain: Reports
- cost_report             → sub_domain: Costs
- price_strategy          → sub_domain: Pricing
- customer_script, customer_analysis → sub_domain: Customers
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
- 과거 컨텍스트(RAG)에 이전 매출 데이터가 있더라도 현재 메시지에 명시된 수량/금액만 파싱할 것 — 이전 데이터를 새 입력으로 재파싱 금지

[중요] "매출 입력해줘", "기록할게", "오늘 매출 입력" 등 수량 없이 입력 의도만 있는 경우:
→ [CHOICES] 버튼 출력 금지
→ 반드시 [ACTION:OPEN_SALES_TABLE:{"date":"오늘날짜","items":[]}] 마커만 출력
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


async def _parse_cost_from_message(message: str) -> list[dict] | None:
    """자연어 비용 텍스트에서 항목/금액 파싱 (GPT-4o-mini)."""
    today = date.today().isoformat()
    prompt = (
        f"오늘 날짜: {today}\n"
        "아래 텍스트에서 비용 항목을 파싱해 반드시 다음 JSON 형식으로만 반환해. 다른 텍스트 절대 금지.\n"
        '{"items":[{"item_name":"항목명","category":"분류","amount":금액정수}]}\n'
        "- category 허용값: 재료비|인건비|임대료|공과금|마케팅|기타\n"
        "- amount = 수량×단가 계산 후 정수. 단가만 있으면 그게 amount\n"
        "- 파싱 불가 시 {\"items\":[]}"
    )
    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": message},
            ],
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        obj = json.loads(raw)
        items = obj.get("items", [])
        return items if items else None
    except Exception as e:
        log.warning("cost parse error: %s", e)
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


# ──────────────────────────────────────────────────────────────────────────
# Capability 인터페이스 (function-calling 라우팅용, v0.9.1~)
# ──────────────────────────────────────────────────────────────────────────
async def run_revenue_entry(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    raw_text: str | None = None,
) -> str:
    """자연어 매출 입력 → 파싱 → SalesInputTable 오픈 마커.

    raw_text 가 주어지면 그걸 기준으로, 아니면 사용자 메시지를 그대로 legacy run() 에 넘김
    (기존 `_parse_sales_from_message` + `[ACTION:OPEN_SALES_TABLE]` 파이프라인 재사용).
    """
    text = (raw_text or "").strip() or message
    return await run(text, account_id, history, rag_context, long_term_context)


async def run_sales_report(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    period: str,
    target: str | None = None,
    kpi: list[str] | None = None,
) -> str:
    lines = [f"[분석 기간] {period}"]
    if target:
        lines.append(f"[대상] {target}")
    if kpi:
        lines.append(f"[핵심 KPI] {', '.join(kpi)}")
    synthetic = (
        "매출 분석 리포트(sales_report) 를 작성해주세요. [ARTIFACT] 블록(type=sales_report) 으로 저장.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_price_strategy(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    target: str,
    current_price: str | None = None,
    benchmark: str | None = None,
    goal: str | None = None,
) -> str:
    lines = [f"[대상] {target}"]
    if current_price:
        lines.append(f"[현재 가격] {current_price}")
    if benchmark:
        lines.append(f"[경쟁/시장 기준] {benchmark}")
    if goal:
        lines.append(f"[목표] {goal}")
    synthetic = (
        "가격 전략(price_strategy) 을 작성해주세요. [ARTIFACT] 블록(type=price_strategy) 으로 저장.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_customer_script(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    situation: str,
    tone: str | None = None,
    channel: str | None = None,
) -> str:
    lines = [f"[응대 상황] {situation}"]
    if tone:
        lines.append(f"[톤] {tone}")
    if channel:
        lines.append(f"[채널] {channel}")
    synthetic = (
        "고객 응대 스크립트(customer_script) 를 작성해주세요. [ARTIFACT] 블록(type=customer_script) 으로 저장.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_promotion(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    title: str,
    start_date: str,
    end_date: str,
    benefit: str,
    target: str | None = None,
) -> str:
    lines = [
        f"[프로모션명] {title}",
        f"[기간] {start_date} ~ {end_date}",
        f"[혜택] {benefit}",
    ]
    if target:
        lines.append(f"[대상] {target}")
    synthetic = (
        f"'{title}' 할인/프로모션(promotion) 기획서를 작성해주세요. "
        "[ARTIFACT] 블록(type=promotion, start_date, end_date, due_label='프로모션 종료') 으로 저장.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_sales_checklist(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    topic: str,
) -> str:
    synthetic = (
        f"'{topic}' 주제로 매출/운영 체크리스트(checklist) 를 작성해주세요. [ARTIFACT] 블록(type=checklist) 으로 저장.\n\n"
        f"원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_cost_entry(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """비용 입력 의도 → vague_cost 로직 직접 실행 (GPT 우회)."""
    if re.search(r"글로\s*(입력|쓸|작성)", message):
        return "비용 내역을 알려주세요! 예: '식재료비 50,000원, 포장재 12,000원'"

    from datetime import date as _date
    from app.core.supabase import get_supabase
    today = _date.today().isoformat()

    # 실제 비용 데이터가 포함된 메시지면 파싱 후 표+저장버튼 반환
    if not _VAGUE_COST_RE.search(message):
        parsed_items = await _parse_cost_from_message(message)
        if parsed_items:
            rows = ["| 항목 | 분류 | 금액 |", "|------|------|-----:|"]
            total = 0
            for it in parsed_items:
                rows.append(f"| {it['item_name']} | {it.get('category','기타')} | {it['amount']:,} |")
                total += it["amount"]
            rows.append(f"| **합계** | | **{total:,}원** |")
            table_md = "\n".join(rows)
            action = json.dumps({"date": today, "items": parsed_items}, ensure_ascii=False)
            return (
                f"아래 내용으로 비용을 기록할까요?\n\n"
                f"{table_md}\n\n"
                f"[ACTION:OPEN_COST_TABLE:{action}]"
            )
    try:
        sb = get_supabase()
        recent = (
            sb.table("cost_records")
            .select("item_name,category,amount,recorded_date")
            .eq("account_id", account_id)
            .order("recorded_date", desc=True)
            .limit(30)
            .execute()
            .data
        ) or []
    except Exception:
        recent = []

    if recent:
        last_date = recent[0]["recorded_date"]
        same_day = [r for r in recent if r["recorded_date"] == last_date]
        rows = ["| 항목 | 분류 | 금액 |", "|------|------|------|"]
        total = 0
        items_json = []
        for r in same_day:
            rows.append(f"| {r['item_name']} | {r.get('category','기타')} | {r['amount']:,} |")
            total += r["amount"]
            items_json.append({
                "item_name": r["item_name"],
                "category": r.get("category", "기타"),
                "amount": r["amount"],
                "memo": "",
            })
        rows.append(f"| **합계** | | **{total:,}원** |")
        table_md = "\n".join(rows)
        action = json.dumps({"date": today, "items": items_json}, ensure_ascii=False)
        return (
            f"최근 비용 기록({last_date})이에요. 오늘도 동일하게 저장하시겠어요?\n\n"
            f"{table_md}\n\n"
            f"[ACTION:OPEN_COST_TABLE:{action}]"
        )
    else:
        return (
            "비용을 기록할게요! 항목명·분류·금액을 알려주시거나, 표로 직접 작성하실 수 있어요.\n\n"
            f'[ACTION:OPEN_COST_TABLE:{{"date":"{today}","items":[]}}]'
        )


async def run_parse_receipt(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """pending_receipt (업로드된 영수증) → OCR → SalesInputTable / CostInputTable 오픈 마커.

    contextvar `pending_receipt` 가 있을 때만 호출됨 (`describe` 가 advertise 함).
    OCR 결과의 type 이 'cost' 면 CostInputTable, 아니면 SalesInputTable 을 연다.
    """
    from app.agents._sales_context import get_pending_receipt
    from app.agents._sales._ocr import parse_receipt_from_storage

    pending = get_pending_receipt()
    if not pending or not pending.get("storage_path"):
        return "영수증 이미지가 아직 도착하지 않았어요. 다시 업로드해 주시겠어요?"

    parsed = await parse_receipt_from_storage(
        storage_path=pending["storage_path"],
        bucket=pending.get("bucket") or "documents-uploads",
        mime_type=pending.get("mime_type") or "image/jpeg",
    )
    items = parsed.get("items") or []
    kind = parsed.get("type") or "sales"
    today = date.today().isoformat()

    if not items:
        return "영수증에서 항목을 인식하지 못했어요. 더 선명한 사진으로 다시 올려주시겠어요?"

    summary_lines = [f"영수증에서 **{len(items)}건** 을 인식했어요. 확인 후 저장하세요.\n"]
    if kind == "cost":
        action_payload = {"date": today, "items": items}
        action = f"[ACTION:OPEN_COST_TABLE:{json.dumps(action_payload, ensure_ascii=False)}]"
    else:
        action_payload = {"date": today, "items": items}
        action = f"[ACTION:OPEN_SALES_TABLE:{json.dumps(action_payload, ensure_ascii=False)}]"
    summary_lines.append(action)
    return "\n".join(summary_lines)


async def run_save_revenue(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """SalesInputTable 의 Save 버튼이 chat 으로 보낸 `pending_save` 를 실제 저장.

    contextvar `pending_save.kind == 'revenue'` 일 때 describe() 가 노출.
    """
    from app.agents._sales_context import get_pending_save
    from app.agents._sales._revenue import dispatch_save_revenue

    pending = get_pending_save() or {}
    items = pending.get("items") or []
    recorded_date = pending.get("recorded_date") or date.today().isoformat()
    source = pending.get("source") or "chat"

    if not items:
        return "저장할 항목이 없어요."

    try:
        result = await dispatch_save_revenue(
            account_id=account_id,
            items=items,
            recorded_date=recorded_date,
            source=source,
        )
    except Exception as e:
        log.exception("run_save_revenue failed")
        return f"저장 중 오류가 발생했어요: {str(e)[:160]}"

    if result.get("duplicate"):
        return "방금 같은 내용이 이미 저장돼 있어서 중복은 건너뛰었어요."
    saved = result.get("saved", 0)
    total = result.get("total_amount", 0)
    return f"매출 **{saved}건** 저장됐어요. 총 **{total:,}원**."


async def run_save_costs(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """CostInputTable 의 Save 버튼 경로. pending_save.kind == 'cost'."""
    from app.agents._sales_context import get_pending_save
    from app.agents._sales._costs import dispatch_save_costs

    pending = get_pending_save() or {}
    items = pending.get("items") or []
    recorded_date = pending.get("recorded_date") or date.today().isoformat()
    source = pending.get("source") or "chat"

    if not items:
        return "저장할 항목이 없어요."

    try:
        result = await dispatch_save_costs(
            account_id=account_id,
            items=items,
            recorded_date=recorded_date,
            source=source,
        )
    except Exception as e:
        log.exception("run_save_costs failed")
        return f"저장 중 오류가 발생했어요: {str(e)[:160]}"

    if result.get("duplicate"):
        return "방금 같은 내용이 이미 저장돼 있어서 중복은 건너뛰었어요."
    saved = result.get("saved", 0)
    total = result.get("total_amount", 0)
    return f"비용 **{saved}건** 저장됐어요. 총 **{total:,}원**."


def describe(account_id: str) -> list[dict]:
    """Sales 도메인 capability 매니페스트."""
    from app.agents._sales_context import get_pending_receipt, get_pending_save

    caps: list[dict] = [
        {
            "name": "sales_cost_entry",
            "description": (
                "비용·지출·경비를 기록하고 싶을 때 호출. "
                "'비용 입력할래', '오늘 재료비 기록', '지출 넣어줘' 등 비용 기록 의도. "
                "매출 입력과 구분: 이 capability는 지출/비용 전용."
            ),
            "handler": run_cost_entry,
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "sales_revenue_entry",
            "description": (
                "자연어 매출 텍스트(예: '오늘 아메리카노 15잔 10000원, 라떼 8잔 12000원') 를 파싱해 "
                "SalesInputTable 을 여는 ACTION 마커와 함께 저장 흐름으로 진입. "
                "사용자가 매출을 '기록하고 싶다/입력하고 싶다' 의도일 때 호출."
            ),
            "handler": run_revenue_entry,
            "parameters": {
                "type": "object",
                "properties": {
                    "raw_text": {
                        "type": "string",
                        "description": "매출 원시 문장(없으면 사용자 메시지 그대로 사용).",
                    },
                },
            },
        },
        {
            "name": "sales_report",
            "description": "매출 데이터 분석 리포트 (기간·대상·KPI 기반).",
            "handler": run_sales_report,
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {"type": "string", "description": "예: '2026-03', '최근 30일', '1분기'"},
                    "target": {"type": "string", "description": "메뉴·상품·서비스군"},
                    "kpi":    {"type": "array", "items": {"type": "string"}, "description": "예: ['객단가', '재방문율']"},
                },
                "required": ["period"],
            },
        },
        {
            "name": "sales_price_strategy",
            "description": "가격 전략·할인 정책 초안.",
            "handler": run_price_strategy,
            "parameters": {
                "type": "object",
                "properties": {
                    "target":        {"type": "string"},
                    "current_price": {"type": "string"},
                    "benchmark":     {"type": "string", "description": "경쟁사·시장 가격 기준"},
                    "goal":          {"type": "string"},
                },
                "required": ["target"],
            },
        },
        {
            "name": "sales_customer_script",
            "description": "고객 응대 스크립트(문의·컴플레인·업셀 등).",
            "handler": run_customer_script,
            "parameters": {
                "type": "object",
                "properties": {
                    "situation": {"type": "string", "description": "예: '환불 요청', '예약 변경', '가격 문의'"},
                    "tone":      {"type": "string"},
                    "channel":   {"type": "string", "description": "매장/전화/카톡/리뷰 등"},
                },
                "required": ["situation"],
            },
        },
        {
            "name": "sales_promotion",
            "description": (
                "할인·프로모션 기획을 artifact 로 등록 (start/end_date → 스케쥴러 D-리마인드 자동)."
            ),
            "handler": run_promotion,
            "parameters": {
                "type": "object",
                "properties": {
                    "title":      {"type": "string"},
                    "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "end_date":   {"type": "string", "description": "YYYY-MM-DD"},
                    "benefit":    {"type": "string", "description": "할인율·증정·쿠폰 등"},
                    "target":     {"type": "string"},
                },
                "required": ["title", "start_date", "end_date", "benefit"],
            },
        },
        {
            "name": "sales_checklist",
            "description": "재고/발주/마감 등 매출 관련 체크리스트.",
            "handler": run_sales_checklist,
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "예: '월말 재고 점검', '주간 발주'"},
                },
                "required": ["topic"],
            },
        },
    ]

    # 조건부 capability — 요청 범위 contextvar 에 따라 advertise.

    # 영수증 파싱 (업로드된 이미지가 이번 턴에 있을 때만)
    pending_receipt = get_pending_receipt()
    if pending_receipt:
        fname = pending_receipt.get("original_name") or "업로드 영수증"
        caps.append({
            "name": "sales_parse_receipt",
            "description": (
                f"[즉시 호출 가능] 방금 업로드된 영수증 '{fname}' 를 OCR 해서 매출/비용 항목을 "
                "추출하고 SalesInputTable(또는 CostInputTable) 을 여는 ACTION 마커를 응답에 담는다. "
                "사용자가 '저장해줘', '기록해줘', '매출로 처리' 등을 요청하면 즉시 호출. "
                "영수증 업로드 안 됐다고 답하지 말 것 — 이미 서버가 스토리지에 파일을 보관 중."
            ),
            "handler": run_parse_receipt,
            "parameters": {"type": "object", "properties": {}},
        })

    # 사용자 확정 항목 저장 (SalesInputTable/CostInputTable Save 버튼)
    pending_save = get_pending_save() or {}
    save_kind = pending_save.get("kind")
    if save_kind == "revenue" and pending_save.get("items"):
        caps.append({
            "name": "sales_save_revenue",
            "description": (
                "[즉시 호출 가능] 사용자가 SalesInputTable 에서 확정한 매출 항목을 "
                "sales_records + revenue_entry artifact 로 저장한다. 추가 질문 없이 즉시 호출."
            ),
            "handler": run_save_revenue,
            "parameters": {"type": "object", "properties": {}},
        })
    if save_kind == "cost" and pending_save.get("items"):
        caps.append({
            "name": "sales_save_costs",
            "description": (
                "[즉시 호출 가능] 사용자가 CostInputTable 에서 확정한 비용 항목을 "
                "cost_records + cost_report artifact 로 저장한다. 추가 질문 없이 즉시 호출."
            ),
            "handler": run_save_costs,
            "parameters": {"type": "object", "properties": {}},
        })

    return caps


def _last_message_was_cost_prompt(history: list[dict]) -> bool:
    """직전 assistant 메시지가 비용 입력 안내였는지 확인."""
    for msg in reversed(history):
        if msg.get("role") == "assistant":
            content = msg.get("content", "")
            return (
                "비용 내역을 알려주세요" in content
                or "항목명·분류·금액을 알려주시거나" in content
                or "OPEN_COST_TABLE" in content
            )
    return False


# ── 메인 run ─────────────────────────────────────────────────────────────────

async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    # 비용 입력 모드: 직전 안내 후 사용자가 실제 데이터를 보낸 경우
    if _last_message_was_cost_prompt(history) and not _VAGUE_COST_RE.search(message):
        parsed_items = await _parse_cost_from_message(message)
        if parsed_items:
            from datetime import date as _date
            today = _date.today().isoformat()
            rows = ["| 항목 | 분류 | 금액 |", "|------|------|-----:|"]
            total = 0
            for it in parsed_items:
                rows.append(f"| {it['item_name']} | {it.get('category','기타')} | {it['amount']:,} |")
                total += it["amount"]
            rows.append(f"| **합계** | | **{total:,}원** |")
            action = json.dumps({"date": today, "items": parsed_items}, ensure_ascii=False)
            return (
                f"아래 내용으로 비용을 기록할까요?\n\n"
                + "\n".join(rows)
                + f"\n\n[ACTION:OPEN_COST_TABLE:{action}]"
            )

    # 매출 입력 의도 빠른 감지 → 파싱 선행
    parsed_sales: dict | None = None
    wants_table_input = bool(_TABLE_INPUT_RE.search(message))
    save_intent = (
        bool(_SAVE_INTENT_RE.search(message))
        and not _is_revenue_input(message)
        and not wants_table_input
    )
    vague_cost = bool(_VAGUE_COST_RE.search(message))
    vague_entry = (
        not _is_revenue_input(message)
        and not wants_table_input
        and not save_intent
        and not vague_cost
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

    # 막연한 매출 입력 의도 — GPT 호출 없이 처리
    if vague_entry:
        from datetime import date
        from app.core.supabase import get_supabase
        today = date.today().isoformat()
        try:
            sb = get_supabase()
            recent = (
                sb.table("sales_records")
                .select("item_name,category,quantity,unit_price,recorded_date")
                .eq("account_id", account_id)
                .order("recorded_date", desc=True)
                .limit(30)
                .execute()
                .data
            ) or []
        except Exception:
            recent = []

        if recent:
            last_date = recent[0]["recorded_date"]
            same_day = [r for r in recent if r["recorded_date"] == last_date]
            rows = ["| 메뉴/상품 | 수량 | 단가 | 금액 |", "|-----------|------|------|------|"]
            total = 0
            items_json = []
            for r in same_day:
                amount = r["quantity"] * r["unit_price"]
                total += amount
                rows.append(f"| {r['item_name']} | {r['quantity']} | {r['unit_price']:,} | {amount:,} |")
                items_json.append({
                    "item_name": r["item_name"],
                    "category": r.get("category", "기타"),
                    "quantity": r["quantity"],
                    "unit_price": r["unit_price"],
                })
            rows.append(f"| **합계** | | | **{total:,}원** |")
            table_md = "\n".join(rows)
            action = json.dumps({"date": today, "items": items_json}, ensure_ascii=False)
            return (
                f"최근 매출 기록({last_date})이에요. 오늘도 동일하게 저장하시겠어요?\n\n"
                f"{table_md}\n\n"
                f"[ACTION:OPEN_SALES_TABLE:{action}]"
            )
        else:
            return (
                "첫 매출 기록이에요! 품목·수량·금액을 알려주시거나, 표로 직접 작성하실 수 있어요.\n\n"
                f'[ACTION:OPEN_SALES_TABLE:{{"date":"{today}","items":[]}}]'
            )

    # 막연한 비용 입력 의도 — GPT 호출 없이 처리
    if vague_cost:
        from datetime import date as _date
        from app.core.supabase import get_supabase
        today = _date.today().isoformat()
        try:
            sb = get_supabase()
            recent = (
                sb.table("cost_records")
                .select("item_name,category,amount,recorded_date")
                .eq("account_id", account_id)
                .order("recorded_date", desc=True)
                .limit(30)
                .execute()
                .data
            ) or []
        except Exception:
            recent = []

        if recent:
            last_date = recent[0]["recorded_date"]
            same_day = [r for r in recent if r["recorded_date"] == last_date]
            rows = ["| 항목 | 분류 | 금액 |", "|------|------|------|"]
            total = 0
            items_json = []
            for r in same_day:
                rows.append(f"| {r['item_name']} | {r.get('category','기타')} | {r['amount']:,} |")
                total += r["amount"]
                items_json.append({
                    "item_name": r["item_name"],
                    "category": r.get("category", "기타"),
                    "amount": r["amount"],
                    "memo": "",
                })
            rows.append(f"| **합계** | | **{total:,}원** |")
            table_md = "\n".join(rows)
            action = json.dumps({"date": today, "items": items_json}, ensure_ascii=False)
            return (
                f"최근 비용 기록({last_date})이에요. 오늘도 동일하게 저장하시겠어요?\n\n"
                f"{table_md}\n\n"
                f"[ACTION:OPEN_COST_TABLE:{action}]"
            )
        else:
            return (
                "비용을 기록할게요! 항목명·분류·금액을 알려주시거나, 표로 직접 작성하실 수 있어요.\n\n"
                f'[ACTION:OPEN_COST_TABLE:{{"date":"{today}","items":[]}}]'
            )

    system = SYSTEM_PROMPT + "\n\n" + today_context()

    hubs = list_sub_hub_titles(account_id, "sales")
    if hubs:
        system += "\n\n[이 계정의 sales 서브허브]\n- " + "\n- ".join(hubs)

    # 새 매출 입력 의도(수량 미포함)일 때는 이전 데이터 컨텍스트 주입 금지
    # — 이전 revenue_entry 데이터를 현재 입력으로 재파싱하는 오동작 방지
    if not vague_entry:
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
