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
    "contract",
    "estimate",
    "notice",
    "checklist",
    "guide",
)


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "documents")


SYSTEM_PROMPT = """당신은 서류 관리 전문 AI 에이전트입니다.
소상공인의 각종 서류 작성, 계약서, 공문서, 행정 서류를 담당합니다.

가능한 작업:
- 근로계약서 초안 작성
- 거래처 계약서 / 견적서 / 발주서 작성
- 사업자 관련 행정 서류 안내
- 공지문 / 안내문 / 사내 규정 문서 작성
- 서류 체크리스트 작성

[필수 필드 매트릭스 — 모두 확정되기 전엔 [ARTIFACT] 출력 금지]
- 공통: 문서 종류, 당사자(또는 대상자)
- contract: + 계약 시작일(start_date), 종료일(end_date), 주요 조건·금액
- estimate: + 품목·수량·단가, 유효기간(due_date)
- notice: + 게시 대상, 공지 일자(due_date)
- checklist / guide: + 적용 상황, 핵심 항목 리스트

허용 type: contract | estimate | notice | checklist | guide
응답은 실용적이고 바로 사용 가능한 한국어로 작성하세요.
""" + ARTIFACT_RULE + CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE + """

예시 (정보 부족 시):
"서류를 작성해드릴게요. 어떤 서류가 필요하신가요?
[CHOICES]
근로계약서
거래 견적서
휴무 공지문
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
    hubs = list_sub_hub_titles(account_id, "documents")
    if hubs:
        system += "\n\n[이 계정의 documents 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "documents")
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
        "documents",
        reply,
        default_title="서류",
        valid_types=VALID_TYPES,
    )
    return reply
