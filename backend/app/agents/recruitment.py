from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.agents.orchestrator import CLARIFY_RULE
from app.agents._feedback import feedback_context

SYSTEM_PROMPT = """당신은 채용 전문 AI 에이전트입니다.
소상공인의 채용공고 작성, 면접 질문 생성, 직원 관리 조언을 담당합니다.

가능한 작업:
- 채용공고 작성 (직종, 급여, 근무조건 포함)
- 직무별 면접 질문 세트 생성
- 근로계약서 체크리스트
- 직원 온보딩 가이드

응답 시 실용적이고 바로 사용 가능한 내용을 한국어로 작성하세요.
아티팩트(채용공고, 면접질문 등)를 생성할 때는 응답 끝에 다음 형식을 추가하세요:
[ARTIFACT]
type: job_posting|interview_questions|checklist|guide
title: <제목>
[/ARTIFACT]
""" + CLARIFY_RULE + """

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
    system = SYSTEM_PROMPT
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "recruitment")
    if fb:
        system += f"\n\n{fb}"

    resp = await chat_completion(
        messages=[{"role": "system", "content": system}, *history, {"role": "user", "content": message}],
    )
    reply = resp.choices[0].message.content

    # 아티팩트 파싱 후 저장
    await _maybe_save_artifact(account_id, message, reply)
    return reply


async def _maybe_save_artifact(account_id: str, message: str, reply: str) -> None:
    if "[ARTIFACT]" not in reply:
        return
    try:
        block = reply.split("[ARTIFACT]")[1].split("[/ARTIFACT]")[0]
        lines = {k.strip(): v.strip() for k, v in (l.split(":", 1) for l in block.strip().splitlines() if ":" in l)}
        artifact_type = lines.get("type", "note")
        title = lines.get("title", "채용 자료")
        content = reply.split("[ARTIFACT]")[0].strip()

        sb = get_supabase()
        result = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["recruitment"],
            "kind": "artifact",
            "type": artifact_type,
            "title": title,
            "content": content,
            "status": "draft",
        }).execute()

        # 활동이력 기록
        if result.data:
            sb.table("activity_logs").insert({
                "account_id": account_id,
                "type": "artifact_created",
                "domain": "recruitment",
                "title": title,
                "description": f"{artifact_type} 생성됨",
                "metadata": {"artifact_id": result.data[0]["id"]},
            }).execute()

            # RAG 인덱싱 (백그라운드)
            from app.rag.embedder import index_artifact
            await index_artifact(account_id, "recruitment", result.data[0]["id"], f"{title}\n{content}")
    except Exception:
        pass  # 아티팩트 저장 실패는 응답에 영향 없음
