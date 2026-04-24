"""결제 라우터 (PortOne V2 구독).

엔드포인트:
  GET    /api/payment/status        — 구독 상태 조회
  POST   /api/payment/subscribe     — 빌링키 등록 + 첫 결제
  DELETE /api/payment/unsubscribe   — 구독 해지 (기간 만료까지 유지)
  POST   /api/payment/webhook       — PortOne 웹훅 수신
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core.supabase import get_supabase
from app.services.payment import PRO_AMOUNT, PRO_ORDER_NAME, charge_billing_key

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


# ── 구독 등록 (빌링키 + 첫 결제) ──────────────────────────────────────────────

class SubscribeRequest(BaseModel):
    account_id:     str
    billing_key:    str
    billing_method: str   # card | kakaopay | tosspay | naverpay


@router.post("/subscribe")
async def subscribe(req: SubscribeRequest):
    result = await charge_billing_key(
        account_id  = req.account_id,
        billing_key = req.billing_key,
        amount      = PRO_AMOUNT,
        order_name  = PRO_ORDER_NAME,
    )

    if result.get("status") != "PAID":
        msg = result.get("message") or result.get("code") or "알 수 없는 오류"
        log.warning("[payment] first charge failed account=%s: %s", req.account_id, msg)
        raise HTTPException(status_code=400, detail=f"결제 실패: {msg}")

    now          = datetime.now(timezone.utc)
    next_billing = (now + timedelta(days=30)).isoformat()

    get_supabase().table("subscriptions").upsert(
        {
            "account_id":        req.account_id,
            "plan":              "pro",
            "status":            "active",
            "billing_key":       req.billing_key,
            "billing_method":    req.billing_method,
            "amount":            PRO_AMOUNT,
            "next_billing_date": next_billing,
            "started_at":        now.isoformat(),
            "updated_at":        now.isoformat(),
        },
        on_conflict="account_id",
    ).execute()

    log.info("[payment] subscribed account=%s method=%s", req.account_id, req.billing_method)
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
