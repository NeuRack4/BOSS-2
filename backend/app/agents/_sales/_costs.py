"""비용 저장 dispatch — `_revenue.py` 와 1:1 대응.

`cost_records` insert + 임베딩 + `cost_report` artifact + activity_log +
장기기억 + 5분 idempotency.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from app.core.supabase import get_supabase
from app.rag.embedder import index_artifact

log = logging.getLogger(__name__)

VALID_CATEGORIES = {"재료비", "인건비", "임대료", "공과금", "마케팅", "기타"}


def _items_hash(items: list[dict]) -> str:
    pairs = sorted(
        (str(it.get("item_name", "")), int(it.get("amount", 0)), str(it.get("category", "")))
        for it in items
    )
    return hashlib.sha256(json.dumps(pairs, ensure_ascii=False).encode()).hexdigest()[:16]


def _record_to_text(record: dict) -> str:
    return (
        f"{record.get('recorded_date', '')} "
        f"{record.get('item_name', '')} "
        f"{record.get('amount', 0):,}원 "
        f"카테고리:{record.get('category', '기타')} "
        f"메모:{record.get('memo', '')}"
    )


async def dispatch_save_costs(
    *,
    account_id: str,
    items: list[dict],
    recorded_date: str,
    source: str = "chat",
) -> dict:
    if not items:
        return {"saved": 0, "artifact_id": None, "duplicate": False, "reason": "empty"}

    sb = get_supabase()
    digest = _items_hash(items)

    # Idempotency
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    try:
        dup = (
            sb.table("artifacts")
            .select("id, metadata")
            .eq("account_id", account_id)
            .eq("type", "cost_report")
            .gte("created_at", cutoff)
            .limit(20)
            .execute()
            .data
            or []
        )
        for row in dup:
            meta = row.get("metadata") or {}
            if meta.get("items_hash") == digest and meta.get("recorded_date") == recorded_date:
                log.info(
                    "[_sales/_costs] duplicate skip account=%s artifact=%s digest=%s",
                    account_id, row["id"], digest,
                )
                return {"saved": 0, "artifact_id": row["id"], "duplicate": True}
    except Exception as e:
        log.warning("[_sales/_costs] idempotency check failed: %s", e)

    rows = [
        {
            "account_id":    account_id,
            "recorded_date": recorded_date,
            "item_name":     it["item_name"],
            "category":      it.get("category") if it.get("category") in VALID_CATEGORIES else "기타",
            "amount":        int(it.get("amount") or 0),
            "memo":          it.get("memo", ""),
            "source":        source,
        }
        for it in items
    ]

    try:
        result = sb.table("cost_records").insert(rows).execute()
    except Exception as e:
        raise RuntimeError(f"cost_records 저장 실패: {e}")

    saved_rows = result.data or []
    total_amount = sum(r.get("amount", 0) for r in saved_rows)

    for record in saved_rows:
        try:
            await index_artifact(
                account_id=account_id,
                source_type="sales",
                source_id=f"cost_{record['id']}",
                content=_record_to_text(record),
            )
        except Exception:
            pass

    artifact_id: str | None = None
    try:
        hub_res = (
            sb.table("artifacts")
            .select("id")
            .eq("account_id", account_id)
            .eq("kind", "domain")
            .eq("type", "category")
            .ilike("title", "%Costs%")
            .limit(1)
            .execute()
        )
        costs_hub_id = hub_res.data[0]["id"] if hub_res.data else None

        title = f"{recorded_date} 비용 ({len(saved_rows)}건)"
        art_res = sb.table("artifacts").insert({
            "account_id": account_id,
            "kind":       "artifact",
            "type":       "cost_report",
            "domains":    ["sales"],
            "title":      title,
            "content":    f"총 {total_amount:,}원 · {len(saved_rows)}개 항목",
            "status":     "active",
            "metadata": {
                "recorded_date": recorded_date,
                "record_count":  len(saved_rows),
                "total_amount":  total_amount,
                "items_hash":    digest,
                "source":        source,
            },
        }).execute()

        if art_res.data:
            artifact_id = art_res.data[0]["id"]
            if costs_hub_id and artifact_id:
                sb.table("artifact_edges").insert({
                    "account_id": account_id,
                    "parent_id":  costs_hub_id,
                    "child_id":   artifact_id,
                    "relation":   "contains",
                }).execute()
    except Exception as e:
        log.warning("[_sales/_costs] artifact create failed: %s", e)

    if artifact_id:
        try:
            sb.table("activity_logs").insert({
                "account_id":  account_id,
                "type":        "artifact_created",
                "domain":      "sales",
                "title":       f"{recorded_date} 비용 ({len(saved_rows)}건)",
                "description": f"총 {total_amount:,}원 · {len(saved_rows)}개 항목",
                "metadata":    {"artifact_id": artifact_id, "source": source},
            }).execute()
        except Exception as e:
            log.warning("[_sales/_costs] activity_log insert failed: %s", e)

    if artifact_id:
        try:
            from app.memory.long_term import log_artifact_to_memory
            await log_artifact_to_memory(
                account_id, "sales", "cost_report",
                f"{recorded_date} 비용 ({len(saved_rows)}건, 총 {total_amount:,}원)",
            )
        except Exception:
            pass

    return {
        "saved":        len(saved_rows),
        "artifact_id":  artifact_id,
        "total_amount": total_amount,
        "duplicate":    False,
    }
