"""
기업마당 지원사업 수동 크롤 스크립트.

신규 공고만 크롤 (기존 external_id 스킵).
첨부파일(HWP/PDF/DOCX) → Supabase Storage 'subsidy-forms' 버킷 업로드.
공고 텍스트 → BGE-M3 임베딩 → subsidy_programs.embedding 저장.

실행:
  cd backend
  python scripts/crawl_subsidies.py
  python scripts/crawl_subsidies.py --force   # 이미 저장된 공고도 재수집+재임베딩
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import argparse
import logging

from dotenv import load_dotenv
load_dotenv()

from app.core.supabase import get_supabase
from app.core.embedder import embed_text
from app.crawlers.bizinfo import (
    fetch_all_programs,
    fetch_attachments,
    download_attachment,
    content_type_for,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger(__name__)

_BUCKET = "subsidy-forms"
_CONCURRENCY = 5


def _build_embed_text(program: dict) -> str:
    parts = [program.get("title") or ""]
    if program.get("organization"):
        parts.append(program["organization"])
    if program.get("description"):
        parts.append(program["description"])
    if program.get("hashtags"):
        parts.append(program["hashtags"])
    if program.get("program_kind"):
        parts.append(program["program_kind"])
    if program.get("region"):
        parts.append(program["region"])
    return "\n".join(p for p in parts if p)


async def _upload_attachments(sb, external_id: str, detail_url: str) -> list[dict]:
    attachments = await fetch_attachments(detail_url)
    if not attachments:
        return []

    form_files: list[dict] = []
    for att in attachments:
        file_bytes = await download_attachment(att["download_url"])
        if not file_bytes:
            log.warning("  다운로드 실패: %s", att["filename"])
            continue

        storage_path = f"{external_id}/{att['filename']}"
        try:
            sb.storage.from_(_BUCKET).upload(
                path=storage_path,
                file=file_bytes,
                file_options={
                    "content-type": content_type_for(att["file_type"]),
                    "upsert": "true",
                },
            )
            storage_url = sb.storage.from_(_BUCKET).get_public_url(storage_path)
            form_files.append({
                "filename": att["filename"],
                "file_type": att["file_type"],
                "storage_path": storage_path,
                "storage_url": storage_url,
            })
            log.info("  업로드: %s", att["filename"])
        except Exception as exc:
            log.warning("  Storage 업로드 실패 (%s): %s", att["filename"], exc)

    return form_files


async def run(force: bool = False) -> None:
    log.info("기업마당 크롤 시작 (전체 카테고리)...")
    sb = get_supabase()

    programs = await fetch_all_programs()
    log.info("API 조회 완료: %d개 공고", len(programs))

    existing_ids: set[str] = set()
    if not force:
        rows = sb.table("subsidy_programs").select("external_id").execute()
        existing_ids = {r["external_id"] for r in (rows.data or [])}
        log.info("기존 DB 공고: %d개 → 신규 %d개 처리 예정",
                 len(existing_ids), len([p for p in programs if p["external_id"] not in existing_ids]))

    sem = asyncio.Semaphore(_CONCURRENCY)
    new_count = 0
    updated_count = 0

    async def process(program: dict) -> None:
        nonlocal new_count, updated_count
        ext_id = program["external_id"]
        is_new = ext_id not in existing_ids

        if not is_new and not force:
            return

        async with sem:
            log.info("[%s] %s", ext_id, program.get("title", "")[:60])

            row = {k: v for k, v in program.items() if k != "raw"}
            row["fetched_at"] = "now()"

            if program.get("detail_url"):
                row["form_files"] = await _upload_attachments(sb, ext_id, program["detail_url"])
            else:
                row["form_files"] = []

            # 임베딩 생성 (BGE-M3, 동기 → to_thread)
            try:
                embed_content = _build_embed_text(program)
                embedding = await asyncio.to_thread(embed_text, embed_content)
                row["embedding"] = embedding
                log.info("  임베딩 완료 (dim=%d)", len(embedding))
            except Exception as exc:
                log.warning("  임베딩 실패: %s", exc)

            try:
                sb.table("subsidy_programs").upsert(
                    row, on_conflict="external_id"
                ).execute()
                if is_new:
                    new_count += 1
                else:
                    updated_count += 1
            except Exception as exc:
                log.error("  DB upsert 실패: %s", exc)

    await asyncio.gather(*[process(p) for p in programs])

    log.info(
        "크롤 완료 — 신규: %d개 / 업데이트: %d개 / 전체 API: %d개",
        new_count, updated_count, len(programs),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="이미 저장된 공고도 재수집+재임베딩")
    args = parser.parse_args()
    asyncio.run(run(force=args.force))
