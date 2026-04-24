"""로그인 훅 엔드포인트.

프론트가 Supabase Auth 로그인 성공 직후 호출한다.
- profiles.last_seen_at 을 읽어 "이전 접속 시각" 확보
- orchestrator.build_briefing 조건 판정 + 필요 시 브리핑 생성
- 마지막으로 last_seen_at 을 now 로 갱신 (briefing 조건 판정 "뒤에" 갱신)
"""

from datetime import datetime, timezone

from fastapi import APIRouter

from app.agents.orchestrator import build_briefing
from app.agents._subsidy_cache import maybe_refresh
from app.core.supabase import get_supabase
from app.models.schemas import SessionTouchRequest, SessionTouchResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


@router.post("/session/touch", response_model=SessionTouchResponse)
async def session_touch(req: SessionTouchRequest):
    sb = get_supabase()
    account_id = req.account_id

    # profile row 없으면 생성 (bootstrap_workspace 미실행 계정 대비)
    prev = (
        sb.table("profiles")
        .select("id,last_seen_at")
        .eq("id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not prev:
        sb.table("profiles").insert({"id": account_id}).execute()
        last_seen_at = None
    else:
        last_seen_at = _parse_iso(prev[0].get("last_seen_at"))

    try:
        briefing = await build_briefing(account_id, last_seen_at)
    except Exception as e:
        briefing = {"should_fire": False, "error": str(e)[:300]}

    # 판정 후 갱신
    now_iso = datetime.now(timezone.utc).isoformat()
    sb.table("profiles").update({"last_seen_at": now_iso}).eq("id", account_id).execute()

    # 지원사업 캐시 갱신 (만료됐으면 백그라운드 재계산)
    try:
        await maybe_refresh(account_id)
    except Exception:
        pass

    return SessionTouchResponse(
        data={
            "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
            "now": now_iso,
            "briefing": briefing,
        }
    )
