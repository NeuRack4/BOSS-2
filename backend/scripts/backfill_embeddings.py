"""검색 기능용 임베딩 백필 스크립트.

실행:
    cd backend
    python scripts/backfill_embeddings.py            # 미인덱싱 행만 처리
    python scripts/backfill_embeddings.py --force    # 전체 재인덱싱
    python scripts/backfill_embeddings.py --account-id <UUID>  # 특정 계정만

대상: anchor 제외 모든 artifacts (artifact / schedule / log / domain).
source_type 매핑:
    kind='artifact' → domains[0] (recruitment/marketing/sales/documents)
    kind='schedule' → 'schedule'
    kind='log'      → 'log'
    kind='domain'   → 'hub'

선행 조건: supabase migration 006_expand_embeddings_source_type.sql 적용.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.embedder import embed_batch, embed_text  # noqa: E402
from app.core.supabase import get_supabase  # noqa: E402

BATCH = 32


_source_type = lambda row: (
    (row.get("domains") or ["documents"])[0] if row["kind"] == "artifact"
    else "schedule" if row["kind"] == "schedule"
    else "log" if row["kind"] == "log"
    else "hub" if row["kind"] == "domain"
    else None
)


_build_content = lambda row: "\n".join(p for p in [
    row.get("title") or "",
    row.get("content") or "",
    " | ".join([
        f"cron: {(row.get('metadata') or {}).get('cron')}" if (row.get('metadata') or {}).get('cron') else "",
        f"start: {(row.get('metadata') or {}).get('start_date')}" if (row.get('metadata') or {}).get('start_date') else "",
        f"end: {(row.get('metadata') or {}).get('end_date')}" if (row.get('metadata') or {}).get('end_date') else "",
        f"due: {(row.get('metadata') or {}).get('due_date')}" if (row.get('metadata') or {}).get('due_date') else "",
        f"type: {row.get('type')}" if row.get('type') else "",
    ]).strip(" |"),
] if p)


main = lambda: _run(_parse_args())


def _parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="이미 인덱싱된 행도 다시 임베딩")
    ap.add_argument("--account-id", default=None,
                    help="특정 계정만 백필 (기본: 전체)")
    return ap.parse_args()


def _run(args: argparse.Namespace) -> int:
    sb = get_supabase()

    q = sb.table("artifacts").select(
        "id,account_id,kind,type,domains,title,content,metadata"
    ).neq("kind", "anchor")
    if args.account_id:
        q = q.eq("account_id", args.account_id)
    rows = q.execute().data or []
    print(f"[backfill] candidates: {len(rows)}")

    if not args.force and rows:
        existing: set[str] = set()
        for i in range(0, len(rows), 500):
            ids = [r["id"] for r in rows[i:i + 500]]
            res = (
                sb.table("embeddings")
                .select("source_id")
                .in_("source_id", ids)
                .execute()
            )
            for r in res.data or []:
                existing.add(r["source_id"])
        before = len(rows)
        rows = [r for r in rows if r["id"] not in existing]
        print(f"[backfill] skip {before - len(rows)} already indexed; "
              f"{len(rows)} to process (--force to re-index)")

    if not rows:
        print("[backfill] nothing to do.")
        return 0

    print("[backfill] loading BAAI/bge-m3 model (first call may take 10~30s)...")
    t0 = time.time()
    embed_text("warmup")
    print(f"[backfill] model ready in {time.time() - t0:.1f}s")

    payloads: list[tuple[str, str, str, str]] = []
    for row in rows:
        st = _source_type(row)
        if st is None:
            continue
        content = _build_content(row)
        if not content.strip():
            continue
        payloads.append((row["account_id"], st, row["id"], content))

    print(f"[backfill] embedding {len(payloads)} rows in batches of {BATCH}...")
    ok, fail = 0, 0
    for i in range(0, len(payloads), BATCH):
        batch = payloads[i:i + BATCH]
        try:
            embs = embed_batch([p[3] for p in batch])
        except Exception as e:
            fail += len(batch)
            print(f"[backfill] embed batch {i} FAIL: {e!r}")
            continue
        for (acct, st, sid, content), emb in zip(batch, embs):
            try:
                sb.rpc("upsert_embedding", {
                    "p_account_id":  acct,
                    "p_source_type": st,
                    "p_source_id":   sid,
                    "p_content":     content,
                    "p_embedding":   emb,
                }).execute()
                ok += 1
            except Exception as e:
                fail += 1
                print(f"[backfill] upsert FAIL id={sid} st={st} err={e!r}")
        done = min(i + BATCH, len(payloads))
        print(f"[backfill] {done}/{len(payloads)} (ok={ok}, fail={fail})")

    print(f"[backfill] done. ok={ok}, fail={fail}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
