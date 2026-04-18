from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.agents.orchestrator import CLARIFY_RULE
from app.agents._feedback import feedback_context

SYSTEM_PROMPT = """당신은 매출 관리 전문 AI 에이전트입니다.
소상공인의 매출 분석, 가격 전략, 고객 응대를 담당합니다.

가능한 작업:
- 매출 데이터 분석 및 인사이트 도출
- 가격 전략 및 할인 정책 수립
- 고객 응대 스크립트 작성
- 재고/발주 관리 체크리스트
- 월별 매출 목표 설정

응답 시 실용적이고 바로 사용 가능한 내용을 한국어로 작성하세요.
아티팩트를 생성할 때는 응답 끝에 다음 형식을 추가하세요:
[ARTIFACT]
type: sales_report|price_strategy|customer_script|checklist
title: <제목>
[/ARTIFACT]
""" + CLARIFY_RULE + """

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
    system = SYSTEM_PROMPT
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "sales")
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
        title = lines.get("title", "매출 자료")
        content = reply.split("[ARTIFACT]")[0].strip()

        sb = get_supabase()
        result = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["sales"],
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
                "domain": "sales",
                "title": title,
                "description": f"{artifact_type} 생성됨",
            }).execute()

            from app.rag.embedder import index_artifact
            await index_artifact(account_id, "sales", result.data[0]["id"], f"{title}\n{content}")
    except Exception:
        pass
