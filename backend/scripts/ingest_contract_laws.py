"""법령 조문 인제스트 — 법제처 Open API 기반.

Target: public.law_contract_knowledge_chunks

대상 법령 (7종):
    근로기준법 / 최저임금법 / 상가건물 임대차보호법 / 주택임대차보호법 /
    하도급거래 공정화에 관한 법률 / 약관의 규제에 관한 법률 / 민법(계약편 527~733조)

청킹: 2단계 계층
    - article 청크  : 조문 전체 (parent, parent_doc_id=null)
    - paragraph 청크: 항 단위 (children, parent_doc_id=article.id)

멱등성: source(=법령명) 기준 전체 삭제 후 재삽입.

사용법:
    cd backend
    python scripts/ingest_contract_laws.py
    python scripts/ingest_contract_laws.py --law 근로기준법
    python scripts/ingest_contract_laws.py --reset
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.embedder import embed_batch, embed_text  # noqa: E402
from app.core.supabase import get_supabase  # noqa: E402

_BASE_URL = "https://www.law.go.kr/DRF"
_OC = "kimjaehyun9605"
_TABLE = "law_contract_knowledge_chunks"

TARGET_LAWS = [
    {"name": "근로기준법",                      "category": "labor",   "topic": "labor_standard"},
    {"name": "최저임금법",                      "category": "labor",   "topic": "minimum_wage"},
    {"name": "상가건물 임대차보호법",            "category": "lease",   "topic": "commercial_lease"},
    {"name": "주택임대차보호법",                "category": "lease",   "topic": "residential_lease"},
    {"name": "하도급거래 공정화에 관한 법률",    "category": "supply",  "topic": "subcontract_fair"},
    {"name": "약관의 규제에 관한 법률",          "category": "service", "topic": "standard_terms"},
    {"name": "민법",                            "category": "civil",   "topic": "civil_contract"},
]

_MINBEOP_ARTICLE_RANGE = range(527, 734)


def _to_str(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(_to_str(v) for v in value)
    if isinstance(value, dict):
        return " ".join(_to_str(v) for v in value.values())
    return str(value)


def _build_hang_content(hang: dict) -> str:
    hang_text = _to_str(hang.get("항내용") or hang.get("조문내용", ""))
    parts = [hang_text]
    ho_list = hang.get("호", [])
    if isinstance(ho_list, dict):
        ho_list = [ho_list]
    for ho in ho_list:
        ho_text = _to_str(ho.get("호내용", ""))
        if ho_text:
            parts.append(f"  {ho_text}")
        mok_list = ho.get("목", [])
        if isinstance(mok_list, dict):
            mok_list = [mok_list]
        for mok in mok_list:
            mok_text = _to_str(mok.get("목내용", ""))
            if mok_text:
                parts.append(f"    {mok_text}")
    return "\n".join(p for p in parts if p)


def _search_lsi_seq(name: str, client: httpx.Client) -> str | None:
    try:
        resp = client.get(
            f"{_BASE_URL}/lawSearch.do",
            params={"OC": _OC, "target": "law", "type": "JSON", "query": name, "display": 1, "page": 1},
            timeout=20.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"[오류] 법령 검색 실패 ({name}): {exc}")
        return None
    search = data.get("LawSearch", {})
    law = search.get("law") or search.get("법령")
    if not law:
        return None
    if isinstance(law, list):
        law = law[0]
    return law.get("법령일련번호") or law.get("lsiSeq")


def _fetch_articles(lsi_seq: str, client: httpx.Client) -> list[dict]:
    try:
        resp = client.get(
            f"{_BASE_URL}/lawService.do",
            params={"OC": _OC, "target": "law", "type": "JSON", "MST": lsi_seq},
            timeout=20.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"[오류] 조문 수집 실패 (lsiSeq={lsi_seq}): {exc}")
        return []
    law_data = data.get("법령", {})
    units = law_data.get("조문", {}).get("조문단위", [])
    if isinstance(units, dict):
        units = [units]
    return units


def _parse_article_hierarchical(unit: dict, target: dict, lsi_seq: str) -> list[dict]:
    if unit.get("조문여부") != "조문":
        return []
    jo_no = unit.get("조문번호", "")
    if not jo_no or not str(jo_no).isdigit():
        return []

    law_name = target["name"]
    if law_name == "민법":
        try:
            article_int = int(jo_no)
        except (TypeError, ValueError):
            return []
        if article_int not in _MINBEOP_ARTICLE_RANGE:
            return []

    jo_title = unit.get("조문제목", "")
    jo_key = unit.get("조문키", jo_no)
    article_name = f"제{int(jo_no)}조"
    article_label = f"{article_name}({jo_title})" if jo_title else article_name
    article_key = f"{law_name}-{jo_key}"

    hang_list = unit.get("항", [])
    if isinstance(hang_list, dict):
        hang_list = [hang_list]

    base_meta = {
        "law_name":      law_name,
        "article":       article_name,
        "article_title": jo_title,
        "topic":         target["topic"],
        "lsi_seq":       lsi_seq,
        "category":      target["category"],
    }

    chunks: list[dict] = []

    if not hang_list:
        chunks.append({
            "article_key": article_key,
            "source": law_name,
            "chunk_type": "article",
            "paragraph_no": None,
            "paragraph_char": None,
            "content": article_label,
            "metadata": {**base_meta, "chunk_type": "article"},
        })
        return chunks

    all_hang_texts = [_build_hang_content(h) for h in hang_list]
    article_content = f"[{law_name} {article_label}]\n\n" + "\n\n".join(all_hang_texts)
    chunks.append({
        "article_key": article_key,
        "source": law_name,
        "chunk_type": "article",
        "paragraph_no": None,
        "paragraph_char": None,
        "content": article_content.strip(),
        "metadata": {**base_meta, "chunk_type": "article"},
    })

    for idx, hang in enumerate(hang_list, 1):
        hang_char = hang.get("항번호", "①")
        hang_text = _build_hang_content(hang)
        if not hang_text.strip():
            continue
        content = f"[{law_name} {article_label} {hang_char}]\n{hang_text}"
        chunks.append({
            "article_key": article_key,
            "source": law_name,
            "chunk_type": "paragraph",
            "paragraph_no": idx,
            "paragraph_char": hang_char,
            "content": content.strip(),
            "metadata": {
                **base_meta,
                "chunk_type": "paragraph",
                "paragraph_no": idx,
                "paragraph_char": hang_char,
            },
        })

    return chunks


def _fetch_law_chunks(target: dict) -> list[dict]:
    law_name = target["name"]
    print(f"  [{law_name}] 법령일련번호 조회 중...")
    with httpx.Client() as client:
        lsi_seq = _search_lsi_seq(law_name, client)
        if not lsi_seq:
            print(f"  [{law_name}] 일련번호 없음 — skip")
            return []
        time.sleep(0.3)
        print(f"  [{law_name}] 조문 수집 중 (lsiSeq={lsi_seq})...")
        units = _fetch_articles(lsi_seq, client)
    if not units:
        print(f"  [{law_name}] 조문 없음 — skip")
        return []

    chunks: list[dict] = []
    for unit in units:
        try:
            parsed = _parse_article_hierarchical(unit, target, lsi_seq)
        except Exception as exc:
            print(f"  [{law_name}] 조문 파싱 실패: {exc}")
            continue
        chunks.extend(parsed)

    arts = sum(1 for c in chunks if c["chunk_type"] == "article")
    paras = sum(1 for c in chunks if c["chunk_type"] == "paragraph")
    print(f"  [{law_name}] → article {arts}개 + paragraph {paras}개 준비")
    return chunks


def _save_chunks(chunks: list[dict], category: str, batch_size: int = 8) -> int:
    sb = get_supabase()
    articles = [c for c in chunks if c["chunk_type"] == "article"]
    paragraphs = [c for c in chunks if c["chunk_type"] == "paragraph"]

    if chunks:
        source = chunks[0]["source"]
        print(f"  [{source}] 기존 데이터 삭제 중...")
        sb.table(_TABLE).delete().eq("source", source).execute()

    article_key_to_id: dict[str, int] = {}

    for i in range(0, len(articles), batch_size):
        batch = articles[i : i + batch_size]
        texts = [c["content"] for c in batch]
        try:
            vectors = embed_batch(texts)
        except Exception as exc:
            print(f"[오류] article 임베딩 실패 (batch {i}): {exc}")
            continue
        rows = [
            {
                "source": c["source"],
                "category": category,
                "chunk_index": i + j,
                "chunk_type": "article",
                "paragraph_no": None,
                "paragraph_char": None,
                "parent_doc_id": None,
                "content": c["content"],
                "embedding": v,
                "metadata": c["metadata"],
            }
            for j, (c, v) in enumerate(zip(batch, vectors))
        ]
        try:
            result = sb.table(_TABLE).insert(rows).execute()
            for j, row_data in enumerate(result.data or []):
                article_key_to_id[batch[j]["article_key"]] = row_data["id"]
            print(f"  [{batch[0]['source']}] article {len(article_key_to_id)}개 저장")
        except Exception as exc:
            print(f"[오류] article DB 저장 실패 (batch {i}): {exc}")

    para_saved = 0
    para_offset = len(articles)

    for i in range(0, len(paragraphs), batch_size):
        batch = paragraphs[i : i + batch_size]
        texts = [c["content"] for c in batch]
        try:
            vectors = embed_batch(texts)
        except Exception as exc:
            print(f"[오류] paragraph 임베딩 실패 (batch {i}): {exc}")
            continue
        rows = [
            {
                "source": c["source"],
                "category": category,
                "chunk_index": para_offset + i + j,
                "chunk_type": "paragraph",
                "paragraph_no": c["paragraph_no"],
                "paragraph_char": c["paragraph_char"],
                "parent_doc_id": article_key_to_id.get(c["article_key"]),
                "content": c["content"],
                "embedding": v,
                "metadata": c["metadata"],
            }
            for j, (c, v) in enumerate(zip(batch, vectors))
        ]
        try:
            sb.table(_TABLE).insert(rows).execute()
            para_saved += len(rows)
            print(f"  [{batch[0]['source']}] paragraph {para_saved}개 저장")
        except Exception as exc:
            print(f"[오류] paragraph DB 저장 실패 (batch {i}): {exc}")

    return len(article_key_to_id) + para_saved


def main() -> None:
    names = [t["name"] for t in TARGET_LAWS]
    ap = argparse.ArgumentParser()
    ap.add_argument("--law", choices=names, default=None, metavar="LAW_NAME")
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    targets = [t for t in TARGET_LAWS if t["name"] == args.law] if args.law else TARGET_LAWS

    sb = get_supabase()
    if args.reset:
        for t in targets:
            print(f"[reset] {_TABLE} — '{t['name']}'")
            sb.table(_TABLE).delete().eq("source", t["name"]).execute()

    print(f"\n수집 대상: {len(targets)}개 법령 → {_TABLE}")
    print("[warmup] BAAI/bge-m3 모델 로딩...")
    embed_text("warmup")

    total = 0
    for target in targets:
        print(f"\n[{target['name']}] 수집 시작")
        chunks = _fetch_law_chunks(target)
        if not chunks:
            continue
        saved = _save_chunks(chunks, category=target["category"])
        total += saved
        print(f"[{target['name']}] saved {saved} chunks")
        time.sleep(0.5)

    print(f"\n수집 완료: 총 {total} 청크")


if __name__ == "__main__":
    main()
