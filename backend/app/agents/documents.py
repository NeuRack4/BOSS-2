from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.agents.orchestrator import CLARIFY_RULE
from app.agents._feedback import feedback_context

SYSTEM_PROMPT = """당신은 서류 관리 전문 AI 에이전트입니다.
소상공인의 각종 서류 작성, 계약서, 공문서, 행정 서류를 담당합니다.

가능한 작업:
- 근로계약서 초안 작성
- 거래처 계약서 / 견적서 / 발주서 작성
- 사업자 관련 행정 서류 안내
- 공지문 / 안내문 / 사내 규정 문서 작성
- 서류 체크리스트 작성

응답 시 실용적이고 바로 사용 가능한 내용을 한국어로 작성하세요.
아티팩트를 생성할 때는 응답 끝에 다음 형식을 추가하세요:
[ARTIFACT]
type: contract|estimate|notice|checklist|guide
title: <제목>
[/ARTIFACT]
""" + CLARIFY_RULE + """

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
    system = SYSTEM_PROMPT
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "documents")
    if fb:
        system += f"\n\n{fb}"

    resp = await chat_completion(
        messages=[{"role": "system", "content": system}, *history, {"role": "user", "content": message}],
    )
    reply = resp.choices[0].message.content
    await _maybe_save_artifact(account_id, reply)
    return reply


async def _maybe_save_artifact(account_id: str, reply: str) -> None:
    if "[ARTIFACT]" not in reply:
        return
    try:
        block = reply.split("[ARTIFACT]")[1].split("[/ARTIFACT]")[0]
        lines = {k.strip(): v.strip() for k, v in (l.split(":", 1) for l in block.strip().splitlines() if ":" in l)}
        artifact_type = lines.get("type", "note")
        title = lines.get("title", "서류")
        content = reply.split("[ARTIFACT]")[0].strip()

        sb = get_supabase()
        result = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["documents"],
            "kind": "artifact",
            "type": artifact_type,
            "title": title,
            "content": content,
            "status": "draft",
        }).execute()

        if result.data:
            sb.table("activity_logs").insert({
                "account_id": account_id,
                "type": "artifact_created",
                "domain": "documents",
                "title": title,
                "description": f"{artifact_type} 생성됨",
            }).execute()

            from app.rag.embedder import index_artifact
            await index_artifact(account_id, "documents", result.data[0]["id"], f"{title}\n{content}")
    except Exception:
        pass
