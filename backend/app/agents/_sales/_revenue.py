"""매출 저장 dispatch — sales_records + revenue_entry artifact + 부가 로그.

`POST /api/sales` 의 핵심 로직을 에이전트 내부로 이동한 것. 라우터는
얇은 래퍼로 유지되고, chat/agent 경로도 이 함수를 통해서만 저장한다.

동작
----
1. Idempotency 체크 — 최근 5분 내 같은 (account_id, recorded_date, items_hash)
   로 저장된 artifact 가 있으면 skip (중복 저장 방지).
2. `sales_records` bulk insert + 각 row 임베딩 인덱싱.
3. Reports 서브허브에 `revenue_entry` artifact 생성 + `contains` 엣지.
4. `activity_logs.artifact_created` insert — Recent Activity 에 노출되게.
5. `log_artifact_to_memory` — 장기기억 기록.

반환 `{saved: int, artifact_id, duplicate: bool}`.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from app.core.supabase import get_supabase
from app.rag.embedder import index_artifact

log = logging.getLogger(__name__)


def _items_hash(items: list[dict]) -> str:
    """중복 방지용 canonical 해시. item_name+amount+quantity 순서 무관."""
    pairs = sorted(
        (str(it.get("item_name", "")), int(it.get("amount", 0)), int(it.get("quantity", 1)))
        for it in items
    )
    return hashlib.sha256(json.dumps(pairs, ensure_ascii=False).encode()).hexdigest()[:16]


def _record_to_text(record: dict) -> str:
    return (
        f"{record.get('recorded_date', '')} "
        f"{record.get('item_name', '')} "
        f"{record.get('quantity', 1)}개 "
        f"단가 {record.get('unit_price', 0):,}원 "
        f"합계 {record.get('amount', 0):,}원 "
        f"카테고리:{record.get('category', '기타')}"
    )


async def dispatch_save_revenue(
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

    # Idempotency — 최근 5분 내 같은 해시가 이미 저장됐으면 skip
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    try:
        dup = (
            sb.table("artifacts")
            .select("id, metadata")
            .eq("account_id", account_id)
            .eq("type", "revenue_entry")
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
                    "[_sales/_revenue] duplicate skip account=%s artifact=%s digest=%s",
                    account_id, row["id"], digest,
                )
                return {"saved": 0, "artifact_id": row["id"], "duplicate": True}
    except Exception as e:
        log.warning("[_sales/_revenue] idempotency check failed: %s", e)

    # sales_records bulk insert
    rows = [
        {
            "account_id":    account_id,
            "recorded_date": recorded_date,
            "item_name":     it["item_name"],
            "category":      it.get("category") or "기타",
            "quantity":      int(it.get("quantity") or 1),
            "unit_price":    int(it.get("unit_price") or 0),
            "amount":        int(it.get("amount") or 0),
            "source":        source,
            "raw_input":     it.get("raw_input", ""),
            "metadata":      it.get("metadata") or {},
        }
        for it in items
    ]

    try:
        result = sb.table("sales_records").insert(rows).execute()
    except Exception as e:
        raise RuntimeError(f"sales_records 저장 실패: {e}")

    saved_rows = result.data or []
    total_amount = sum(r.get("amount", 0) for r in saved_rows)

    # 임베딩
    for record in saved_rows:
        try:
            await index_artifact(
                account_id=account_id,
                source_type="sales",
                source_id=str(record["id"]),
                content=_record_to_text(record),
            )
        except Exception:
            pass

    # revenue_entry artifact (Reports 서브허브)
    artifact_id: str | None = None
    try:
        hub_res = (
            sb.table("artifacts")
            .select("id")
            .eq("account_id", account_id)
            .eq("kind", "domain")
            .eq("type", "category")
            .ilike("title", "%Reports%")
            .limit(1)
            .execute()
        )
        revenue_hub_id = hub_res.data[0]["id"] if hub_res.data else None

        title = f"{recorded_date} 매출 ({len(saved_rows)}건)"
        art_res = sb.table("artifacts").insert({
            "account_id": account_id,
            "kind":       "artifact",
            "type":       "revenue_entry",
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
            if revenue_hub_id and artifact_id:
                sb.table("artifact_edges").insert({
                    "account_id": account_id,
                    "parent_id":  revenue_hub_id,
                    "child_id":   artifact_id,
                    "relation":   "contains",
                }).execute()
    except Exception as e:
        log.warning("[_sales/_revenue] artifact create failed: %s", e)

    # activity_logs — Recent Activity 에 나오게
    if artifact_id:
        try:
            sb.table("activity_logs").insert({
                "account_id":  account_id,
                "type":        "artifact_created",
                "domain":      "sales",
                "title":       f"{recorded_date} 매출 ({len(saved_rows)}건)",
                "description": f"총 {total_amount:,}원 · {len(saved_rows)}개 항목",
                "metadata":    {"artifact_id": artifact_id, "source": source},
            }).execute()
        except Exception as e:
            log.warning("[_sales/_revenue] activity_log insert failed: %s", e)

    # 장기기억
    if artifact_id:
        try:
            from app.memory.long_term import log_artifact_to_memory
            await log_artifact_to_memory(
                account_id, "sales", "revenue_entry",
                f"{recorded_date} 매출 ({len(saved_rows)}건, 총 {total_amount:,}원)",
            )
        except Exception:
            pass

    return {
        "saved":        len(saved_rows),
        "artifact_id":  artifact_id,
        "total_amount": total_amount,
        "duplicate":    False,
    }
