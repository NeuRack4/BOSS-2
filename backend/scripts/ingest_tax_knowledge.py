"""세무 자문 RAG 인제스트 — tax_knowledge_chunks (034 마이그레이션).

3축 데이터:
    statute : 세법 조문        — law.go.kr DRF API
    ruling  : 국세청 예규·고시 — taxlaw.nts.go.kr
    case    : 조세심판원 심판례 — ttax.go.kr

사용법:
    cd backend
    python scripts/ingest_tax_knowledge.py                      # 전체
    python scripts/ingest_tax_knowledge.py --source statute     # 세법 조문만
    python scripts/ingest_tax_knowledge.py --source ruling      # 예규·고시만
    python scripts/ingest_tax_knowledge.py --source case        # 심판례만
    python scripts/ingest_tax_knowledge.py --law 부가가치세법   # 특정 법령만
    python scripts/ingest_tax_knowledge.py --reset              # 전체 삭제 후 재수집
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from html.parser import HTMLParser
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.embedder import embed_batch, embed_text  # noqa: E402
from app.core.supabase import get_supabase  # noqa: E402

_TABLE = "tax_knowledge_chunks"

# ============================================================
# 세법 조문 (statute) — law.go.kr DRF API
# ============================================================

_LAW_BASE_URL = "https://www.law.go.kr/DRF"
_LAW_OC = "kimjaehyun9605"

TARGET_STATUTES: list[dict] = [
    {"name": "부가가치세법",              "tax_category": "vat"},
    {"name": "부가가치세법 시행령",        "tax_category": "vat"},
    {"name": "소득세법",                  "tax_category": "income_tax"},
    {"name": "소득세법 시행령",            "tax_category": "income_tax"},
    {"name": "법인세법",                  "tax_category": "corporate_tax"},
    {"name": "법인세법 시행령",            "tax_category": "corporate_tax"},
    {"name": "국세기본법",                "tax_category": "national_tax_basic"},
    {"name": "국세기본법 시행령",          "tax_category": "national_tax_basic"},
    {"name": "조세특례제한법",             "tax_category": "special_tax"},
    {"name": "지방세법",                  "tax_category": "local_tax"},
    {"name": "지방세기본법",              "tax_category": "local_tax"},
    {"name": "상속세 및 증여세법",         "tax_category": "inheritance_tax"},
    {"name": "국세징수법",                "tax_category": "national_tax_basic"},
    {"name": "세금계산서 발급·수취에 관한 특례규정", "tax_category": "vat"},
]

# 예규·심판 수집 키워드 (세목별로 나눠 검색)
RULING_KEYWORDS = [
    ("부가가치세", "vat"),
    ("소득세", "income_tax"),
    ("법인세", "corporate_tax"),
    ("원천세", "income_tax"),
    ("국세기본", "national_tax_basic"),
    ("가산세", "national_tax_basic"),
    ("세금계산서", "vat"),
    ("조세특례", "special_tax"),
    ("근로소득", "income_tax"),
    ("사업소득", "income_tax"),
    ("양도소득", "income_tax"),
    ("상속세", "inheritance_tax"),
    ("증여세", "inheritance_tax"),
    ("지방세", "local_tax"),
]

CASE_KEYWORDS = RULING_KEYWORDS  # 심판례도 동일 키워드로 검색


# ─── law.go.kr 유틸 ───────────────────────────────────────────

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
            f"{_LAW_BASE_URL}/lawSearch.do",
            params={"OC": _LAW_OC, "target": "law", "type": "JSON", "query": name, "display": 1, "page": 1},
            timeout=20.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"  [오류] 법령 검색 실패 ({name}): {exc}")
        return None
    search = data.get("LawSearch", {})
    law = search.get("law") or search.get("법령")
    if not law:
        return None
    if isinstance(law, list):
        law = law[0]
    return law.get("법령일련번호") or law.get("lsiSeq")


def _fetch_law_articles(lsi_seq: str, client: httpx.Client) -> list[dict]:
    try:
        resp = client.get(
            f"{_LAW_BASE_URL}/lawService.do",
            params={"OC": _LAW_OC, "target": "law", "type": "JSON", "MST": lsi_seq},
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"  [오류] 조문 수집 실패 (lsiSeq={lsi_seq}): {exc}")
        return []
    law_data = data.get("법령", {})
    units = law_data.get("조문", {}).get("조문단위", [])
    if isinstance(units, dict):
        units = [units]
    return units


def _parse_statute_unit(unit: dict, target: dict, lsi_seq: str) -> list[dict]:
    if unit.get("조문여부") != "조문":
        return []
    jo_no = unit.get("조문번호", "")
    if not jo_no or not str(jo_no).isdigit():
        return []

    law_name = target["name"]
    jo_title = unit.get("조문제목", "")
    article_name = f"제{int(jo_no)}조"
    article_label = f"{article_name}({jo_title})" if jo_title else article_name

    hang_list = unit.get("항", [])
    if isinstance(hang_list, dict):
        hang_list = [hang_list]

    base_meta = {
        "law_name":     law_name,
        "article":      article_name,
        "article_title": jo_title,
        "lsi_seq":      lsi_seq,
        "source_type":  "statute",
        "tax_category": target["tax_category"],
    }

    chunks: list[dict] = []

    if not hang_list:
        chunks.append({
            "article_key":   f"{law_name}-{article_name}",
            "source":        law_name,
            "chunk_type":    "article",
            "article_no":    article_name,
            "article_title": jo_title,
            "paragraph_no":  None,
            "paragraph_char": None,
            "content":       article_label,
            "metadata":      {**base_meta, "chunk_type": "article"},
        })
        return chunks

    all_hang_texts = [_build_hang_content(h) for h in hang_list]
    article_content = f"[{law_name} {article_label}]\n\n" + "\n\n".join(all_hang_texts)
    chunks.append({
        "article_key":   f"{law_name}-{article_name}",
        "source":        law_name,
        "chunk_type":    "article",
        "article_no":    article_name,
        "article_title": jo_title,
        "paragraph_no":  None,
        "paragraph_char": None,
        "content":       article_content.strip(),
        "metadata":      {**base_meta, "chunk_type": "article"},
    })

    for idx, hang in enumerate(hang_list, 1):
        hang_char = hang.get("항번호", "①")
        hang_text = _build_hang_content(hang)
        if not hang_text.strip():
            continue
        content = f"[{law_name} {article_label} {hang_char}]\n{hang_text}"
        chunks.append({
            "article_key":   f"{law_name}-{article_name}",
            "source":        law_name,
            "chunk_type":    "paragraph",
            "article_no":    article_name,
            "article_title": jo_title,
            "paragraph_no":  idx,
            "paragraph_char": hang_char,
            "content":       content.strip(),
            "metadata": {
                **base_meta,
                "chunk_type":     "paragraph",
                "paragraph_no":   idx,
                "paragraph_char": hang_char,
            },
        })
    return chunks


def fetch_statute_chunks(target: dict) -> list[dict]:
    law_name = target["name"]
    print(f"  [{law_name}] 법령일련번호 조회 중...")
    with httpx.Client() as client:
        lsi_seq = _search_lsi_seq(law_name, client)
        if not lsi_seq:
            print(f"  [{law_name}] 일련번호 없음 — skip")
            return []
        time.sleep(0.3)
        print(f"  [{law_name}] 조문 수집 중 (lsiSeq={lsi_seq})...")
        units = _fetch_law_articles(lsi_seq, client)
    if not units:
        return []

    chunks: list[dict] = []
    for unit in units:
        try:
            chunks.extend(_parse_statute_unit(unit, target, lsi_seq))
        except Exception as exc:
            print(f"  [{law_name}] 조문 파싱 실패: {exc}")

    arts = sum(1 for c in chunks if c["chunk_type"] == "article")
    paras = sum(1 for c in chunks if c["chunk_type"] == "paragraph")
    print(f"  [{law_name}] → article {arts}개 + paragraph {paras}개 준비")
    return chunks


# ─── HTML 파서 유틸 ─────────────────────────────────────────────

class _TextExtractor(HTMLParser):
    """HTML에서 텍스트만 추출하는 간단한 파서."""

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip_tags = {"script", "style", "head", "nav", "footer", "header"}
        self._current_skip = 0

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self._skip_tags:
            self._current_skip += 1

    def handle_endtag(self, tag):
        if tag.lower() in self._skip_tags and self._current_skip > 0:
            self._current_skip -= 1

    def handle_data(self, data):
        if self._current_skip == 0:
            text = data.strip()
            if text:
                self._parts.append(text)

    def get_text(self) -> str:
        return " ".join(self._parts)


def _html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return parser.get_text()


# ─── 국세청 예규·고시 (ruling) — taxlaw.nts.go.kr ─────────────

_NTS_BASE = "https://taxlaw.nts.go.kr"
_NTS_LIST_URL = f"{_NTS_BASE}/service/taxlaw/lw/gnrlzInfo/gnrlzInfoList.do"
_NTS_DETAIL_URL = f"{_NTS_BASE}/service/taxlaw/lw/gnrlzInfo/gnrlzInfoView.do"
_NTS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Referer": _NTS_BASE,
    "X-Requested-With": "XMLHttpRequest",
}


def _nts_list_page(keyword: str, page: int, client: httpx.Client) -> list[dict]:
    """NTS 세법령정보시스템에서 예규 목록 한 페이지 수집."""
    params = {
        "searchGbn": "1",
        "pageIndex": str(page),
        "rowSize": "20",
        "searchKey": keyword,
    }
    try:
        resp = client.get(_NTS_LIST_URL, params=params, headers=_NTS_HEADERS, timeout=20.0)
        resp.raise_for_status()
        data = resp.json()
        items = data.get("list") or data.get("data") or data.get("result") or []
        if isinstance(items, list):
            return items
        # 응답 구조가 다를 경우 탐색
        for key in data:
            if isinstance(data[key], list) and data[key]:
                return data[key]
        return []
    except Exception as exc:
        print(f"    [NTS 목록] 실패 (keyword={keyword}, page={page}): {exc}")
        return []


def _nts_detail(item: dict, client: httpx.Client) -> str:
    """예규 상세 내용 수집."""
    doc_id = (
        item.get("prcsArtcNo") or item.get("gnrlzInfoNo") or
        item.get("id") or item.get("seqNo") or ""
    )
    if not doc_id:
        content_field = item.get("ctnt") or item.get("content") or item.get("bfnClsfCntn") or ""
        return _html_to_text(str(content_field)) if content_field else ""
    try:
        resp = client.get(
            _NTS_DETAIL_URL,
            params={"prcsArtcNo": doc_id},
            headers=_NTS_HEADERS,
            timeout=20.0,
        )
        resp.raise_for_status()
        data = resp.json()
        detail = data.get("info") or data.get("detail") or data.get("data") or {}
        if isinstance(detail, dict):
            content = (
                detail.get("ctnt") or detail.get("content") or
                detail.get("bfnClsfCntn") or detail.get("decsnCtnt") or ""
            )
            return _html_to_text(str(content)) if content else ""
        return ""
    except Exception:
        return ""


def _chunk_ruling_text(source: str, tax_category: str, title: str, content: str) -> list[dict]:
    """예규/고시 본문을 섹션 단위로 청킹."""
    if not content or len(content.strip()) < 40:
        return []

    # 섹션 분리 패턴: "【질의】", "【답변】", "요지", "사실관계", "관련법령" 등
    section_pattern = re.compile(
        r"(?:【[^】]+】|[가-힣]+\s*:\s*(?=\S)|\d+\.\s*(?=[가-힣]))"
    )
    sections: list[tuple[str, str]] = []
    parts = section_pattern.split(content)
    headers = [m.group() for m in section_pattern.finditer(content)]

    if len(parts) > 1 and headers:
        sections.append(("전문", parts[0].strip()))
        for hdr, body in zip(headers, parts[1:]):
            sections.append((hdr.strip(), body.strip()))
    else:
        # 분리 실패 시 500자 슬라이딩 윈도우
        text = content.strip()
        window, overlap = 500, 100
        for i, start in enumerate(range(0, len(text), window - overlap)):
            chunk = text[start:start + window]
            if len(chunk.strip()) >= 40:
                sections.append((f"구간{i+1}", chunk))

    chunks: list[dict] = []
    for idx, (sec_name, sec_body) in enumerate(sections):
        if not sec_body or len(sec_body.strip()) < 20:
            continue
        text = f"[{source}] {title}\n[{sec_name}]\n{sec_body}".strip()
        chunks.append({
            "source":        source,
            "chunk_type":    "section",
            "article_no":    sec_name[:50],
            "article_title": title[:100],
            "paragraph_no":  idx + 1,
            "paragraph_char": None,
            "content":       text[:2000],
            "metadata": {
                "source_type":   "ruling",
                "tax_category":  tax_category,
                "title":         title,
                "section":       sec_name,
                "chunk_type":    "section",
            },
        })
    return chunks


def fetch_ruling_chunks(keyword: str, tax_category: str, max_pages: int = 10) -> list[dict]:
    """국세청 세법령정보시스템에서 예규·고시 수집."""
    print(f"  [예규·고시] 키워드='{keyword}' 수집 중...")
    all_chunks: list[dict] = []
    seen_sources: set[str] = set()

    with httpx.Client(follow_redirects=True) as client:
        for page in range(1, max_pages + 1):
            items = _nts_list_page(keyword, page, client)
            if not items:
                break

            for item in items:
                ruling_no = (
                    item.get("prcsArtcNo") or item.get("gnrlzInfoNo") or
                    item.get("no") or item.get("seqNo") or ""
                )
                title = (
                    item.get("ttl") or item.get("title") or
                    item.get("gnrlzInfoNm") or item.get("subj") or "예규"
                )
                source = f"국세청예규 {ruling_no}" if ruling_no else f"국세청예규 {keyword}-{page}-{items.index(item)}"

                if source in seen_sources:
                    continue
                seen_sources.add(source)

                content = _nts_detail(item, client) if ruling_no else ""
                if not content:
                    raw = (
                        item.get("ctnt") or item.get("content") or
                        item.get("bfnClsfCntn") or ""
                    )
                    content = _html_to_text(str(raw)) if raw else ""

                chunks = _chunk_ruling_text(source, tax_category, str(title), content)
                all_chunks.extend(chunks)
                time.sleep(0.1)

            print(f"    page {page}: {len(items)}건 → 누적 청크 {len(all_chunks)}개")
            if len(items) < 20:
                break
            time.sleep(0.3)

    print(f"  [예규·고시 '{keyword}'] → {len(all_chunks)} 청크")
    return all_chunks


# ─── 조세심판원 심판결정례 (case) — ttax.go.kr ────────────────

_TTAX_BASE = "https://www.ttax.go.kr"
_TTAX_SEARCH_URL = f"{_TTAX_BASE}/bizr/search/SearchController.do"
_TTAX_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Referer": _TTAX_BASE,
    "X-Requested-With": "XMLHttpRequest",
}


def _ttax_search_page(keyword: str, page: int, client: httpx.Client) -> list[dict]:
    """조세심판원 심판결정례 목록 수집."""
    params = {
        "cmd": "srchDecision",
        "searchType": "01",
        "keyword": keyword,
        "pageIndex": str(page),
        "pageUnit": "20",
    }
    try:
        resp = client.get(_TTAX_SEARCH_URL, params=params, headers=_TTAX_HEADERS, timeout=20.0)
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "")
        if "json" in ct:
            data = resp.json()
            items = (
                data.get("list") or data.get("decsnList") or
                data.get("data") or data.get("result") or []
            )
            return items if isinstance(items, list) else []
        # HTML 응답 — JSON 블록 추출 시도
        text = resp.text
        match = re.search(r'"list"\s*:\s*(\[.*?\])', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except Exception:
                pass
        return []
    except Exception as exc:
        print(f"    [심판례] 실패 (keyword={keyword}, page={page}): {exc}")
        return []


def _ttax_detail_text(item: dict, client: httpx.Client) -> str:
    """심판결정례 본문 추출."""
    # 항목에 본문 필드가 있으면 바로 사용
    for field in ("decsnCtnt", "content", "ctnt", "fullText", "mainText"):
        raw = item.get(field)
        if raw and len(str(raw).strip()) > 50:
            return _html_to_text(str(raw))

    # 상세 URL이 있으면 fetch
    detail_url = item.get("detailUrl") or item.get("viewUrl") or ""
    if not detail_url:
        case_no = item.get("decsnNo") or item.get("caseNo") or ""
        if case_no:
            detail_url = f"{_TTAX_SEARCH_URL}?cmd=viewDecision&decsnNo={case_no}"
    if not detail_url:
        return ""

    try:
        resp = client.get(detail_url, headers=_TTAX_HEADERS, timeout=20.0)
        resp.raise_for_status()
        ct = resp.headers.get("content-type", "")
        if "json" in ct:
            data = resp.json()
            for field in ("decsnCtnt", "content", "ctnt", "fullText"):
                raw = data.get(field) or (data.get("info") or {}).get(field) or ""
                if raw:
                    return _html_to_text(str(raw))
        return _html_to_text(resp.text)[:3000]
    except Exception:
        return ""


def _chunk_case_text(source: str, tax_category: str, title: str, content: str) -> list[dict]:
    """심판결정례 본문을 섹션 단위로 청킹."""
    if not content or len(content.strip()) < 40:
        # 내용이 없어도 제목+요지 정도는 저장
        if title and len(title.strip()) >= 20:
            return [{
                "source":        source,
                "chunk_type":    "section",
                "article_no":    "제목",
                "article_title": title[:100],
                "paragraph_no":  1,
                "paragraph_char": None,
                "content":       f"[{source}] {title}".strip(),
                "metadata": {
                    "source_type":   "case",
                    "tax_category":  tax_category,
                    "title":         title,
                    "section":       "제목",
                    "chunk_type":    "section",
                },
            }]
        return []

    # 심판결정례 표준 섹션 분리
    section_pattern = re.compile(
        r"(?:주\s*문|청\s*구\s*취\s*지|이\s*유|결\s*정\s*요\s*지|사\s*실\s*관\s*계|"
        r"청구인\s*주장|처분청\s*의견|쟁\s*점|관련\s*법령|관련\s*사실|심리\s*및\s*판단|"
        r"\d+\.\s*(?=[가-힣]))"
    )
    parts = section_pattern.split(content)
    headers = [m.group().strip() for m in section_pattern.finditer(content)]

    sections: list[tuple[str, str]] = []
    sections.append(("전문", parts[0].strip()))
    if headers:
        for hdr, body in zip(headers, parts[1:]):
            sections.append((hdr, body.strip()))

    chunks: list[dict] = []
    for idx, (sec_name, sec_body) in enumerate(sections):
        if not sec_body or len(sec_body.strip()) < 20:
            continue
        text = f"[{source}] {title}\n[{sec_name}]\n{sec_body}".strip()
        chunks.append({
            "source":        source,
            "chunk_type":    "section",
            "article_no":    sec_name[:50],
            "article_title": title[:100],
            "paragraph_no":  idx + 1,
            "paragraph_char": None,
            "content":       text[:2000],
            "metadata": {
                "source_type":   "case",
                "tax_category":  tax_category,
                "title":         title,
                "section":       sec_name,
                "chunk_type":    "section",
            },
        })
    return chunks


def fetch_case_chunks(keyword: str, tax_category: str, max_pages: int = 10) -> list[dict]:
    """조세심판원 심판결정례 수집."""
    print(f"  [심판례] 키워드='{keyword}' 수집 중...")
    all_chunks: list[dict] = []
    seen_sources: set[str] = set()

    with httpx.Client(follow_redirects=True) as client:
        for page in range(1, max_pages + 1):
            items = _ttax_search_page(keyword, page, client)
            if not items:
                break

            for item in items:
                case_no = (
                    item.get("decsnNo") or item.get("caseNo") or
                    item.get("no") or item.get("seqNo") or ""
                )
                title = (
                    item.get("ttl") or item.get("title") or
                    item.get("decsnTtl") or item.get("subj") or "심판결정례"
                )
                source = f"조세심판 {case_no}" if case_no else f"조세심판 {keyword}-{page}-{items.index(item)}"

                if source in seen_sources:
                    continue
                seen_sources.add(source)

                content = _ttax_detail_text(item, client)
                chunks = _chunk_case_text(source, tax_category, str(title), content)
                all_chunks.extend(chunks)
                time.sleep(0.1)

            print(f"    page {page}: {len(items)}건 → 누적 청크 {len(all_chunks)}개")
            if len(items) < 20:
                break
            time.sleep(0.3)

    print(f"  [심판례 '{keyword}'] → {len(all_chunks)} 청크")
    return all_chunks


# ─── DB 저장 (공통) ─────────────────────────────────────────────

def _save_chunks(
    chunks: list[dict],
    source_type: str,
    tax_category: str,
    batch_size: int = 8,
) -> int:
    if not chunks:
        return 0
    sb = get_supabase()
    source = chunks[0]["source"]

    print(f"  [{source}] 기존 데이터 삭제 중...")
    sb.table(_TABLE).delete().eq("source", source).execute()

    articles = [c for c in chunks if c["chunk_type"] == "article"]
    non_articles = [c for c in chunks if c["chunk_type"] != "article"]

    article_key_to_id: dict[str, int] = {}

    def _insert_batch(batch: list[dict], offset: int, is_article: bool) -> int:
        texts = [c["content"] for c in batch]
        try:
            vectors = embed_batch(texts)
        except Exception as exc:
            print(f"  [오류] 임베딩 실패 (batch {offset}): {exc}")
            return 0
        rows = []
        for j, (c, v) in enumerate(zip(batch, vectors)):
            row = {
                "source":        c["source"],
                "source_type":   source_type,
                "tax_category":  tax_category,
                "chunk_index":   offset + j,
                "chunk_type":    c["chunk_type"],
                "article_no":    c.get("article_no"),
                "article_title": c.get("article_title"),
                "paragraph_no":  c.get("paragraph_no"),
                "paragraph_char": c.get("paragraph_char"),
                "parent_doc_id": article_key_to_id.get(c.get("article_key", "")) if not is_article else None,
                "content":       c["content"],
                "embedding":     v,
                "metadata":      c.get("metadata", {}),
            }
            rows.append(row)
        try:
            result = sb.table(_TABLE).insert(rows).execute()
            if is_article and result.data:
                for j, row_data in enumerate(result.data):
                    key = batch[j].get("article_key", "")
                    if key:
                        article_key_to_id[key] = row_data["id"]
            return len(result.data or [])
        except Exception as exc:
            print(f"  [오류] DB 저장 실패: {exc}")
            return 0

    saved = 0
    for i in range(0, len(articles), batch_size):
        saved += _insert_batch(articles[i:i + batch_size], i, is_article=True)
    for i in range(0, len(non_articles), batch_size):
        saved += _insert_batch(non_articles[i:i + batch_size], len(articles) + i, is_article=False)

    print(f"  [{source}] saved {saved} chunks")
    return saved


def _save_bulk_chunks(chunks: list[dict], source_type: str, batch_size: int = 8) -> int:
    """source 별로 묶어서 저장 (ruling/case 다수 source 처리용)."""
    if not chunks:
        return 0
    # source 별로 그룹핑
    from collections import defaultdict
    by_source: dict[str, list[dict]] = defaultdict(list)
    for c in chunks:
        by_source[c["source"]].append(c)

    sb = get_supabase()
    # 기존 데이터 일괄 삭제
    for src in by_source:
        try:
            sb.table(_TABLE).delete().eq("source", src).eq("source_type", source_type).execute()
        except Exception:
            pass

    total = 0
    for src, src_chunks in by_source.items():
        tax_cat = (src_chunks[0].get("metadata") or {}).get("tax_category", "other")
        # 배치 임베딩
        texts = [c["content"] for c in src_chunks]
        for i in range(0, len(texts), batch_size):
            batch = src_chunks[i:i + batch_size]
            batch_texts = texts[i:i + batch_size]
            try:
                vectors = embed_batch(batch_texts)
            except Exception as exc:
                print(f"  [오류] 임베딩 실패 ({src}): {exc}")
                continue
            rows = [
                {
                    "source":        c["source"],
                    "source_type":   source_type,
                    "tax_category":  tax_cat,
                    "chunk_index":   i + j,
                    "chunk_type":    c["chunk_type"],
                    "article_no":    c.get("article_no"),
                    "article_title": c.get("article_title"),
                    "paragraph_no":  c.get("paragraph_no"),
                    "paragraph_char": c.get("paragraph_char"),
                    "parent_doc_id": None,
                    "content":       c["content"],
                    "embedding":     v,
                    "metadata":      c.get("metadata", {}),
                }
                for j, (c, v) in enumerate(zip(batch, vectors))
            ]
            try:
                result = sb.table(_TABLE).insert(rows).execute()
                total += len(result.data or [])
            except Exception as exc:
                print(f"  [오류] DB 저장 실패 ({src}): {exc}")

    return total


# ─── 진입점 ─────────────────────────────────────────────────────

def ingest_statutes(law_filter: str | None = None) -> int:
    targets = [t for t in TARGET_STATUTES if t["name"] == law_filter] if law_filter else TARGET_STATUTES
    print(f"\n[statute] {len(targets)}개 법령 수집 시작")

    total = 0
    for target in targets:
        print(f"\n[{target['name']}]")
        chunks = fetch_statute_chunks(target)
        if not chunks:
            continue
        saved = _save_chunks(chunks, "statute", target["tax_category"])
        total += saved
        time.sleep(0.5)

    print(f"\n[statute] 완료: 총 {total} 청크")
    return total


def ingest_rulings() -> int:
    print(f"\n[ruling] {len(RULING_KEYWORDS)}개 키워드 수집 시작")
    total_chunks: list[dict] = []

    for keyword, tax_cat in RULING_KEYWORDS:
        chunks = fetch_ruling_chunks(keyword, tax_cat, max_pages=5)
        total_chunks.extend(chunks)
        time.sleep(1.0)

    print(f"\n[ruling] 임베딩·저장 중 (총 {len(total_chunks)} 청크)...")
    saved = _save_bulk_chunks(total_chunks, "ruling")
    print(f"[ruling] 완료: {saved} 청크 저장")
    return saved


def ingest_cases() -> int:
    print(f"\n[case] {len(CASE_KEYWORDS)}개 키워드 수집 시작")
    total_chunks: list[dict] = []

    for keyword, tax_cat in CASE_KEYWORDS:
        chunks = fetch_case_chunks(keyword, tax_cat, max_pages=5)
        total_chunks.extend(chunks)
        time.sleep(1.0)

    print(f"\n[case] 임베딩·저장 중 (총 {len(total_chunks)} 청크)...")
    saved = _save_bulk_chunks(total_chunks, "case")
    print(f"[case] 완료: {saved} 청크 저장")
    return saved


def main() -> None:
    law_names = [t["name"] for t in TARGET_STATUTES]
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["statute", "ruling", "case", "all"], default="all")
    ap.add_argument("--law", choices=law_names, default=None, metavar="LAW_NAME",
                    help="statute 모드에서 특정 법령만 수집")
    ap.add_argument("--reset", action="store_true", help="대상 데이터 전체 삭제 후 재수집")
    args = ap.parse_args()

    if args.reset:
        sb = get_supabase()
        sources = [args.source] if args.source != "all" else ["statute", "ruling", "case"]
        for src in sources:
            print(f"[reset] {_TABLE} source_type='{src}' 전체 삭제")
            sb.table(_TABLE).delete().eq("source_type", src).execute()

    print("[warmup] BAAI/bge-m3 모델 로딩...")
    embed_text("warmup")

    total = 0
    if args.source in ("statute", "all"):
        total += ingest_statutes(args.law)
    if args.source in ("ruling", "all") and not args.law:
        total += ingest_rulings()
    if args.source in ("case", "all") and not args.law:
        total += ingest_cases()

    print(f"\n수집 완료: 총 {total} 청크")


if __name__ == "__main__":
    main()
