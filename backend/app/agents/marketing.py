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
    "sns_post",
    "ad_copy",
    "marketing_plan",
    "event_plan",
    "campaign",
)


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "marketing")


SYSTEM_PROMPT = """당신은 마케팅 전문 AI 에이전트입니다.
소상공인의 SNS 마케팅, 광고, 이벤트 기획을 담당합니다.

가능한 작업:
- 인스타그램/네이버 블로그 포스트 작성
- 광고 카피 및 홍보 문구 생성
- 월별 마케팅 캘린더 기획
- 이벤트/프로모션 기획안
- 기간성 광고 캠페인(campaign) 기획

[필수 필드 매트릭스 — 모두 확정되기 전엔 [ARTIFACT] 출력 금지]
- 공통: 목표(인지도/전환/재방문 등), 타겟 고객(연령·관심사·지역), 주 채널
- sns_post / ad_copy: + 톤앤매너, 핵심 메시지
- event_plan: + 행사 일자(due_date 또는 start_date+end_date), 혜택·참여 방법
- campaign: + 시작일(start_date), 종료일(end_date), 예산 범위, 기대 KPI

허용 type: sns_post | ad_copy | marketing_plan | event_plan | campaign
응답은 실용적이고 바로 사용 가능한 한국어로 작성하세요.
""" + ARTIFACT_RULE + CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE + """

예시 (정보 부족 시):
"홍보 콘텐츠를 만들어드릴게요. 어떤 채널에 올리실 건가요?
[CHOICES]
인스타그램 피드
인스타그램 스토리
네이버 블로그
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
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
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
        "marketing",
        reply,
        default_title="마케팅 자료",
        valid_types=VALID_TYPES,
    )
    return reply
