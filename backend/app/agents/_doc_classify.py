"""업로드 문서 자동 분류기.

`classify_document(text, filename)` → ClassificationResult.

카테고리(category) — 라우팅 단위:
  - documents  : 계약서·제안서·견적서·공지문·체크리스트·가이드 (documents 에이전트 대상)
  - receipt    : 영수증·카드전표
  - invoice    : 청구서·인보이스
  - tax        : 세금계산서·현금영수증
  - id         : 신분증·여권·운전면허
  - other      : 그 외 (명함·설문·일반 이미지 등)

doc_type — 사람에게 보여줄 라벨 (예: "계약서", "영수증", "세금계산서").

전략:
  1. 파일명 + 본문 앞 2KB 키워드 점수화로 1차 판정.
  2. 어느 후보도 명확히 높지 않으면 (top_score < THRESHOLD) gpt-4o-mini 에 JSON 분류 fallback.
  3. fallback 도 실패/에러면 category='other' + confidence=0 반환.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, asdict
from typing import Literal

from app.core.llm import client as _openai_client

log = logging.getLogger(__name__)

Category = Literal["documents", "receipt", "invoice", "tax", "id", "other"]

CATEGORY_LABELS: dict[str, str] = {
    "documents": "문서",
    "receipt":   "영수증",
    "invoice":   "청구서",
    "tax":       "세금계산서",
    "id":        "신분증",
    "other":     "기타",
}

# 유저가 직접 고를 수 있는 doc_type → category 매핑
USER_DECLARED_TYPES: dict[str, tuple[Category, str]] = {
    "auto":       ("other",     "자동 분류"),  # sentinel — 실제론 분류기 돌림
    "contract":   ("documents", "계약서"),
    "proposal":   ("documents", "제안서"),
    "estimate":   ("documents", "견적서"),
    "notice":     ("documents", "공지문"),
    "checklist":  ("documents", "체크리스트"),
    "guide":      ("documents", "가이드"),
    "receipt":    ("receipt",   "영수증"),
    "invoice":    ("invoice",   "청구서"),
    "tax":        ("tax",       "세금계산서"),
    "id":         ("id",        "신분증"),
    "other":      ("other",     "기타"),
}


@dataclass
class ClassificationResult:
    category: Category
    doc_type: str       # 사람이 읽는 라벨
    confidence: float   # 0.0 ~ 1.0
    reason: str         # 근거 1줄
    source: str         # "heuristic" | "llm" | "fallback"

    def to_dict(self) -> dict:
        return asdict(self)


# ────────────────────── 키워드 사전 ──────────────────────

# (category, doc_type, patterns) — patterns 는 소문자/원문 혼합 가능
_HEURISTICS: tuple[tuple[Category, str, tuple[str, ...]], ...] = (
    # documents — 계약서
    ("documents", "계약서", (
        "계약서", "계 약 서", "갑과 을", "제1조", "제 1 조", "근로계약", "임대차",
        "용역계약", "공급계약", "비밀유지", "nda",
    )),
    # documents — 제안서
    ("documents", "제안서", ("제안서", "proposal", "제안 범위", "제안내용", "제안금액")),
    # documents — 견적서
    ("documents", "견적서", ("견적서", "견적 금액", "견적가", "유효기간", "공급가액 합계")),
    # documents — 공지문
    ("documents", "공지문", ("공지", "안내문", "안내드립니다", "알려드립니다")),
    # documents — 체크리스트
    ("documents", "체크리스트", ("체크리스트", "점검표", "checklist")),
    # documents — 가이드
    ("documents", "가이드", ("가이드", "매뉴얼", "사용 설명서", "운영 지침")),

    # receipt
    ("receipt", "영수증", (
        "영수증", "receipt", "승인번호", "승인 번호", "카드번호", "일시불",
        "가맹점", "매출전표", "신용카드 매출", "할부 개월",
    )),
    # invoice
    ("invoice", "청구서", (
        "청구서", "invoice", "청구 금액", "결제 예정일", "납부 기한", "청구일",
    )),
    # tax
    ("tax", "세금계산서", (
        "세금계산서", "전자세금계산서", "공급자", "공급받는자", "공급가액",
        "사업자등록번호", "현금영수증", "종목",
    )),
    # id
    ("id", "신분증", (
        "주민등록번호", "주민등록증", "운전면허", "운전면허증", "여권",
        "passport", "생년월일",
    )),
)

# 카테고리별 confidence 산출 임계. top - second 가 이 이상이면 "확신" 으로 간주.
_HEURISTIC_MARGIN = 2    # 매칭 점수 차
_LLM_FALLBACK_SCORE = 2  # top 점수 < 이 값이면 LLM 로 fallback
_FILENAME_WEIGHT = 3     # 파일명 키워드 매칭은 본문 매칭보다 3배 가중


def _score_heuristics(text_sample: str, filename: str) -> list[tuple[Category, str, int, list[str]]]:
    """(category, doc_type, score, matched_keywords) 배열 점수 순 반환.

    파일명 매칭은 _FILENAME_WEIGHT 배 가중 — 파일명이 명확하면 LLM fallback 없이 확정.
    """
    content_hay = text_sample.lower()
    filename_hay = (filename or "").lower()
    rows: list[tuple[Category, str, int, list[str]]] = []
    for cat, dtype, patterns in _HEURISTICS:
        matched: list[str] = []
        score = 0
        for p in patterns:
            pl = p.lower()
            if pl in filename_hay:
                matched.append(p)
                score += _FILENAME_WEIGHT   # 파일명 가중
            elif pl in content_hay:
                matched.append(p)
                score += 1
        if matched:
            rows.append((cat, dtype, score, matched))
    rows.sort(key=lambda r: r[2], reverse=True)
    return rows


async def _llm_classify(text_sample: str, filename: str) -> ClassificationResult | None:
    """휴리스틱이 약할 때만 호출. 실패 시 None."""
    prompt = (
        "다음은 업로드된 문서의 파일명과 본문 앞부분이다.\n"
        "이 문서가 어떤 종류인지 아래 카테고리 중 하나로 분류하라.\n\n"
        "카테고리:\n"
        "- documents: 계약서/제안서/견적서/공지문/체크리스트/가이드 (사업용 문서)\n"
        "- receipt: 영수증/카드전표\n"
        "- invoice: 청구서/인보이스\n"
        "- tax: 세금계산서/현금영수증\n"
        "- id: 신분증/여권/운전면허\n"
        "- other: 그 외\n\n"
        f"파일명: {filename}\n"
        f"본문 앞부분:\n{text_sample[:1500]}\n\n"
        "아래 JSON 스키마로만 응답하라:\n"
        '{"category":"...", "doc_type":"계약서|제안서|...|기타", "confidence":0.0~1.0, "reason":"한 줄 근거"}'
    )
    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "너는 문서 분류기다. JSON 만 출력하라."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
            max_tokens=200,
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
    except Exception:
        log.exception("llm classify failed")
        return None

    cat = data.get("category")
    if cat not in CATEGORY_LABELS:
        return None
    try:
        conf = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
    except (TypeError, ValueError):
        conf = 0.5
    return ClassificationResult(
        category=cat,  # type: ignore[arg-type]
        doc_type=str(data.get("doc_type") or CATEGORY_LABELS[cat])[:40],
        confidence=conf,
        reason=str(data.get("reason") or "")[:200],
        source="llm",
    )


async def classify_document(text: str, filename: str) -> ClassificationResult:
    """업로드 문서 분류 진입점 (async — LLM fallback 때문에)."""
    text_sample = (text or "")[:3000]
    rows = _score_heuristics(text_sample, filename or "")

    if rows:
        top = rows[0]
        second_score = rows[1][2] if len(rows) > 1 else 0
        top_cat, top_type, top_score, matched = top

        # 확신 케이스: top 점수가 충분하고 2nd 와 margin 있음
        if top_score >= _LLM_FALLBACK_SCORE and (top_score - second_score) >= _HEURISTIC_MARGIN:
            conf = min(0.95, 0.55 + 0.1 * top_score)
            return ClassificationResult(
                category=top_cat,
                doc_type=top_type,
                confidence=round(conf, 2),
                reason=f"키워드 {top_score}개 매치: {', '.join(matched[:5])}",
                source="heuristic",
            )

    # 휴리스틱 약함 → LLM fallback
    llm = await _llm_classify(text_sample, filename or "")
    if llm:
        return llm

    # LLM 도 실패 → heuristic top 이 있으면 낮은 confidence 로라도 반환
    if rows:
        top_cat, top_type, top_score, matched = rows[0]
        return ClassificationResult(
            category=top_cat,
            doc_type=top_type,
            confidence=round(min(0.5, 0.25 + 0.05 * top_score), 2),
            reason=f"키워드 약한 매치: {', '.join(matched[:3])}",
            source="heuristic",
        )

    return ClassificationResult(
        category="other",
        doc_type="기타",
        confidence=0.0,
        reason="키워드/LLM 모두 판정 실패",
        source="fallback",
    )


def resolve_user_declared_type(user_declared: str | None) -> tuple[Category, str] | None:
    """프론트에서 유저가 고른 타입 문자열 → (category, doc_type) 정규화.

    'auto' 또는 None/unknown → None (자동 분류 사용 신호).
    """
    if not user_declared or user_declared == "auto":
        return None
    key = user_declared.strip().lower()
    if key in USER_DECLARED_TYPES:
        cat, label = USER_DECLARED_TYPES[key]
        if key == "auto":
            return None
        return (cat, label)
    return None


def detect_conflict(
    auto: ClassificationResult,
    user_declared: tuple[Category, str] | None,
    min_confidence: float = 0.6,
) -> bool:
    """자동 분류와 유저 선언 사이 충돌 감지.

    - 유저가 'auto' 였으면 충돌 없음.
    - 자동 분류 confidence 가 낮으면 유저 선언 신뢰 → 충돌 없음.
    - 둘 다 category 가 다르면 충돌 true.
    """
    if user_declared is None:
        return False
    if auto.confidence < min_confidence:
        return False
    return auto.category != user_declared[0]
