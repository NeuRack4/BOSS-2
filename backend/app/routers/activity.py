from fastapi import APIRouter, Query
from app.models.schemas import ActivityResponse
from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("", response_model=ActivityResponse)
async def get_activity(account_id: str = Query(...), limit: int = Query(50, le=200)):
    sb = get_supabase()
    result = (
        sb
        .table("activity_logs")
        .select("*")
        .eq("account_id", account_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return ActivityResponse(data=result.data or [])
