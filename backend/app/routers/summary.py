from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.models.schemas import SummaryRequest, SummaryResponse

router = APIRouter(prefix="/api/summary", tags=["summary"])

DOMAINS = ("recruitment", "marketing", "sales", "documents")


@router.post("", response_model=SummaryResponse)
async def summarize(req: SummaryRequest):
    """Anchor(scope='all') 또는 Domain(scope='recruitment' 등) 현재 상황 요약.

    최근 30일 activity_logs + artifacts를 LLM에 넣어 요약 생성.
    """
    scope = req.scope
    if scope != "all" and scope not in DOMAINS:
        raise HTTPException(status_code=400, detail="invalid scope")

    sb = get_supabase()
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    logs_q = (
        sb.table("activity_logs")
        .select("type,domain,title,description,created_at")
        .eq("account_id", req.account_id)
        .gte("created_at", since)
        .order("created_at", desc=True)
        .limit(50)
    )
    if scope != "all":
        logs_q = logs_q.eq("domain", scope)
    logs = (logs_q.execute()).data or []

    arts_q = (
        sb.table("artifacts")
        .select("kind,type,title,status,created_at,domains")
        .eq("account_id", req.account_id)
        .neq("kind", "anchor")
        .neq("kind", "domain")
        .order("created_at", desc=True)
        .limit(40)
    )
    arts = (arts_q.execute()).data or []
    if scope != "all":
        arts = [a for a in arts if scope in (a.get("domains") or [])]

    if not logs and not arts:
        return SummaryResponse(
            data={"summary": "최근 30일간 활동 데이터가 없습니다.", "logs": [], "artifacts": []}
        )

    lines: list[str] = []
    lines.append(f"[최근 30일 활동 로그 {len(logs)}건]")
    for log in logs[:20]:
        lines.append(
            f"- {log.get('created_at', '')[:10]} [{log.get('domain', '')}] "
            f"{log.get('type', '')}: {log.get('title') or log.get('description') or ''}"
        )
    lines.append("")
    lines.append(f"[아티팩트 {len(arts)}건]")
    type_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    for a in arts:
        t = a.get("type") or a.get("kind") or ""
        s = a.get("status") or ""
        type_counts[t] = type_counts.get(t, 0) + 1
        status_counts[s] = status_counts.get(s, 0) + 1
    lines.append(
        "타입별: " + ", ".join(f"{k}={v}" for k, v in type_counts.items())
    )
    lines.append(
        "상태별: " + ", ".join(f"{k}={v}" for k, v in status_counts.items())
    )

    scope_label = "전체 도메인" if scope == "all" else f"{scope} 도메인"
    prompt = (
        f"아래는 사용자의 {scope_label} 최근 30일 활동 스냅샷이다. "
        "3~5줄로 한국어 불릿 요약을 작성해라. "
        "각 줄은 '• '로 시작하고 구체적 수치나 날짜가 있으면 포함. "
        "중요 이슈나 멈춘 작업이 있으면 마지막 줄에 강조.\n\n"
        + "\n".join(lines)
    )
    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": "당신은 소상공인 운영 대시보드의 상황 요약 AI다. 간결하고 실용적으로."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=400,
            temperature=0.3,
        )
        summary = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        summary = f"요약 생성 실패: {e}"

    return SummaryResponse(
        data={
            "summary": summary,
            "scope": scope,
            "counts": {
                "logs": len(logs),
                "artifacts": len(arts),
                "types": type_counts,
                "statuses": status_counts,
            },
            "logs": logs[:20],
        }
    )
