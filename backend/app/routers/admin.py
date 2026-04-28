"""Admin 전용 엔드포인트.

모든 엔드포인트는 `account_id` 쿼리 파라미터를 받고,
`_require_admin(account_id)` 로 is_admin 여부를 검증한다.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta, timezone, datetime

from fastapi import APIRouter, HTTPException, Query
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin(account_id: str) -> None:
    """account_id의 profiles.is_admin이 true가 아니면 HTTP 403 발생."""
    sb = get_supabase()
    res = (
        sb.table("profiles")
        .select("is_admin")
        .eq("id", account_id)
        .single()
        .execute()
    )
    if not res.data or not res.data.get("is_admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
