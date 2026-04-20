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


VALID_TYPES: tuple[str, ...] = (
    "sales_report",
    "price_strategy",
    "customer_script",
    "checklist",
    "promotion",
)


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "sales")


SYSTEM_PROMPT = """당신은 매출 관리 전문 AI 에이전트입니다.
소상공인의 매출 분석, 가격 전략, 고객 응대를 담당합니다.

가능한 작업:
- 매출 데이터 분석 및 인사이트 도출
- 가격 전략 및 할인 정책 수립
- 고객 응대 스크립트 작성
- 재고/발주 관리 체크리스트
- 월별 매출 목표 설정
- 기간성 할인/프로모션(promotion) 기획

[필수 필드 매트릭스 — 모두 확정되기 전엔 [ARTIFACT] 출력 금지]
- 공통: 대상(메뉴·상품·서비스군), 분석/전략 목적
- sales_report: + 분석 기간, 핵심 KPI
- price_strategy: + 현재 가격, 경쟁/시장 기준
- customer_script: + 응대 상황(문의/컴플레인/업셀), 톤
- promotion: + 시작일(start_date), 종료일(end_date), 혜택 구조

허용 type: sales_report | price_strategy | customer_script | checklist | promotion
응답은 실용적이고 바로 사용 가능한 한국어로 작성하세요.
""" + ARTIFACT_RULE + CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE + """

예시 (정보 부족 시):
"매출 개선을 도와드릴게요. 지금 가장 고민되는 부분은 무엇인가요?
[CHOICES]
매출 데이터 분석
가격/할인 전략
고객 응대 스크립트
기타 (직접 입력)
[/CHOICES]"
"""


async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
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

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content
    await save_artifact_from_reply(
        account_id,
        "sales",
        reply,
        default_title="매출 자료",
        valid_types=VALID_TYPES,
    )
    return reply
