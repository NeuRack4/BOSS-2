from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.agents.orchestrator import CLARIFY_RULE
from app.agents._feedback import feedback_context

SYSTEM_PROMPT = """당신은 마케팅 전문 AI 에이전트입니다.
소상공인의 SNS 마케팅, 광고, 이벤트 기획을 담당합니다.

가능한 작업:
- 인스타그램/네이버 블로그 포스트 작성
- 광고 카피 및 홍보 문구 생성
- 월별 마케팅 캘린더 기획
- 이벤트/프로모션 기획안

응답 시 실용적이고 바로 사용 가능한 내용을 한국어로 작성하세요.
아티팩트를 생성할 때는 응답 끝에 다음 형식을 추가하세요:
[ARTIFACT]
type: sns_post|ad_copy|marketing_plan|event_plan
title: <제목>
[/ARTIFACT]
""" + CLARIFY_RULE + """

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
    system = SYSTEM_PROMPT
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    resp = await chat_completion(
        messages=[{"role": "system", "content": system}, *history, {"role": "user", "content": message}],
    )
    reply = resp.choices[0].message.content
    await _maybe_save_artifact(account_id, message, reply)
    return reply


async def _maybe_save_artifact(account_id: str, message: str, reply: str) -> None:
    if "[ARTIFACT]" not in reply:
        return
    try:
        block = reply.split("[ARTIFACT]")[1].split("[/ARTIFACT]")[0]
        lines = {k.strip(): v.strip() for k, v in (l.split(":", 1) for l in block.strip().splitlines() if ":" in l)}
        artifact_type = lines.get("type", "note")
        title = lines.get("title", "마케팅 자료")
        content = reply.split("[ARTIFACT]")[0].strip()

        sb = get_supabase()
        result = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
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
                "domain": "marketing",
                "title": title,
                "description": f"{artifact_type} 생성됨",
                "metadata": {"artifact_id": result.data[0]["id"]},
            }).execute()

            from app.rag.embedder import index_artifact
            await index_artifact(account_id, "marketing", result.data[0]["id"], f"{title}\n{content}")
    except Exception:
        pass
