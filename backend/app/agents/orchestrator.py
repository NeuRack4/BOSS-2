from app.core.llm import chat_completion
from app.core.config import settings

DOMAINS = ("recruitment", "marketing", "sales", "documents")

CLARIFY_RULE = """
[명확화 질문 규칙]
사용자의 요청이 모호하거나 결과물을 만들기 위해 추가 정보가 필요하면, 바로 작업을 수행하지 말고 먼저 **객관식 질문 1개**를 던져 명확히 하세요.

- 질문은 짧고 명확하게 1개만
- 보기는 3~4개 제시하고, **항상 마지막 보기는 "기타 (직접 입력)"**
- 응답 본문 끝에 아래 형식 블록을 반드시 추가:

[CHOICES]
보기1
보기2
보기3
기타 (직접 입력)
[/CHOICES]

- 정보가 충분하면 질문 없이 바로 결과물을 작성하고 [CHOICES] 블록은 넣지 마세요.
- 동시에 여러 개의 [CHOICES] 블록을 넣지 마세요. (한 번에 하나의 질문)
"""

SYSTEM_PROMPT = """당신은 소상공인을 돕는 AI 플랫폼 BOSS의 오케스트레이터입니다.
사용자의 요청을 분석하여 적절한 도메인 에이전트로 라우팅하고, 최종 응답을 조율합니다.

도메인:
- recruitment: 채용공고 작성, 면접 질문, 직원 관리 (채용 관리)
- marketing: SNS 포스트, 광고 카피, 이벤트 기획 (마케팅 관리)
- sales: 매출 분석, 가격 전략, 고객 응대 스크립트 (매출 관리)
- documents: 계약서, 견적서, 공지문, 행정 서류 작성 (서류 관리)

규칙:
1. 요청이 특정 도메인에 해당하면 해당 에이전트를 호출하세요.
2. 여러 도메인에 걸치면 순서대로 처리하세요.
3. 일상 대화나 도메인 무관 질문은 직접 답변하세요.
""" + CLARIFY_RULE


async def classify_intent(message: str, history: list[dict]) -> str:
    """사용자 의도를 분류하여 도메인 반환 (또는 'general')"""
    resp = await chat_completion(
        messages=[
            {"role": "system", "content": (
                "사용자 메시지를 보고 해당하는 도메인을 한 단어로만 답하세요.\n"
                "선택지: recruitment, marketing, sales, documents, general\n"
                "오직 단어 하나만 출력하세요."
            )},
            *history[-4:],
            {"role": "user", "content": message},
        ],
        model=settings.openai_compress_model,
        max_tokens=10,
        temperature=0,
    )
    domain = resp.choices[0].message.content.strip().lower()
    return domain if domain in (*DOMAINS, "general") else "general"


async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    domain = await classify_intent(message, history)

    if domain in DOMAINS:
        from app.agents import recruitment, marketing, sales, documents
        agent_map = {
            "recruitment": recruitment.run,
            "marketing": marketing.run,
            "sales": sales.run,
            "documents": documents.run,
        }
        return await agent_map[domain](message, account_id, history, rag_context, long_term_context)

    # general 답변
    system = SYSTEM_PROMPT
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"

    resp = await chat_completion(
        messages=[{"role": "system", "content": system}, *history, {"role": "user", "content": message}],
    )
    return resp.choices[0].message.content


async def run_scheduled(artifact: dict, account_id: str) -> str:
    """스케줄에 의해 저장된 artifact를 실행. 도메인이 이미 결정돼 있으므로 의도 재분류를 생략.

    cross-domain이면 listed된 모든 도메인 에이전트를 순차 호출해 결과를 병합.
    """
    from app.agents import recruitment, marketing, sales, documents

    agent_map = {
        "recruitment": recruitment.run,
        "marketing": marketing.run,
        "sales": sales.run,
        "documents": documents.run,
    }
    domains = [d for d in (artifact.get("domains") or []) if d in agent_map]
    message = (artifact.get("content") or artifact.get("title") or "").strip()
    if not message:
        return ""

    if not domains:
        return await run(message=message, account_id=account_id, history=[])

    if len(domains) == 1:
        return await agent_map[domains[0]](message, account_id, [], "", "")

    results: list[str] = []
    for d in domains:
        reply = await agent_map[d](message, account_id, [], "", "")
        results.append(f"[{d}]\n{reply}")
    return "\n\n".join(results)
