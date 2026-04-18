from fastapi import APIRouter, HTTPException
from app.models.schemas import EvaluationRequest, EvaluationResponse
from app.core.supabase import get_supabase
from app.core.llm import chat_completion
from app.core.embedder import embed_text
from app.core.config import settings

router = APIRouter(prefix="/api/evaluations", tags=["evaluations"])


@router.post("", response_model=EvaluationResponse)
async def upsert_evaluation(req: EvaluationRequest):
    if req.rating not in ("up", "down"):
        raise HTTPException(status_code=400, detail="rating must be 'up' or 'down'")

    sb = get_supabase()
    sb.table("evaluations").upsert(
        {
            "account_id": req.account_id,
            "artifact_id": req.artifact_id,
            "rating": req.rating,
            "feedback": (req.feedback or "").strip(),
        },
        on_conflict="account_id,artifact_id",
    ).execute()

    saved_to_memory = False
    feedback = (req.feedback or "").strip()
    if feedback:
        art_res = (
            sb.table("artifacts")
            .select("title,domains,type")
            .eq("id", req.artifact_id)
            .single()
            .execute()
        )
        art = art_res.data or {}
        title = art.get("title") or ""
        domains = art.get("domains") or []

        summary = await _summarize_feedback(title, domains, req.rating, feedback)
        if summary:
            embedding = embed_text(summary)
            sb.table("memory_long").insert(
                {
                    "account_id": req.account_id,
                    "content": summary,
                    "embedding": embedding,
                    "importance": 0.85 if req.rating == "down" else 0.6,
                }
            ).execute()
            saved_to_memory = True

    return EvaluationResponse(
        data={"ok": True, "memory_saved": saved_to_memory}
    )


async def _summarize_feedback(
    title: str, domains: list[str], rating: str, feedback: str
) -> str:
    """피드백을 1-2 문장의 장기기억으로 압축."""
    domains_str = ", ".join(domains) if domains else "general"
    rating_label = "긍정" if rating == "up" else "부정"
    try:
        resp = await chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "사용자 피드백을 1-2 문장으로 요약해 향후 같은 도메인 작업에 참고할 "
                        "장기 기억으로 만드세요. 사용자 선호/금기를 명확히 드러나게 작성. "
                        "불필요한 인사말, 마침표 외 기호, 따옴표 금지."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"도메인: {domains_str}\n"
                        f"평가: {rating_label}\n"
                        f"대상 작업: {title}\n"
                        f"피드백: {feedback}"
                    ),
                },
            ],
            model=settings.openai_compress_model,
            max_tokens=120,
            temperature=0.2,
        )
        return (resp.choices[0].message.content or "").strip()
    except Exception:
        return ""
