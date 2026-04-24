"""contract 관행적 허용 조항 인제스트.

Source: backend/app/agents/_doc_knowledge/<subtype>/acceptable.md (v0.7.0 복사본)
Target: public.acceptable_contract_knowledge_chunks

청킹 전략:
    '### 허용패턴 N:' 블록 단위로 1청크.

전용 컬럼:
    clause_name   — 허용 조항 이름
    legal_basis   — 법적 근거 요약 (허용 근거 줄에서 추출)
    contract_type — 계약서 서브타입 (category 와 동일)

멱등성: source + chunk_index unique 기반 upsert.

사용법:
    cd backend
    python scripts/ingest_contract_acceptable.py
    python scripts/ingest_contract_acceptable.py --subtype labor
    python scripts/ingest_contract_acceptable.py --reset
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.embedder import embed_batch, embed_text  # noqa: E402
from app.core.supabase import get_supabase  # noqa: E402

_TABLE = "acceptable_contract_knowledge_chunks"
_KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent / "app" / "agents" / "_doc_knowledge"

_VALID_SUBTYPES = ("labor", "lease", "service", "supply", "partnership", "franchise", "nda")

_PATTERN_HEADER = re.compile(r"^#{1,4}\s*허용패턴\s*\d+\s*[:：]?\s*(.+)$", re.MULTILINE)
_LEGAL_BASIS_LINE = re.compile(r"\*{0,2}허용\s*근거\*{0,2}\s*[:：]\s*(.+)")


def _extract_legal_basis(text: str) -> str | None:
    m = _LEGAL_BASIS_LINE.search(text)
    if not m:
        return None
    return m.group(1).strip()[:200]


def _chunk_by_pattern(content: str) -> list[dict]:
    matches = list(_PATTERN_HEADER.finditer(content))
    if not matches:
        return [{"clause_name": "전체", "content": content.strip()}]
    chunks: list[dict] = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        chunks.append({"clause_name": m.group(1).strip(), "content": content[start:end].strip()})
    return chunks


def _build_chunks_for_subtype(subtype: str) -> list[dict]:
    md_path = _KNOWLEDGE_ROOT / subtype / "acceptable.md"
    if not md_path.is_file():
        print(f"  [{subtype}] acceptable.md 없음 — skip")
        return []
    text = md_path.read_text(encoding="utf-8")
    raw_chunks = _chunk_by_pattern(text)
    out: list[dict] = []
    for idx, rc in enumerate(raw_chunks):
        out.append({
            "source":        f"{subtype}/acceptable.md",
            "category":      subtype,
            "contract_type": subtype,
            "chunk_index":   idx,
            "clause_name":   rc["clause_name"][:200],
            "legal_basis":   _extract_legal_basis(rc["content"]),
            "content":       rc["content"],
            "metadata": {
                "clause_name": rc["clause_name"],
                "category":    subtype,
            },
        })
    print(f"  [{subtype}] {len(out)} 청크 준비")
    return out


def _save_chunks(chunks: list[dict], batch_size: int = 16) -> int:
    if not chunks:
        return 0
    sb = get_supabase()
    saved = 0
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        texts = [c["content"] for c in batch]
        try:
            vectors = embed_batch(texts)
        except Exception as exc:
            print(f"[오류] 임베딩 실패 (batch {i}): {exc}")
            continue
        rows = [
            {
                "source":        c["source"],
                "category":      c["category"],
                "contract_type": c["contract_type"],
                "chunk_index":   c["chunk_index"],
                "clause_name":   c["clause_name"],
                "legal_basis":   c["legal_basis"],
                "content":       c["content"],
                "embedding":     v,
                "metadata":      c["metadata"],
            }
            for c, v in zip(batch, vectors)
        ]
        try:
            sb.table(_TABLE).upsert(rows, on_conflict="source,chunk_index").execute()
            saved += len(rows)
            print(f"  [{batch[0]['source']}] {saved} 청크 저장")
        except Exception as exc:
            print(f"[오류] DB 저장 실패 (batch {i}): {exc}")
    return saved


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--subtype", choices=_VALID_SUBTYPES, default=None)
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    subtypes = [args.subtype] if args.subtype else list(_VALID_SUBTYPES)

    sb = get_supabase()
    if args.reset:
        for s in subtypes:
            src = f"{s}/acceptable.md"
            print(f"[reset] delete source={src}")
            sb.table(_TABLE).delete().eq("source", src).execute()

    print("[warmup] BAAI/bge-m3 모델 로딩...")
    embed_text("warmup")

    total = 0
    for s in subtypes:
        chunks = _build_chunks_for_subtype(s)
        total += _save_chunks(chunks)

    print(f"\n완료: {_TABLE} 에 총 {total} 청크 저장")


if __name__ == "__main__":
    main()
