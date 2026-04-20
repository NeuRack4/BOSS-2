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
    "job_posting",
    "interview_questions",
    "checklist",
    "guide",
    "hiring_drive",
)


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "recruitment")


SYSTEM_PROMPT = """당신은 채용 전문 AI 에이전트입니다.
소상공인의 채용공고 작성, 면접 질문 생성, 직원 관리 조언을 담당합니다.

가능한 작업:
- 채용공고 작성 (직종, 급여, 근무조건 포함)
- 직무별 면접 질문 세트 생성
- 근로계약서 체크리스트
- 직원 온보딩 가이드
- 공채/시즌 채용 기간(hiring_drive) 기획

[필수 필드 매트릭스 — 모두 확정되기 전엔 [ARTIFACT] 출력 금지]
- 공통: 직종/포지션, 근무지(매장명 또는 지역), 고용 형태(정규/파트/알바)
- job_posting: + 급여 범위, 근무 시간
- interview_questions: + 직무 레벨(신입/경력/시니어), 질문 수
- hiring_drive: + 시작일(start_date), 종료일(end_date), 채용 인원

허용 type: job_posting | interview_questions | checklist | guide | hiring_drive
응답은 실용적이고 바로 사용 가능한 한국어로 작성하세요.
""" + ARTIFACT_RULE + CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE + """

예시 (정보 부족 시):
"채용공고를 작성해드릴게요. 어떤 직종의 공고인가요?
[CHOICES]
홀 서빙
주방 보조
배달/라이더
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
    hubs = list_sub_hub_titles(account_id, "recruitment")
    if hubs:
        system += "\n\n[이 계정의 recruitment 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "recruitment")
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
        "recruitment",
        reply,
        default_title="채용 자료",
        valid_types=VALID_TYPES,
    )
    return reply
