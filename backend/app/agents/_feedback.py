"""사용자 평가/피드백을 system prompt 에 주입하는 헬퍼."""

from app.core.supabase import get_supabase


def feedback_context(account_id: str, domain: str, limit: int = 5) -> str:
    """해당 도메인에서 사용자가 👎 평가한 artifact 의 피드백을 모아 system prompt 에 합침."""
    sb = get_supabase()
    res = (
        sb.table("evaluations")
        .select("rating,feedback,artifacts!inner(title,domains,kind)")
        .eq("account_id", account_id)
        .eq("rating", "down")
        .order("updated_at", desc=True)
        .limit(limit * 3)
        .execute()
    )
    items = res.data or []
    # artifacts.domains 가 배열이므로 Python 측에서 필터
    filtered = [
        i for i in items
        if domain in ((i.get("artifacts") or {}).get("domains") or [])
    ][:limit]
    if not filtered:
        return ""

    lines = ["[사용자 부정 피드백 — 이런 식의 결과물은 피하세요]"]
    for i in filtered:
        a = i.get("artifacts") or {}
        title = a.get("title") or "(제목 없음)"
        fb = (i.get("feedback") or "").strip()
        if fb:
            lines.append(f"- '{title}': {fb}")
        else:
            lines.append(f"- '{title}' (이유 미기재)")

    # 긍정 피드백도 1-2개 함께 (좋았던 점 유지하라고)
    pos = (
        sb.table("evaluations")
        .select("feedback,artifacts!inner(title,domains)")
        .eq("account_id", account_id)
        .eq("rating", "up")
        .neq("feedback", "")
        .order("updated_at", desc=True)
        .limit(limit * 3)
        .execute()
        .data
        or []
    )
    pos_filtered = [
        i for i in pos
        if domain in ((i.get("artifacts") or {}).get("domains") or [])
    ][:2]
    if pos_filtered:
        lines.append("\n[사용자 긍정 피드백 — 이런 점은 유지]")
        for i in pos_filtered:
            a = i.get("artifacts") or {}
            lines.append(f"- '{a.get('title','')}': {(i.get('feedback') or '').strip()}")

    return "\n".join(lines)
