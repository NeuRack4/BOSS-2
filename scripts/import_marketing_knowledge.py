"""
BOSS → BOSS2 마케팅 지식베이스 임포트 스크립트

임포트 대상:
  1. subsidy_programs (107개) — 소상공인 정부 지원사업
  2. marketing_knowledge_chunks (소상공인보호법 205개 + 개인정보보호법 546개)

Usage:
  cd backend
  python scripts/import_marketing_knowledge.py          # 신규만 (upsert)
  python scripts/import_marketing_knowledge.py --force  # 전체 재삽입
"""

import sys
import os
import argparse
import logging
from pathlib import Path

# backend/ 경로를 sys.path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase import create_client
from app.core.config import settings
from app.core.embedder import embed_batch as embed_texts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── BOSS Supabase 연결 정보 ──────────────────────────────────────────────────
BOSS_URL = "https://ckbnhrpzgfhwzjslyesf.supabase.co"
BOSS_KEY_ENV = "BOSS_SUPABASE_SERVICE_KEY"  # 환경변수로 주입 권장

# fallback: BOSS .env에서 직접 읽기 (dev only)
_BOSS_ENV_PATH = Path(__file__).parent.parent.parent / "BOSS" / ".env"


def _load_boss_key() -> str:
    key = os.environ.get(BOSS_KEY_ENV)
    if key:
        return key
    if _BOSS_ENV_PATH.exists():
        with open(_BOSS_ENV_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("SUPABASE_SERVICE_ROLE_KEY") or line.startswith(
                    "SUPABASE_SERVICE_KEY"
                ):
                    return line.split("=", 1)[1].strip()
    raise RuntimeError(
        f"BOSS Supabase service key 없음. {BOSS_KEY_ENV} 환경변수를 설정하거나 BOSS .env를 확인하세요."
    )


def paginate(sb_boss, table: str, select: str, filters: dict | None = None):
    """Supabase 전체 페이지 로딩 헬퍼"""
    all_rows = []
    offset = 0
    while True:
        q = sb_boss.table(table).select(select)
        if filters:
            for k, v in filters.items():
                q = q.eq(k, v)
        batch = q.range(offset, offset + 999).execute()
        all_rows.extend(batch.data)
        if len(batch.data) < 1000:
            break
        offset += 1000
    return all_rows


# ── 1. subsidy_programs 임포트 ───────────────────────────────────────────────

def import_subsidy_programs(sb_boss, sb_boss2, force: bool) -> int:
    log.info("subsidy_programs 로딩 중...")
    rows = paginate(sb_boss, "subsidy_programs",
                    "id,external_id,title,organization,region,program_kind,sub_kind,"
                    "target,start_date,end_date,period_raw,is_ongoing,description,"
                    "detail_url,external_url,hashtags,raw,fetched_at")

    log.info(f"  BOSS: {len(rows)}개 로드")

    if force:
        sb_boss2.table("subsidy_programs").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
        log.info("  기존 데이터 삭제 완료 (--force)")

    # 기존 external_id 목록 조회
    existing_ids: set[str] = set()
    if not force:
        ex = sb_boss2.table("subsidy_programs").select("external_id").execute()
        existing_ids = {r["external_id"] for r in ex.data if r.get("external_id")}

    upsert_rows = []
    for r in rows:
        ext_id = r.get("external_id") or r["id"]
        if not force and ext_id in existing_ids:
            continue

        upsert_rows.append({
            "external_id":  ext_id,
            "title":        r.get("title") or "",
            "organization": r.get("organization"),
            "region":       r.get("region"),
            "program_kind": r.get("program_kind"),
            "sub_kind":     r.get("sub_kind"),
            "target":       r.get("target"),
            "start_date":   r.get("start_date"),
            "end_date":     r.get("end_date"),
            "period_raw":   r.get("period_raw"),
            "is_ongoing":   r.get("is_ongoing", False),
            "description":  r.get("description"),
            "detail_url":   r.get("detail_url"),
            "external_url": r.get("external_url"),
            "hashtags":     r.get("hashtags"),
            "raw":          r.get("raw") or {},
            "fetched_at":   r.get("fetched_at"),
        })

    if not upsert_rows:
        log.info("  신규 데이터 없음. 스킵.")
        return 0

    # 배치 삽입 (100개씩)
    BATCH = 100
    inserted = 0
    for i in range(0, len(upsert_rows), BATCH):
        chunk = upsert_rows[i : i + BATCH]
        sb_boss2.table("subsidy_programs").upsert(chunk, on_conflict="external_id").execute()
        inserted += len(chunk)
        log.info(f"  진행: {inserted}/{len(upsert_rows)}")

    log.info(f"  완료: {inserted}개 upsert")

    # 임베딩 생성 (BGE-M3)
    log.info("  BGE-M3 임베딩 생성 중...")
    rows_no_emb = (
        sb_boss2.table("subsidy_programs")
        .select("id,title,description,hashtags,organization,region")
        .is_("embedding", "null")
        .execute()
        .data
    )
    if rows_no_emb:
        texts = [
            (r.get("title") or "") + " " +
            (r.get("description") or "") + " " +
            (r.get("hashtags") or "") + " " +
            (r.get("organization") or "") + " " +
            (r.get("region") or "")
            for r in rows_no_emb
        ]
        embeddings = embed_texts(texts)
        for r, emb in zip(rows_no_emb, embeddings):
            sb_boss2.table("subsidy_programs").update({"embedding": emb}).eq("id", r["id"]).execute()
        log.info(f"  임베딩 {len(rows_no_emb)}개 저장 완료")

    return inserted


# ── 2. marketing_knowledge_chunks 임포트 ────────────────────────────────────

_IMPORT_CATEGORIES = {
    "subsidy_law": {
        "law_table": "law_chunks",
        "category": "subsidy",
        "description": "소상공인보호법 + 중소기업창업지원법",
    },
    "privacy_law": {
        "law_table": "law_chunks",
        "category": "regulation",
        "description": "개인정보 보호법 (마케팅 데이터 수집 컴플라이언스)",
    },
}


def import_knowledge_chunks(sb_boss, sb_boss2, force: bool) -> int:
    if force:
        sb_boss2.table("marketing_knowledge_chunks").delete().neq(
            "id", "00000000-0000-0000-0000-000000000000"
        ).execute()
        log.info("  marketing_knowledge_chunks 기존 데이터 삭제 (--force)")

    total_inserted = 0

    for mkt_category, cfg in _IMPORT_CATEGORIES.items():
        log.info(f"[{mkt_category}] {cfg['description']} 로딩 중...")

        # 기존 (category, chunk_index) 확인
        existing_keys: set[tuple] = set()
        if not force:
            ex = sb_boss2.table("marketing_knowledge_chunks").select(
                "category,chunk_index"
            ).eq("category", mkt_category).execute()
            existing_keys = {(r["category"], r["chunk_index"]) for r in ex.data}

        rows = paginate(
            sb_boss,
            cfg["law_table"],
            "id,category,source,chunk_index,content",
            {"category": cfg["category"]},
        )
        log.info(f"  BOSS: {len(rows)}개 로드")

        texts = [r["content"] for r in rows]
        log.info(f"  임베딩 생성 중... ({len(texts)}개)")
        embeddings = embed_texts(texts)  # List[List[float]]  (embed_batch)

        insert_rows = []
        for r, emb in zip(rows, embeddings):
            key = (mkt_category, r["chunk_index"])
            if not force and key in existing_keys:
                continue
            insert_rows.append({
                "category":    mkt_category,
                "source":      r["source"],
                "chunk_index": r["chunk_index"],
                "content":     r["content"],
                "embedding":   emb,
                "metadata":    {"original_category": cfg["category"]},
            })

        if not insert_rows:
            log.info("  신규 없음. 스킵.")
            continue

        BATCH = 50
        inserted = 0
        for i in range(0, len(insert_rows), BATCH):
            chunk = insert_rows[i : i + BATCH]
            sb_boss2.table("marketing_knowledge_chunks").insert(chunk).execute()
            inserted += len(chunk)
            log.info(f"  진행: {inserted}/{len(insert_rows)}")

        log.info(f"  [{mkt_category}] 완료: {inserted}개 삽입")
        total_inserted += inserted

    return total_inserted


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="BOSS → BOSS2 마케팅 지식 임포트")
    parser.add_argument("--force", action="store_true", help="기존 데이터 삭제 후 전체 재삽입")
    parser.add_argument("--subsidy-only", action="store_true", help="지원사업만 임포트")
    parser.add_argument("--knowledge-only", action="store_true", help="법령 지식만 임포트")
    args = parser.parse_args()

    boss_key = _load_boss_key()
    sb_boss  = create_client(BOSS_URL, boss_key)
    sb_boss2 = create_client(settings.supabase_url, settings.supabase_service_key)

    total = 0

    if not args.knowledge_only:
        log.info("=== subsidy_programs 임포트 ===")
        total += import_subsidy_programs(sb_boss, sb_boss2, args.force)

    if not args.subsidy_only:
        log.info("=== marketing_knowledge_chunks 임포트 ===")
        total += import_knowledge_chunks(sb_boss, sb_boss2, args.force)

    log.info(f"\n임포트 완료. 총 {total}개 행 삽입.")


if __name__ == "__main__":
    main()
