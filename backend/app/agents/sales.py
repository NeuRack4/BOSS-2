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

import os
try:
    from langsmith import traceable as _traceable
    if os.getenv("LANGSMITH_API_KEY"):
        os.environ.setdefault("LANGSMITH_TRACING", "true")
        os.environ.setdefault("LANGSMITH_PROJECT", os.getenv("LANGSMITH_PROJECT", "boss2-sales"))
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn):
            return fn
        return _decorator

from app.core.llm import chat_completion
from app.agents.orchestrator import (
    CLARIFY_RULE,
    ARTIFACT_RULE,
    NICKNAME_RULE,
    PROFILE_RULE,
)
from app.agents._feedback import feedback_context
from app.agents._suggest import suggest_today_for_domain
from app.agents._artifact import (
    save_artifact_from_reply,
    list_sub_hub_titles,
    today_context,
    pick_sub_hub_id,
    record_artifact_for_focus,
)
from app.agents._agent_context import inject_agent_context
from app.agents._sales_tools import (
    SALES_TOOLS,
    init_sales_result_store,
    get_sales_result_store,
    get_sales_extra,
    write_price_strategy as _tool_write_price_strategy,
    write_customer_script as _tool_write_customer_script,
    ask_user as _tool_ask_user,
)
from deepagents import create_deep_agent
from app.core.config import settings

log = logging.getLogger(__name__)

# ── 타입 정의 ────────────────────────────────────────────────────────────────

VALID_TYPES: tuple[str, ...] = (
    "revenue_entry",      # Revenue  — 매출 입력/기록
    "cost_report",        # Costs    — 비용/원가 기록
    "price_strategy",     # Pricing  — 가격 전략
    "menu_list",          # Pricing  — 메뉴 마스터 목록
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
    "menu_list":         "Pricing",
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
    + NICKNAME_RULE
    + PROFILE_RULE
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
@_traceable(name="sales.run_revenue_entry")
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
    log.info("[SALES] run_revenue_entry 진입 | account=%s", account_id)

    # pending_save(kind=revenue)가 있으면 SalesInputTable Save 버튼 경로 — 저장으로 위임
    from app.agents._sales_context import get_pending_save
    pending = get_pending_save() or {}
    if pending.get("kind") == "revenue" and pending.get("items"):
        log.info("[SALES] run_revenue_entry → pending_save 감지, run_save_revenue 위임")
        return await run_save_revenue(
            account_id=account_id,
            message=message,
            history=history,
            long_term_context=long_term_context,
            rag_context=rag_context,
        )

    text = (raw_text or "").strip() or message
    return await run(text, account_id, history, rag_context, long_term_context)


@_traceable(name="sales.run_sales_report")
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
    log.info("[SALES] run_sales_report 진입 (LangGraph) | account=%s period=%s",
             account_id, period)

    result: dict = {}
    try:
        from app.agents._sales._graph import build_sales_graph
        graph = build_sales_graph()
        final_state = await graph.ainvoke({
            "account_id":   account_id,
            "message":      message,
            "period":       period,
            "sales_data":   [],
            "cost_data":    [],
            "rag_context":  rag_context,
            "iteration":    0,
            "data_ok":      False,
            "final_result": {},
        })
        result = final_state["final_result"]
        log.info("[SALES] LangGraph 완료 | period=%s", period)
    except Exception as _graph_err:
        log.error("[SALES] LangGraph 실패 → 기존 방식으로 fallback: %s", _graph_err)
        from app.agents._sales._insights import generate_sales_insight
        result = await generate_sales_insight(account_id=account_id, period=period, target=target)

    title = f"{period} 매출 인사이트"
    artifact_block = (
        "\n\n[ARTIFACT]\n"
        f"type: sales_report\n"
        f"title: {title}\n"
        f"sub_domain: Reports\n"
        "[/ARTIFACT]"
    )

    # clean_content + [ARTIFACT] 블록으로 칸반 노드 저장 (run_menu_analysis 패턴 동일)
    artifact_id = await save_artifact_from_reply(
        account_id,
        "sales",
        result["clean_content"] + artifact_block,
        default_title=title,
        valid_types=VALID_TYPES,
    )

    # NodeDetailModal 시각화용 — metadata에 card_data 저장
    if artifact_id and result.get("card_data"):
        try:
            from app.core.supabase import get_supabase
            get_supabase().table("artifacts").update(
                {"metadata": {"sales_insight": result["card_data"]}}
            ).eq("id", artifact_id).execute()
        except Exception as e:
            log.warning("[SALES] sales_insight metadata patch failed: %s", e)

    # 채팅에는 시각화 마커 포함 반환
    return result["chat_text"]


@_traceable(name="sales.run_price_strategy", run_type="chain")
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
    log.info("[SALES] run_price_strategy 진입 | account=%s target=%s", account_id, target)
    system = _build_sales_agent_system(account_id, rag_context, long_term_context)
    lines = [f"[대상] {target}"]
    if current_price:
        lines.append(f"[현재 가격] {current_price}")
    if benchmark:
        lines.append(f"[경쟁/시장 기준] {benchmark}")
    if goal:
        lines.append(f"[목표] {goal}")
    info_str = "\n".join(lines)
    system += (
        "\n\n[가격 전략 작성 요청 — 정보 확정]\n"
        "아래 마크다운 구조로 전략 문서를 작성한 뒤 write_price_strategy를 호출하세요.\n"
        "## 현재 가격 분석\n## 시장 포지셔닝\n## 추천 가격대 및 근거\n## 실행 방안\n\n"
        + info_str
    )
    synthetic = (
        f"다음 정보로 가격 전략 문서를 마크다운 형식으로 작성하세요:\n{info_str}\n\n"
        "문서 구성:\n"
        "## 현재 가격 분석\n"
        "## 시장 포지셔닝\n"
        "## 추천 가격대 및 근거 (구체적 수치 포함)\n"
        "## 실행 방안 (즉시 적용 가능한 3가지)\n\n"
        "작성 후 write_price_strategy 도구로 저장하세요.\n"
        f"원본 요청: {message}"
    )
    title = f"{target} 가격 전략"
    await _run_sales_agent(
        account_id, synthetic, history, rag_context, long_term_context, system,
        tools=[_tool_write_price_strategy, _tool_ask_user],
        fallback_result_data={
            "action": "write_price_strategy",
            "title": title,
            "content": "",
            "target": target,
            "current_price": current_price or "",
            "benchmark": benchmark or "",
            "goal": goal or "",
            "sub_domain": "Pricing",
        },
    )
    return f"**{title}**을 Pricing에 저장했습니다. 칸반에서 상세 내용을 확인하세요."


@_traceable(name="sales.run_customer_script", run_type="chain")
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
    log.info("[SALES] run_customer_script 진입 | account=%s situation=%s", account_id, situation)
    system = _build_sales_agent_system(account_id, rag_context, long_term_context)
    lines = [f"[응대 상황] {situation}"]
    if tone:
        lines.append(f"[톤] {tone}")
    if channel:
        lines.append(f"[채널] {channel}")
    system += (
        "\n\n[고객 응대 스크립트 작성 요청 — 정보 확정]\n"
        "스크립트를 작성하고 write_customer_script를 호출하세요.\n"
        + "\n".join(lines)
    )
    synthetic = (
        "고객 응대 스크립트(customer_script)를 작성해주세요. write_customer_script로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_sales_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@_traceable(name="sales.run_promotion", run_type="chain")
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
    log.info("[SALES] run_promotion 진입 | account=%s title=%s", account_id, title)
    system = _build_sales_agent_system(account_id, rag_context, long_term_context)
    lines = [
        f"[프로모션명] {title}",
        f"[기간] {start_date} ~ {end_date}",
        f"[혜택] {benefit}",
    ]
    if target:
        lines.append(f"[대상] {target}")
    system += (
        "\n\n[프로모션 기획 요청 — 정보 확정]\n"
        f"기획서를 작성하고 write_promotion을 호출하세요 (start_date='{start_date}', end_date='{end_date}').\n"
        + "\n".join(lines)
    )
    synthetic = (
        f"'{title}' 할인·프로모션(promotion) 기획서를 작성해주세요. write_promotion으로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_sales_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@_traceable(name="sales.run_sales_checklist", run_type="chain")
async def run_sales_checklist(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    topic: str,
) -> str:
    log.info("[SALES] run_sales_checklist 진입 | account=%s topic=%s", account_id, topic)
    system = _build_sales_agent_system(account_id, rag_context, long_term_context)
    system += (
        "\n\n[체크리스트 작성 요청 — 정보 확정]\n"
        f"'{topic}' 주제로 체크리스트를 작성하고 write_checklist를 호출하세요."
    )
    synthetic = (
        f"'{topic}' 주제로 매출·운영 체크리스트(checklist)를 작성해주세요. write_checklist로 저장하세요.\n\n"
        f"원본 사용자 요청: {message}"
    )
    return await _run_sales_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@_traceable(name="sales.run_cost_entry")
async def run_cost_entry(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    raw_text: str | None = None,
) -> str:
    """비용 입력 의도 → vague_cost 로직 직접 실행 (GPT 우회)."""
    log.info("[SALES] run_cost_entry 진입 | account=%s", account_id)
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


@_traceable(name="sales.run_parse_receipt")
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
    log.info("[SALES] run_parse_receipt 진입 | account=%s", account_id)
    from app.agents._sales_context import get_pending_receipt
    from app.agents._sales._ocr_receipt_graph import run_receipt_ocr_graph
    from app.core.supabase import get_supabase as _get_sb_receipt

    pending = get_pending_receipt()
    if not pending or not pending.get("storage_path"):
        return "영수증 이미지가 아직 도착하지 않았어요. 다시 업로드해 주시겠어요?"

    _sb_r = _get_sb_receipt()
    _mime_r = pending.get("mime_type") or "image/jpeg"
    _bucket_r = pending.get("bucket") or "documents-uploads"
    _path_r = pending["storage_path"]
    try:
        _dl_r = _sb_r.storage.from_(_bucket_r).download(_path_r)
        _file_bytes_r = bytes(_dl_r) if isinstance(_dl_r, (bytes, bytearray)) else bytes(getattr(_dl_r, "data", b""))
    except Exception:
        return "영수증 이미지를 불러오지 못했어요. 다시 업로드해서 시도해주세요."
    parsed = await run_receipt_ocr_graph(_file_bytes_r, _mime_r)
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


@_traceable(name="sales.run_parse_csv")
async def run_parse_csv(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """업로드된 CSV/Excel 파일 → 매출 항목 파싱 → SalesInputTable 오픈 마커.

    pending_receipt 의 mime_type 또는 original_name 이 CSV/Excel 일 때 호출.
    """
    log.info("[SALES] run_parse_csv 진입 | account=%s", account_id)
    from app.agents._sales_context import get_pending_receipt
    from app.agents._sales._csv_parser import parse_sales_file

    pending = get_pending_receipt()
    if not pending or not pending.get("storage_path"):
        return "CSV/Excel 파일이 아직 도착하지 않았어요. 다시 업로드해 주시겠어요?"

    result = await parse_sales_file(
        storage_path=pending["storage_path"],
        bucket=pending.get("bucket") or "documents-uploads",
        mime_type=pending.get("mime_type") or "text/csv",
        original_name=pending.get("original_name") or "",
    )

    items = result.get("items") or []
    total_rows = result.get("total_rows", 0)

    if not items:
        return (
            f"파일에서 매출 항목을 찾지 못했어요. ({total_rows}행 확인)\n\n"
            "컬럼명이 '메뉴명', '수량', '단가', '금액' 형식인지 확인해 주세요."
        )

    today = date.today().isoformat()
    action_payload = {"date": today, "items": items}
    action = f"[ACTION:OPEN_SALES_TABLE:{json.dumps(action_payload, ensure_ascii=False)}]"

    date_note = "" if result.get("mapped_date") else "\n> 날짜 컬럼을 인식하지 못해 오늘 날짜로 일괄 처리했어요. 표에서 수정 가능해요."
    return (
        f"파일에서 **{len(items)}건** 을 인식했어요. 확인 후 저장하세요.{date_note}\n\n"
        f"{action}"
    )


@_traceable(name="sales.run_menu_analysis")
async def run_menu_analysis(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    period: str = "이번달",
    category: str | None = None,
    top_n: int = 10,
) -> str:
    """메뉴/상품별 매출 집계 + 수익성 순위 분석."""
    log.info("[SALES] run_menu_analysis 진입 | account=%s period=%s", account_id, period)
    from app.agents._sales._menu_analysis import analyze_menu, format_analysis_text

    result = await analyze_menu(
        account_id=account_id,
        period=period,
        category=category or None,
        top_n=top_n,
    )
    analysis_text = format_analysis_text(result)

    if result.get("items"):
        chart_json = json.dumps(result, ensure_ascii=False)
        chart_marker = f"\n\n[[MENU_CHART]]{chart_json}[[/MENU_CHART]]"
        artifact_block = (
            f"\n\n[ARTIFACT]\n"
            f"type: sales_report\n"
            f"title: {period} 메뉴별 수익성 분석\n"
            f"sub_domain: Pricing\n"
            f"[/ARTIFACT]"
        )
        # 저장용: 마커 없는 깨끗한 텍스트 (NodeDetailModal에서 마커가 노출되지 않도록)
        artifact_id = await save_artifact_from_reply(
            account_id,
            "sales",
            analysis_text + artifact_block,
            default_title="메뉴별 수익성 분석",
            valid_types=VALID_TYPES,
        )
        # NodeDetailModal 차트 렌더용 — metadata에 chart JSON 저장
        if artifact_id:
            try:
                from app.core.supabase import get_supabase
                get_supabase().table("artifacts").update(
                    {"metadata": {"menu_chart": result}}
                ).eq("id", artifact_id).execute()
            except Exception as e:
                log.warning("[SALES] menu_chart metadata patch failed: %s", e)
        # 반환용: 차트 마커 포함 (InlineChat에서 MenuAnalysisCard 렌더링)
        return analysis_text + chart_marker + artifact_block

    return analysis_text


@_traceable(name="sales.run_sync_pos")
async def run_sync_pos(
    *,
    account_id: str,
    message: str = "",
    history: list[dict] | None = None,
    long_term_context: str = "",
    rag_context: str = "",
    start_date: str = "",
    end_date: str = "",
) -> str:
    from datetime import date as _date
    from app.agents._sales._pos import get_locations, sync_pos_to_sales
    from app.core.config import settings

    if not settings.square_access_token:
        return (
            "Square POS 연동 설정이 필요해요.\n\n"
            "관리자에게 Square Access Token 설정을 요청해주세요."
        )

    # 위치 조회
    try:
        locations = await get_locations()
    except Exception as e:
        return f"Square 연결에 실패했어요: {e}"

    if not locations:
        return "Square에 등록된 매장 위치가 없어요. 콘솔에서 위치를 먼저 추가해주세요."

    location = locations[0]  # 첫 번째 위치 사용
    location_id = location.get("id", "")

    today      = _date.today()
    start      = _date.fromisoformat(start_date) if start_date else today
    end        = _date.fromisoformat(end_date)   if end_date   else today

    try:
        result = await sync_pos_to_sales(
            account_id=account_id,
            location_id=location_id,
            start_date=start,
            end_date=end,
        )
    except Exception as e:
        return f"동기화 중 오류가 발생했어요: {e}"

    saved  = result.get("saved", 0)
    orders = result.get("orders", 0)
    total  = result.get("total_amount", 0)

    if saved == 0:
        return (
            f"📡 Square POS 동기화 완료\n\n"
            f"- 기간: {start} ~ {end}\n"
            f"- 위치: {location.get('name', location_id)}\n"
            f"- 조회된 주문: {orders}건\n\n"
            "해당 기간에 기록된 주문이 없어요."
        )

    return (
        f"📡 **Square POS 동기화 완료**\n\n"
        f"- 기간: {start} ~ {end}\n"
        f"- 위치: {location.get('name', location_id)}\n"
        f"- 동기화된 주문: {orders}건\n"
        f"- 저장된 품목: {saved}개\n"
        f"- 총 매출: {total:,}원\n\n"
        "Sales 칸반 Revenue 컬럼에서 확인하실 수 있어요."
    )


@_traceable(name="sales.run_menu_upsert")
async def run_menu_upsert(
    *,
    account_id: str,
    name: str,
    category: str = "기타",
    price: int = 0,
    cost_price: int = 0,
    memo: str = "",
    message: str = "",
    history: list[dict] | None = None,
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    from app.agents._sales._menu_manager import upsert_menu
    result = await upsert_menu(
        account_id=account_id,
        name=name,
        category=category,
        price=price,
        cost_price=cost_price,
        memo=memo,
    )
    action    = result["action"]
    menu      = result["menu"]
    old_price = result.get("old_price")

    margin = ""
    if menu["price"] > 0 and menu["cost_price"] > 0:
        margin_pct = round((menu["price"] - menu["cost_price"]) / menu["price"] * 100, 1)
        margin = f"\n- 마진: {menu['price'] - menu['cost_price']:,}원 ({margin_pct}%)"

    if action == "updated":
        old_cost     = result.get("old_cost", 0)
        price_changed = old_price is not None and old_price != menu["price"]
        cost_changed  = old_cost != menu["cost_price"]
        anything_changed = price_changed or cost_changed

        changes = []
        if price_changed:
            changes.append(f"판매가 {old_price:,}원 → {menu['price']:,}원")
        if cost_changed:
            changes.append(f"원가 {old_cost:,}원 → {menu['cost_price']:,}원")

        if anything_changed:
            change_line = "변경사항: " + " / ".join(changes)
            return (
                f"✅ **{name}** 메뉴를 업데이트했어요.\n\n"
                f"{change_line}\n"
                f"- 카테고리: {menu['category']}\n"
                f"- 판매가: {menu['price']:,}원\n"
                f"- 원가: {menu['cost_price']:,}원"
                f"{margin}"
            )
        else:
            return (
                f"**{name}** 메뉴는 이미 동일한 정보로 등록되어 있어요.\n\n"
                f"- 판매가: {menu['price']:,}원\n"
                f"- 원가: {menu['cost_price']:,}원"
                f"{margin}"
            )

    no_cost_nudge = (
        f"\n\n💡 원가를 입력하면 마진율을 자동 계산해드려요.\n"
        f"→ **\"{menu['name']} 원가 [금액]원으로 수정해줘\"** 라고 말씀해보세요."
        if menu["cost_price"] == 0 else ""
    )

    return (
        f"✅ **{menu['name']}** 메뉴를 새로 등록했어요.\n\n"
        f"- 카테고리: {menu['category']}\n"
        f"- 판매가: {menu['price']:,}원\n"
        f"- 원가: {menu['cost_price']:,}원"
        f"{margin}"
        f"{no_cost_nudge}"
    )


@_traceable(name="sales.run_menu_ocr")
async def run_menu_ocr(
    *,
    account_id: str,
    message: str = "",
    history: list[dict] | None = None,
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    from app.agents._sales_context import get_pending_receipt
    from app.agents._upload_context import get_pending_upload
    from app.agents._sales._ocr_menu_graph import run_menu_ocr_graph
    from app.agents._sales._menu_manager import upsert_menu, upsert_menu_list_artifact, list_menus_with_profit
    from app.core.supabase import get_supabase

    # _sales_context(영수증 경로) 또는 _upload_context(문서 업로드 경로) 둘 다 확인
    pending = get_pending_receipt()
    upload  = get_pending_upload()

    source: dict | None = None
    if pending and "image" in (pending.get("mime_type") or ""):
        source = pending
    elif upload and "image" in (upload.get("mime_type") or ""):
        source = upload

    if not source:
        return (
            "메뉴판 이미지를 먼저 업로드해주세요.\n"
            "이미지를 올린 뒤 '메뉴 등록해줘'라고 말씀해보세요."
        )

    # storage에서 이미지 다운로드
    mime         = source.get("mime_type", "image/jpeg")
    storage_path = source.get("storage_path", "")
    bucket       = source.get("bucket", "documents-uploads")
    file_bytes: bytes | None = None

    if storage_path:
        sb = get_supabase()
        try:
            downloaded = sb.storage.from_(bucket).download(storage_path)
            if isinstance(downloaded, (bytes, bytearray)):
                file_bytes = bytes(downloaded)
            else:
                data = getattr(downloaded, "data", None)
                if isinstance(data, (bytes, bytearray)):
                    file_bytes = bytes(data)
        except Exception:
            pass

    if not file_bytes:
        return "이미지를 불러오지 못했어요. 다시 업로드해서 시도해주세요."

    # GPT-4o Vision으로 메뉴 추출
    menus = await run_menu_ocr_graph(file_bytes, mime_type=mime)
    if not menus:
        return (
            "메뉴판에서 메뉴를 인식하지 못했어요.\n"
            "- 이미지가 선명한지 확인해주세요\n"
            "- 메뉴판이 아닌 다른 이미지일 수 있어요"
        )

    # 일괄 등록
    created, updated, skipped = [], [], []
    for m in menus:
        name  = (m.get("name") or "").strip()
        if not name:
            continue
        price    = int(m.get("price") or 0)
        category = (m.get("category") or "기타").strip()
        try:
            result = await upsert_menu(
                account_id=account_id,
                name=name,
                category=category,
                price=price,
            )
            if result["action"] == "created":
                created.append(result["menu"])
            else:
                updated.append(result["menu"])
        except Exception:
            skipped.append(name)

    # menu_list artifact 갱신
    try:
        data = await list_menus_with_profit(account_id=account_id)
        await upsert_menu_list_artifact(account_id=account_id, menus=data["menus"])
    except Exception:
        pass

    # 응답 구성
    lines = [f"📋 메뉴판에서 **{len(menus)}개** 메뉴를 인식했어요.\n"]

    if created:
        lines.append(f"✅ 새로 등록 ({len(created)}개)")
        for m in created:
            price_str = f"{m['price']:,}원" if m['price'] > 0 else "가격 미확인"
            lines.append(f"  - {m['name']} ({m['category']}) {price_str}")

    if updated:
        lines.append(f"\n🔄 기존 메뉴 업데이트 ({len(updated)}개)")
        for m in updated:
            lines.append(f"  - {m['name']}")

    if skipped:
        lines.append(f"\n⚠️ 등록 실패 ({len(skipped)}개): {', '.join(skipped)}")

    if created or updated:
        lines.append("\n가격이 0원인 메뉴는 '메뉴이름 가격 수정해줘'로 업데이트할 수 있어요.")
        lines.append("'메뉴 목록 보여줘'로 전체 메뉴판을 확인해보세요.")

    return "\n".join(lines)


@_traceable(name="sales.run_menu_delete")
async def run_menu_delete(
    *,
    account_id: str,
    name: str,
    message: str = "",
    history: list[dict] | None = None,
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    from app.agents._sales._menu_manager import delete_menu
    result = await delete_menu(account_id=account_id, name=name)

    if result["action"] == "not_found":
        return (
            f"❌ **{name}** 메뉴를 찾을 수 없어요.\n"
            "'메뉴 목록 보여줘'로 등록된 메뉴를 확인해보세요."
        )

    menu = result["menu"]
    return (
        f"🗑️ **{name}** 메뉴를 삭제했어요.\n\n"
        f"- 카테고리: {menu['category']}\n"
        f"- 판매가: {menu['price']:,}원"
    )


@_traceable(name="sales.run_menu_list")
async def run_menu_list(
    *,
    account_id: str,
    message: str = "",
    history: list[dict] | None = None,
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    from app.agents._sales._menu_manager import list_menus_with_profit, upsert_menu_list_artifact
    data = await list_menus_with_profit(account_id=account_id)

    if not data["menus"]:
        return (
            "등록된 메뉴가 없어요.\n\n"
            "채팅에서 이렇게 입력해보세요:\n"
            "- '아메리카노 4500원 등록해줘'\n"
            "- '라떼 5000원, 원가 800원으로 추가해줘'"
        )

    # Pricing 서브허브에 menu_list artifact upsert (_revenue.py 패턴)
    await upsert_menu_list_artifact(account_id=account_id, menus=data["menus"])

    lines = [f"📋 **메뉴판** (총 {data['total']}개)\n"]
    for cat, items in data["by_category"].items():
        lines.append(f"\n**{cat}**")
        for m in items:
            margin = (
                f" — 마진 {m['margin_rate']}%" if m["margin_rate"] is not None else ""
            )
            lines.append(f"- {m['name']}: {m['price']:,}원{margin}")
    lines.append("\nSales 칸반 Pricing 컬럼에서 '메뉴판' 카드를 클릭하면 상세 확인할 수 있어요.")
    return "\n".join(lines)


@_traceable(name="sales.run_save_revenue")
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
    log.info("[SALES] run_save_revenue 진입 | account=%s", account_id)
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


@_traceable(name="sales.run_save_costs")
async def run_save_costs(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """CostInputTable 의 Save 버튼 경로. pending_save.kind == 'cost'."""
    log.info("[SALES] run_save_costs 진입 | account=%s", account_id)
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
            "name": "sales_sync_pos",
            "description": (
                "[카테고리: Revenue] Square POS 포스기 매출 동기화. "
                "'오늘 포스 매출 불러와', '포스기 연동해줘', '포스 데이터 가져와' 등 POS 동기화 요청 시 호출. "
                "Square POS API로 주문 데이터를 조회해 sales_records에 자동 저장."
            ),
            "handler": run_sync_pos,
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "시작일 YYYY-MM-DD (기본 오늘)"},
                    "end_date":   {"type": "string", "description": "종료일 YYYY-MM-DD (기본 오늘)"},
                },
            },
        },
        {
            "name": "sales_checklist",
            "description": "매출·비용·재료비 절감·원가 관리·재고·발주·마감 등 영업 운영 전반에 관한 체크리스트. 소상공인 가게 운영에 필요한 실천 목록 작성.",
            "handler": run_sales_checklist,
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "예: '월말 재고 점검', '주간 발주'"},
                },
                "required": ["topic"],
            },
        },
        {
            "name": "sales_menu_upsert",
            "description": (
                "[카테고리: Pricing] 메뉴 등록 또는 수정. "
                "'아메리카노 4500원 등록해줘', '라떼 가격 5000원으로 수정', "
                "'메뉴 추가해줘', '메뉴 가격 바꿔줘' 등 메뉴 관리 요청 시 호출."
            ),
            "handler": run_menu_upsert,
            "parameters": {
                "type": "object",
                "properties": {
                    "name":       {"type": "string", "description": "메뉴 이름"},
                    "category":   {"type": "string", "description": "음료|디저트|음식|기타"},
                    "price":      {"type": "integer", "description": "판매가 (원)"},
                    "cost_price": {"type": "integer", "description": "원가 (원, 선택)"},
                    "memo":       {"type": "string", "description": "메모 (선택)"},
                },
                "required": ["name", "price"],
            },
        },
        {
            "name": "sales_menu_list",
            "description": (
                "[카테고리: Pricing] 등록된 메뉴 목록 조회 + 마진율 확인. "
                "'메뉴판 보여줘', '메뉴 목록', '어떤 메뉴 있어', '마진율 확인해줘' 등 호출."
            ),
            "handler": run_menu_list,
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "sales_menu_delete",
            "description": (
                "[카테고리: Pricing] 메뉴 삭제. "
                "'초코라떼 삭제해줘', '아메리카노 메뉴 지워줘', '메뉴 없애줘' 등 삭제 요청 시 호출. "
                "절대 sales_menu_upsert와 혼동하지 말 것."
            ),
            "handler": run_menu_delete,
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "삭제할 메뉴 이름"},
                },
                "required": ["name"],
            },
        },
        {
            "name": "sales_menu_analysis",
            "description": (
                "메뉴/상품별 매출 집계 및 수익성 순위 분석. "
                "'어떤 메뉴가 제일 잘 팔려?', '이번달 베스트 메뉴', '수익성 분석해줘', "
                "'상품별 매출 순위' 등 메뉴·상품 단위 분석 요청 시 호출."
            ),
            "handler": run_menu_analysis,
            "parameters": {
                "type": "object",
                "properties": {
                    "period":   {"type": "string", "description": "예: '이번달', '이번주', '3개월', '전체'"},
                    "category": {"type": "string", "description": "특정 카테고리만 필터 (예: '음료', '디저트')"},
                    "top_n":    {"type": "integer", "description": "상위 N개 (기본 10)"},
                },
            },
        },
    ]

    # 조건부 capability — 요청 범위 contextvar 에 따라 advertise.

    # 메뉴판 이미지 OCR — _sales_context 또는 _upload_context 에 이미지가 있을 때
    from app.agents._upload_context import get_pending_upload
    _pending_upload = get_pending_upload()
    _image_source: dict | None = None

    _r = get_pending_receipt()
    if _r and "image" in (_r.get("mime_type") or ""):
        _image_source = _r
    elif _pending_upload and "image" in (_pending_upload.get("mime_type") or ""):
        _image_source = _pending_upload

    if _image_source:
        _img_fname = _image_source.get("original_name") or "이미지"
        caps.append({
            "name": "sales_menu_ocr",
            "description": (
                f"[즉시 호출 가능] 방금 업로드된 '{_img_fname}' 메뉴판 이미지를 OCR해서 "
                "메뉴명·가격을 자동 추출하고 메뉴를 일괄 등록. "
                "'메뉴 등록해줘', '메뉴판 읽어줘', '사진으로 추가해줘' 요청 시 즉시 호출. "
                "영수증과 구분: 이 capability는 메뉴판 이미지 전용."
            ),
            "handler": run_menu_ocr,
            "parameters": {"type": "object", "properties": {}},
        })

    # CSV/Excel 파싱 또는 영수증 OCR (업로드된 파일이 이번 턴에 있을 때만)
    pending_receipt = get_pending_receipt()
    if pending_receipt:
        fname = pending_receipt.get("original_name") or ""
        mime = pending_receipt.get("mime_type") or ""
        is_csv_excel = (
            "csv" in mime
            or "excel" in mime
            or "spreadsheet" in mime
            or fname.lower().endswith((".csv", ".xlsx", ".xls"))
        )
        if is_csv_excel:
            caps.append({
                "name": "sales_parse_csv",
                "description": (
                    f"[즉시 호출 가능] 방금 업로드된 CSV/Excel 파일 '{fname}' 에서 매출 항목을 "
                    "파싱해 SalesInputTable 을 여는 ACTION 마커를 응답에 담는다. "
                    "사용자가 '파싱해줘', '불러와줘', '매출로 등록' 등을 요청하면 즉시 호출."
                ),
                "handler": run_parse_csv,
                "parameters": {"type": "object", "properties": {}},
            })
        else:
            # 파일명에 "menu"/"메뉴" 포함 시 메뉴판 이미지로 판단 → 영수증 capability 제외
            _is_menu_image = any(
                kw in fname.lower() for kw in ("menu", "메뉴", "menuboard", "menu_board")
            )
            if not _is_menu_image:
                caps.append({
                    "name": "sales_parse_receipt",
                    "description": (
                        f"[즉시 호출 가능] 방금 업로드된 영수증 '{fname}' 를 OCR 해서 매출/비용 항목을 "
                        "추출하고 SalesInputTable(또는 CostInputTable) 을 여는 ACTION 마커를 응답에 담는다. "
                        "사용자가 '저장해줘', '기록해줘', '매출로 처리' 등을 요청하면 즉시 호출. "
                        "영수증 업로드 안 됐다고 답하지 말 것 — 이미 서버가 스토리지에 파일을 보관 중. "
                        "⚠️ 이 capability 단독으로만 dispatch 할 것 — sales_revenue_entry·sales_cost_entry 등 "
                        "다른 capability 와 함께 dispatch 하지 말 것. 사용자가 테이블에서 확인 후 저장해야 하므로 "
                        "이 단계에서 저장까지 진행하면 안 된다."
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


# ── DeepAgent 시스템 프롬프트 ────────────────────────────────────────────────

AGENT_SYSTEM_PROMPT = (
    """당신은 소상공인 매출 관리 전문 AI 에이전트입니다.
카페, 음식점, 책방, 의류점, 뷰티샵, 편의점 등 모든 업종의 매출·비용·가격·고객을 담당합니다.
사용자 프로필(업종·상호·위치·목표)을 최대한 활용해 맞춤형 분석과 전략을 제공합니다.

[핵심 원칙]
1. 자료 작성 요청 시 write_* 도구를 호출해 결과물을 저장하세요.
2. 타입별 필수 필드가 모두 확정되면 **즉시** 완성된 결과물을 write_* 도구로 저장하세요.
3. 공통 필드(업종·목표·타겟)는 프로필에 있으면 자동 사용, 합리적으로 추정해서 작성.
4. 필수 정보가 부족하면 ask_user 도구로 하나씩 되물으세요.
5. 한 턴에 하나의 terminal tool만 호출하세요.
6. placeholder([가게명], [가격] 등) 절대 금지 — 모르면 ask_user로 먼저 물어보세요.
7. 결과물이 완성됐으면 write_* 도구를 즉시 호출하세요. 추가 질문 금지.

[도구 선택 가이드]
- 가격 전략·할인 정책 → write_price_strategy
- 고객 응대 스크립트(문의·컴플레인·업셀) → write_customer_script
- 고객 유형·패턴 분석 → write_customer_analysis
- 할인·프로모션 기획서 → write_promotion
- 매출·운영 체크리스트 → write_checklist
- 정보 부족 시 질문 → ask_user

[sub_domain 매핑 가이드]
- price_strategy, menu_list → Pricing
- customer_script, customer_analysis → Customers
- promotion, sales_report, checklist → Reports
- cost_report → Costs
- revenue_entry → Revenue
시스템 컨텍스트의 "이 계정의 sales 서브허브" 목록에 위 이름이 있으면 반드시 해당 이름으로 sub_domain을 채운다.

"""
    + _PRICE_STRATEGY_FORMAT
    + _CUSTOMER_FORMAT
    + _REQUIRED_FIELDS
    + CLARIFY_RULE
    + """
작성 원칙:
- 프로필에 업종·가게명·위치 정보가 있으면 반드시 반영해 맞춤형으로 작성
- 없는 수치(매출·방문자 수 등)는 절대 추측하지 않음
- 실용적이고 바로 사용 가능한 한국어로 작성
"""
    + NICKNAME_RULE
    + PROFILE_RULE
)

_SALES_TERMINAL_REMINDER = """
[경고] terminal tool을 호출하지 않았습니다.
반드시 다음 중 하나를 즉시 호출하세요:
- write_price_strategy(...) — 가격 전략 저장
- write_customer_script(...) — 고객 응대 스크립트 저장
- write_customer_analysis(...) — 고객 분석 저장
- write_promotion(...) — 프로모션 기획서 저장
- write_checklist(...) — 체크리스트 저장
- ask_user(...) — 사용자에게 추가 정보 요청

자료 작성 요청에서 terminal tool 미호출은 오류입니다.
"""


def _make_sales_model():
    """Sales DeepAgent용 LLM 모델 생성."""
    if settings.planner_provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=settings.planner_claude_model,
            temperature=0.3,
            api_key=settings.anthropic_api_key,
        )
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.3,
        api_key=settings.openai_api_key,
    )


@_traceable(name="sales._run_sales_agent", run_type="chain")
async def _run_sales_agent(
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    system_prompt: str,
    tools: list | None = None,
    fallback_result_data: dict | None = None,
) -> str:
    """Sales DeepAgent를 실행하고 결과를 반환합니다."""
    inject_agent_context(account_id, message, history, rag_context, long_term_context)
    init_sales_result_store()

    model = _make_sales_model()
    active_tools = tools if tools is not None else SALES_TOOLS
    messages_in = [*history[-6:], {"role": "user", "content": message}]

    async def _invoke(sys: str) -> list:
        agent = create_deep_agent(model=model, tools=active_tools, system_prompt=sys)
        result = await agent.ainvoke({"messages": messages_in})
        return result.get("messages", [])

    try:
        out_messages = await _invoke(system_prompt)
    except Exception as exc:
        log.exception("[sales] deepagent invoke failed")
        return f"매출 처리 중 오류가 발생했습니다: {exc}"

    result_data = get_sales_result_store()

    if not result_data:
        log.info("[sales] account=%s no terminal tool — retry", account_id)
        try:
            init_sales_result_store()
            out_messages = await _invoke(system_prompt + "\n\n" + _SALES_TERMINAL_REMINDER)
        except Exception as exc:
            log.exception("[sales] retry invoke failed")
            return f"매출 처리 중 오류가 발생했습니다: {exc}"
        result_data = get_sales_result_store()

    if not result_data:
        from langchain_core.messages import AIMessage
        ai_text = ""
        for msg in reversed(out_messages):
            if isinstance(msg, AIMessage) and msg.content:
                content = msg.content
                if isinstance(content, list):
                    texts = [b["text"] for b in content if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()]
                    if texts:
                        ai_text = " ".join(texts).strip()
                        break
                elif isinstance(content, str) and content.strip():
                    ai_text = content.strip()
                    break

        # fallback_result_data가 있으면 artifact 강제 저장
        if fallback_result_data is not None:
            # ai_text 품질 부족 시 tool 지시문 제거 후 직접 재생성
            if len(ai_text) < 200:
                log.info("[sales] account=%s ai_text 품질 부족(%d자) — chat_completion 재생성", account_id, len(ai_text))
                # synthetic message에서 tool 지시문 제거한 순수 작성 요청
                clean_prompt = message.split("write_price_strategy")[0].split("작성 후")[0].strip()
                try:
                    regen = await chat_completion(
                        messages=[
                            {
                                "role": "system",
                                "content": (
                                    "소상공인 전문 컨설턴트. 마크다운 형식으로 상세하고 구체적인 문서를 작성하세요. "
                                    "도구 호출 지시문이나 '저장하세요' 같은 문구는 절대 포함하지 마세요."
                                ),
                            },
                            {"role": "user", "content": clean_prompt},
                        ],
                        temperature=0.4,
                        max_tokens=1000,
                    )
                    ai_text = (regen.choices[0].message.content or "").strip() or ai_text
                except Exception:
                    log.exception("[sales] fallback content regen failed account=%s", account_id)

            # 응답에 남은 tool 지시문 제거
            import re as _re
            ai_text = _re.sub(
                r"\n*위 문서를.*?저장하세요\.?\s*$",
                "",
                ai_text,
                flags=_re.DOTALL | _re.IGNORECASE,
            ).strip()

            log.info("[sales] account=%s fallback_result_data 사용 — artifact 강제 저장", account_id)
            fallback_result_data = {**fallback_result_data, "content": ai_text}
            result_data = fallback_result_data
        else:
            return ai_text or "처리 결과를 반환하지 못했습니다."

    action = result_data.get("action")
    if action == "write_price_strategy":
        return await _execute_write_price_strategy(account_id, result_data)
    if action == "write_customer_script":
        return await _execute_write_customer_script(account_id, result_data)
    if action == "write_customer_analysis":
        return await _execute_write_customer_analysis(account_id, result_data)
    if action == "write_promotion":
        return await _execute_write_promotion(account_id, result_data)
    if action == "write_checklist":
        return await _execute_write_checklist(account_id, result_data)
    if action == "ask_user":
        q = result_data.get("question", "무엇을 도와드릴까요?")
        choices = result_data.get("choices", [])
        if choices:
            choices_str = "\n".join(f"- {c}" for c in choices)
            return f"{q}\n\n[CHOICES]\n{choices_str}"
        return q
    return "알 수 없는 action입니다."


# ── Execute functions (terminal tool 결과 처리 + artifact 저장) ───────────────

async def _execute_write_price_strategy(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "가격 전략"
    content = result_data.get("content") or ""
    sub_domain = result_data.get("sub_domain") or "Pricing"

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["sales"],
            "kind": "artifact",
            "type": "price_strategy",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "sales", prefer_keywords=(sub_domain, "Pricing"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                sb.table("activity_logs").insert({
                    "account_id": account_id, "type": "artifact_created",
                    "domain": "sales", "title": title,
                    "description": "가격 전략 생성",
                    "metadata": {"artifact_id": artifact_id},
                }).execute()
            except Exception:
                pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "sales", "price_strategy", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[sales] write_price_strategy artifact insert failed")

    return content


async def _execute_write_customer_script(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "고객 응대 스크립트"
    content = result_data.get("content") or ""
    sub_domain = result_data.get("sub_domain") or "Customers"

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["sales"],
            "kind": "artifact",
            "type": "customer_script",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "sales", prefer_keywords=(sub_domain, "Customers"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                sb.table("activity_logs").insert({
                    "account_id": account_id, "type": "artifact_created",
                    "domain": "sales", "title": title,
                    "description": "고객 응대 스크립트 생성",
                    "metadata": {"artifact_id": artifact_id},
                }).execute()
            except Exception:
                pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "sales", "customer_script", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[sales] write_customer_script artifact insert failed")

    return content


async def _execute_write_customer_analysis(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "고객 분석"
    content = result_data.get("content") or ""
    sub_domain = result_data.get("sub_domain") or "Customers"

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["sales"],
            "kind": "artifact",
            "type": "customer_analysis",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "sales", prefer_keywords=(sub_domain, "Customers"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                sb.table("activity_logs").insert({
                    "account_id": account_id, "type": "artifact_created",
                    "domain": "sales", "title": title,
                    "description": "고객 분석 생성",
                    "metadata": {"artifact_id": artifact_id},
                }).execute()
            except Exception:
                pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "sales", "customer_analysis", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[sales] write_customer_analysis artifact insert failed")

    return content


async def _execute_write_promotion(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "프로모션"
    content = result_data.get("content") or ""
    start_date = result_data.get("start_date") or ""
    end_date = result_data.get("end_date") or ""
    sub_domain = result_data.get("sub_domain") or "Reports"

    meta: dict = {}
    if start_date:
        meta["start_date"] = start_date
    if end_date:
        meta["end_date"] = end_date
        meta["due_label"] = "프로모션 종료"

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["sales"],
            "kind": "artifact",
            "type": "promotion",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": meta,
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "sales", prefer_keywords=(sub_domain, "Reports"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                sb.table("activity_logs").insert({
                    "account_id": account_id, "type": "artifact_created",
                    "domain": "sales", "title": title,
                    "description": f"프로모션 기획 생성 ({start_date} ~ {end_date})" if start_date else "프로모션 기획 생성",
                    "metadata": {"artifact_id": artifact_id},
                }).execute()
            except Exception:
                pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "sales", "promotion", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[sales] write_promotion artifact insert failed")

    return content


async def _execute_write_checklist(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "체크리스트"
    content = result_data.get("content") or ""
    sub_domain = result_data.get("sub_domain") or "Reports"

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["sales"],
            "kind": "artifact",
            "type": "checklist",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "sales", prefer_keywords=(sub_domain, "Reports"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                sb.table("activity_logs").insert({
                    "account_id": account_id, "type": "artifact_created",
                    "domain": "sales", "title": title,
                    "description": "체크리스트 생성",
                    "metadata": {"artifact_id": artifact_id},
                }).execute()
            except Exception:
                pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "sales", "checklist", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[sales] write_checklist artifact insert failed")

    return content


def _build_sales_agent_system(
    account_id: str,
    rag_context: str,
    long_term_context: str,
) -> str:
    """공통 Sales DeepAgent 시스템 프롬프트 조립."""
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
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
    return system


# ── 메인 run ─────────────────────────────────────────────────────────────────

@_traceable(name="sales.run", run_type="chain")
async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    # RAG: 오케스트레이터가 컨텍스트를 넘기지 않은 경우 자동 검색
    if not rag_context:
        try:
            from app.agents._sales._retriever import retrieve_sales_context
            rag_context = await retrieve_sales_context(account_id, message)
        except Exception as _e:
            log.warning("[SALES] RAG 검색 실패 (무시하고 계속): %s", _e)

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
