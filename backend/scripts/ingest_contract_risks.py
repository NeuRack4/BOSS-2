"""contract 위험 조항 패턴 인제스트.

Source: backend/app/agents/_doc_knowledge/<subtype>/risks.md (v0.7.0 복사본)
Target: public.pattern_contract_knowledge_chunks

청킹 전략:
    '### 패턴 N:' 블록 단위로 1청크 (위험 조항 1개 = 1청크).

전용 컬럼:
    risk_level    — 'High' | 'Mid' | 'Low' (pre-filter 용)
    pattern_name  — 패턴 이름 (예: "포괄임금제 과도 적용 조항")
    contract_type — 계약서 서브타입 (category 와 동일)

멱등성: source + chunk_index unique 기반 upsert (on_conflict).

사용법:
    cd backend
    python scripts/ingest_contract_risks.py                      # 전체
    python scripts/ingest_contract_risks.py --subtype labor      # labor 만
    python scripts/ingest_contract_risks.py --reset              # 전체 삭제 후 재수집
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.embedder import embed_batch, embed_text  # noqa: E402
from app.core.supabase import get_supabase  # noqa: E402

_TABLE = "pattern_contract_knowledge_chunks"
_KNOWLEDGE_ROOT = Path(__file__).resolve().parent.parent / "app" / "agents" / "_doc_knowledge"

_VALID_SUBTYPES = ("labor", "lease", "service", "supply", "partnership", "franchise", "nda")

_RISK_LEVEL_RE = re.compile(
    r"(?:risk[_\s]?level|위험도|위험\s*등급)\*{0,2}\s*[:：]\s*(High|Mid|Low|높음|중간|낮음)",
    re.IGNORECASE,
)
_PATTERN_HEADER = re.compile(r"^#{1,4}\s*패턴\s*\d+\s*[:：]?\s*(.+)$", re.MULTILINE)


def _normalize_risk_level(raw: str) -> str | None:
    mapping = {"높음": "High", "중간": "Mid", "낮음": "Low"}
    normalized = mapping.get(raw.strip(), raw.strip().capitalize())
    if "-" in normalized or "/" in normalized:
        return "High" if "high" in normalized.lower() else "Mid"
    return normalized if normalized in ("High", "Mid", "Low") else None


def _extract_risk_level(text: str) -> str | None:
    m = _RISK_LEVEL_RE.search(text)
    if not m:
        return None
    return _normalize_risk_level(m.group(1))


def _chunk_by_pattern(content: str) -> list[dict]:
    matches = list(_PATTERN_HEADER.finditer(content))
    if not matches:
        return [{"pattern_name": "전체", "content": content.strip()}]
    chunks: list[dict] = []
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        chunks.append({"pattern_name": m.group(1).strip(), "content": content[start:end].strip()})
    return chunks


def _build_chunks_for_subtype(subtype: str) -> list[dict]:
    md_path = _KNOWLEDGE_ROOT / subtype / "risks.md"
    if not md_path.is_file():
        print(f"  [{subtype}] risks.md 없음 — skip")
        return []
    text = md_path.read_text(encoding="utf-8")
    raw_chunks = _chunk_by_pattern(text)
    out: list[dict] = []
    for idx, rc in enumerate(raw_chunks):
        out.append({
            "source":        f"{subtype}/risks.md",
            "category":      subtype,
            "contract_type": subtype,
            "chunk_index":   idx,
            "risk_level":    _extract_risk_level(rc["content"]),
            "pattern_name":  rc["pattern_name"][:200],
            "content":       rc["content"],
            "metadata": {
                "pattern_name": rc["pattern_name"],
                "category":     subtype,
                "source_file":  str(md_path.relative_to(_KNOWLEDGE_ROOT.parent.parent.parent)),
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
            print(f"[오류] 임베딩 실패 (batch {i}), skip: {exc}")
            continue
        rows = [
            {
                "source":        c["source"],
                "category":      c["category"],
                "contract_type": c["contract_type"],
                "chunk_index":   c["chunk_index"],
                "risk_level":    c["risk_level"],
                "pattern_name":  c["pattern_name"],
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
    ap.add_argument("--subtype", choices=_VALID_SUBTYPES, default=None,
                    help="특정 subtype 만 인제스트")
    ap.add_argument("--reset", action="store_true",
                    help="기존 데이터 삭제 후 재수집")
    args = ap.parse_args()

    subtypes = [args.subtype] if args.subtype else list(_VALID_SUBTYPES)

    sb = get_supabase()
    if args.reset:
        for s in subtypes:
            src = f"{s}/risks.md"
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
