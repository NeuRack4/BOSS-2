"""PortOne V2 결제 서비스."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

_PORTONE_BASE = "https://api.portone.io"
PRO_AMOUNT           = 29_900
BUSINESS_AMOUNT      = 99_900
PRO_ORDER_NAME       = "BOSS2 Pro 구독"
BUSINESS_ORDER_NAME  = "BOSS2 Business 구독"

PLAN_AMOUNTS = {"pro": PRO_AMOUNT, "business": BUSINESS_AMOUNT}


def _auth_header() -> dict:
    return {"Authorization": f"PortOne {settings.portone_api_secret}"}


async def verify_payment(payment_id: str) -> dict:
    """PortOne API로 결제 상태 검증."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{_PORTONE_BASE}/payments/{payment_id}",
            headers=_auth_header(),
        )
        data = r.json()
        log.info("[payment] verify status=%s payment_id=%s", data.get("status"), payment_id)
        return data


async def charge_billing_key(
    account_id: str,
    billing_key: str,
    amount: int,
    order_name: str,
) -> dict:
    """빌링키로 즉시 결제 요청."""
    payment_id = f"boss2-{account_id[:8]}-{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{_PORTONE_BASE}/payments/{payment_id}/billing-key",
            headers=_auth_header(),
            json={
                "billingKey": billing_key,
                "orderName": order_name,
                "amount": {"total": amount},
                "currency": "KRW",
                "customer": {"id": account_id},
            },
        )
        data = r.json()
        log.info("[payment] charge result status=%s payment_id=%s", data.get("status"), payment_id)
        return data


async def run_monthly_billing() -> dict:
    """next_billing_date 가 지난 active 구독 월정액 자동 청구."""
    from app.core.supabase import get_supabase

    sb  = get_supabase()
    now = datetime.now(timezone.utc)

    subs = (
        sb.table("subscriptions")
        .select("*")
        .eq("status", "active")
        .neq("plan", "free")
        .lte("next_billing_date", now.isoformat())
        .execute()
        .data or []
    )

    charged, failed = 0, 0
    for sub in subs:
        try:
            result = await charge_billing_key(
                account_id=sub["account_id"],
                billing_key=sub["billing_key"],
                amount=sub["amount"],
                order_name=PRO_ORDER_NAME,
            )
            if result.get("status") == "PAID":
                next_billing = (now + timedelta(days=30)).isoformat()
                sb.table("subscriptions").update({
                    "next_billing_date": next_billing,
                    "updated_at": now.isoformat(),
                }).eq("id", sub["id"]).execute()
                charged += 1
                log.info("[billing] charged account=%s", sub["account_id"])
            else:
                sb.table("subscriptions").update({
                    "status": "past_due",
                    "updated_at": now.isoformat(),
                }).eq("id", sub["id"]).execute()
                failed += 1
                log.warning("[billing] charge failed account=%s: %s", sub["account_id"], result.get("message"))
        except Exception as e:
            failed += 1
            log.error("[billing] error account=%s: %s", sub["account_id"], e)

    return {"total": len(subs), "charged": charged, "failed": failed}
