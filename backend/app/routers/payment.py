"""결제 라우터 (PortOne V2 일반결제 기반 구독).

엔드포인트:
  GET    /api/payment/status        — 구독 상태 조회
  POST   /api/payment/subscribe     — 결제 확인 + 구독 활성화 (30일)
  DELETE /api/payment/unsubscribe   — 구독 해지
  POST   /api/payment/webhook       — PortOne 웹훅 수신
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.supabase import get_supabase
from app.services.payment import PLAN_AMOUNTS, verify_payment

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/api/payment", tags=["payment"])


# ── 구독 상태 조회 ─────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status(account_id: str):
    sb  = get_supabase()
    res = (
        sb.table("subscriptions")
        .select("plan,status,billing_method,next_billing_date,started_at,cancelled_at")
        .eq("account_id", account_id)
        .execute()
    )
    if not res.data:
        return {"plan": "free", "status": "active", "next_billing_date": None}
    return res.data[0]


# ── 구독 등록 (일반결제 확인 + 구독 30일 활성화) ─────────────────────────────

class SubscribeRequest(BaseModel):
    account_id:     str
    payment_id:     str
    billing_method: str   # card | kakaopay | tosspay | payco
    plan:           str = "pro"  # pro | business


@router.post("/subscribe")
async def subscribe(req: SubscribeRequest):
    expected_amount = PLAN_AMOUNTS.get(req.plan)
    if expected_amount is None:
        raise HTTPException(status_code=400, detail=f"알 수 없는 플랜: {req.plan}")

    result = await verify_payment(req.payment_id)

    status = result.get("status")
    amount = (result.get("amount") or {}).get("total", 0)

    if status != "PAID":
        msg = result.get("message") or result.get("code") or "결제 미완료"
        log.warning("[payment] verify failed account=%s: %s", req.account_id, msg)
        raise HTTPException(status_code=400, detail=f"결제 확인 실패: {msg}")

    if amount != expected_amount:
        raise HTTPException(status_code=400, detail=f"결제 금액 불일치: {amount}")

    now          = datetime.now(timezone.utc)
    next_billing = (now + timedelta(days=30)).isoformat()

    get_supabase().table("subscriptions").upsert(
        {
            "account_id":        req.account_id,
            "plan":              req.plan,
            "status":            "active",
            "billing_method":    req.billing_method,
            "amount":            expected_amount,
            "next_billing_date": next_billing,
            "started_at":        now.isoformat(),
            "updated_at":        now.isoformat(),
        },
        on_conflict="account_id",
    ).execute()

    log.info("[payment] subscribed account=%s plan=%s method=%s payment=%s", req.account_id, req.plan, req.billing_method, req.payment_id)
    return {"success": True, "next_billing_date": next_billing}


# ── 구독 해지 ──────────────────────────────────────────────────────────────────

@router.delete("/unsubscribe")
async def unsubscribe(account_id: str):
    now = datetime.now(timezone.utc)
    get_supabase().table("subscriptions").update({
        "status":       "cancelled",
        "cancelled_at": now.isoformat(),
        "updated_at":   now.isoformat(),
    }).eq("account_id", account_id).execute()
    log.info("[payment] unsubscribed account=%s", account_id)
    return {"success": True}


# ── PortOne 웹훅 ───────────────────────────────────────────────────────────────

@router.post("/webhook")
async def webhook(request: Request):
    payload  = await request.json()
    tx_type  = payload.get("type", "")
    data     = payload.get("data", {})
    log.info("[payment] webhook type=%s", tx_type)

    if tx_type == "Transaction.PaymentFailed":
        payment_id = data.get("paymentId", "")
        # payment_id = "boss2-{account_id[:8]}-{hex}" 형식
        parts = payment_id.split("-")
        if len(parts) >= 2:
            log.warning("[payment] payment failed payment_id=%s", payment_id)
            # 필요 시 past_due 처리 가능

    return {"ok": True}
