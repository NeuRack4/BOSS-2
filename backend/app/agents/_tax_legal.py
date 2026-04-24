"""세무 자문 핸들러 — 세법·세무 질문에 전용 RAG 기반 조언.

파이프라인:
    1. classify_tax_intent  : 세무 자문 의도 판정 + 세목 분류 (gpt-4o-mini)
    2. retrieve             : 임베딩 → search_tax_knowledge RPC
                               3-way RRF (세법 조문·예규·심판례)
    3. generate_advice      : 세무 전용 시스템 프롬프트 + RAG + annual_values → GPT-4o
    4. save_artifact        : type='tax_advice' → Documents > Tax&HR 서브허브

외부 계약:
    - `search_tax_knowledge` RPC (034 마이그레이션)
    - `legal_annual_values` 테이블 (부가세율·소득세 구간·4대보험 요율 등)
    - `pick_sub_hub_id` 로 Tax&HR 서브허브 선택
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date

from langsmith import traceable

from app.agents._artifact import pick_documents_parent, pick_sub_hub_id, today_context, record_artifact_for_focus
from app.core.embedder import embed_text
from app.core.llm import chat_completion
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)

_CLASSIFY_MODEL = "gpt-4o-mini"
_ADVICE_MODEL   = "gpt-4o"

_CHOICES_RE  = re.compile(r"\[CHOICES\](.*?)\[/CHOICES\]", re.DOTALL)
_YEAR_RE     = re.compile(r"(?<!\d)(20\d{2})(?!\d)")

# 세무 특화 법정 수치 키워드 → legal_annual_values.category 매핑
_TAX_CATEGORY_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("vat_rate", (
        "부가가치세율", "부가세율", "vat율", "vat 율",
    )),
    ("vat_simplified_threshold", (
        "간이과세", "간이과세자", "간이 과세", "간이사업자",
        "일반과세자 기준", "간이과세 한도",
    )),
    ("income_tax_brackets", (
        "종합소득세", "종소세", "소득세 구간", "과세표준", "소득세율",
        "소득세 세율", "누진세율", "종합소득 세율",
    )),
    ("social_insurance_rates", (
        "4대보험", "사대보험", "국민연금", "건강보험", "고용보험", "산재보험",
        "장기요양", "보험료율", "4대보험료", "국민연금율",
    )),
    ("minimum_wage", (
        "최저임금", "최저시급",
    )),
)

VALID_TAX_TOPICS = (
    "vat",               # 부가가치세
    "income_tax",        # 종합소득세 / 근로소득세
    "corporate_tax",     # 법인세
    "withholding_tax",   # 원천세
    "social_insurance",  # 4대보험
    "national_tax_basic", # 국세기본법 (가산세·불복)
    "special_tax",       # 조세특례 (감면·공제)
    "local_tax",         # 지방세
    "inheritance_tax",   # 상속세·증여세
    "other",
)

# search_tax_knowledge 의 filter_tax_category 값 (034 마이그레이션과 동기화)
_TOPIC_TO_TAX_CAT: dict[str, str] = {
    "vat":                "vat",
    "income_tax":         "income_tax",
    "corporate_tax":      "corporate_tax",
    "withholding_tax":    "income_tax",
    "social_insurance":   "other",
    "national_tax_basic": "national_tax_basic",
    "special_tax":        "special_tax",
    "local_tax":          "local_tax",
    "inheritance_tax":    "inheritance_tax",
}

# ────────────────────── 법정 수치 유틸 ──────────────────────
# _legal.py 의 동일 함수와 중복 최소화를 위해 직접 호출이 아닌 import 형태로 사용.

from app.agents._legal import (  # noqa: E402
    _detect_annual_categories as _detect_annual_base,
    _detect_years,
    _fetch_annual_values,
    _format_annual_values_block,
    _strip_legal_footers,
    _clean_history_for_legal,
    DISCLAIMER,
)


def _detect_annual_categories(message: str) -> list[str]:
    """세무 특화 키워드 + 기본 legal 키워드를 합산."""
    base = _detect_annual_base(message)
    if not message:
        return base
    low = message.casefold()
    extra: list[str] = []
    for cat, kws in _TAX_CATEGORY_KEYWORDS:
        if cat not in base:
            for kw in kws:
                if kw.casefold() in low:
                    extra.append(cat)
                    break
    return list(dict.fromkeys(base + extra))  # 순서 유지·중복 제거


# ────────────────────── 1. intent 판정 ──────────────────────

_TAX_CLASSIFY_PROMPT = """당신은 사용자 메시지가 **세무 법률 자문** 의도인지 분류하는 라우터입니다.

**is_tax = true** — 세법·세무 규정에 관한 질문:
- 부가가치세(VAT): 과세/면세/영세율 여부, 세금계산서 발행 의무, 간이과세 기준, 부가세 신고 기한
- 소득세: 과세표준·세율·공제 항목, 사업소득/근로소득/양도소득 구분, 종합소득세 신고 방법
- 법인세: 익금·손금 항목, 세무조정, 결손금 이월, 법인세 신고
- 원천세: 근로소득 원천징수 방법, 원천징수이행상황신고서, 사업소득 3.3% 원천징수
- 4대보험: 부과·납부·신고 규정, 요율 산정 방식, 직장/지역 가입자 구분 (법적 규정 질문)
- 국세기본법: 가산세 종류·계산, 불복 절차(이의신청·심판청구·소송), 부과제척기간, 납세자 권리
- 조세특례: 창업 감면, 고용증대세액공제, 중소기업 특례
- 지방세: 취득세·재산세·지방소득세·주민세 규정
- 상속세·증여세: 세율·공제·신고 의무
- 세금계산서·현금영수증 관련 법적 의무
- 세무 조사 관련 권리와 절차

**is_tax = false** — 다음 경우는 제외:
- 실제 세금 계산 요청 ("내 세금 계산해줘", "급여명세서 작성해줘") → 급여 계산 도구로 라우팅
- 세무 신고서 양식 작성 ("부가세 신고서 써줘") → 문서 작성 도구로 라우팅
- 일반 법률 자문 (노동법·임대차·공정거래 등 세법 아닌 분야)
- 채용·마케팅·매출 등 비세무 주제

세법 또는 세무 규정에 관한 질문이면 광범위하게 is_tax=true 로 분류하세요.

[최근 대화]
{history_snippet}

[현재 메시지]
{message}

JSON 한 줄로만:
{{"is_tax": true|false, "topic": "vat|income_tax|corporate_tax|withholding_tax|social_insurance|national_tax_basic|special_tax|local_tax|inheritance_tax|other|none", "reason": "한 줄"}}"""


@dataclass
class TaxIntent:
    is_tax: bool
    topic: str | None
    reason: str


async def classify_tax_intent(message: str, history: list[dict]) -> TaxIntent:
    user_turns = [h.get("content", "") for h in history[-4:] if h.get("role") == "user"]
    snippet = "\n".join(f"- {t[:200]}" for t in user_turns[-3:]) or "(이전 대화 없음)"
    prompt = _TAX_CLASSIFY_PROMPT.format(history_snippet=snippet, message=message[:800])
    try:
        resp = await chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=_CLASSIFY_MODEL,
            response_format={"type": "json_object"},
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = json.loads(raw)
    except Exception as exc:
        log.warning("tax intent classify failed: %s", exc)
        return TaxIntent(is_tax=False, topic=None, reason="classify_error")

    is_tax = bool(data.get("is_tax", False))
    topic = str(data.get("topic") or "none").strip().lower()
    topic_val: str | None = topic if topic in VALID_TAX_TOPICS else None
    reason = str(data.get("reason") or "")[:200]
    log.info("[tax] classify is_tax=%s topic=%s msg=%r", is_tax, topic_val, message[:80])
    return TaxIntent(is_tax=is_tax, topic=topic_val, reason=reason)


# ────────────────────── 2. RAG 검색 ──────────────────────

_MIN_SIMILARITY_KEEP = 0.55  # 세무 조문은 법률 조문보다 약간 넓게 잡음
_MIN_KEPT_FOR_CONTEXT = 2


def _format_chunk_cite(r: dict) -> str:
    """청크 메타데이터 → 'XXX법 제N조(제목) 제M항' 형식 인용 레이블 생성."""
    src   = r.get("source") or "출처 불명"
    art   = r.get("article_no") or ""
    ttl   = r.get("article_title") or ""
    para  = r.get("paragraph_no")

    cite = src
    if art:
        cite += f" {art}"
    if ttl:
        cite += f"({ttl})"
    if para:
        cite += f" 제{para}항"
    return cite.strip()


def _retrieve_tax_context(
    query: str,
    topic: str | None,
    match_count: int = 8,
) -> tuple[str, list[dict]]:
    """search_tax_knowledge RPC 호출 → (rag_text, raw_chunks).

    topic 이 있으면 해당 세목 필터로 먼저 검색.
    결과가 3건 미만이면 필터 없이 재검색해 보완.
    각 source_type(statute·ruling·case) 결과를 구조화해 LLM에 전달.
    """
    if not (query or "").strip():
        return "", []
    try:
        emb = embed_text(query[:2000])
    except Exception as exc:
        log.warning("embed_text failed: %s", exc)
        return "", []
    emb_str = "[" + ",".join(f"{v:.10f}" for v in emb) + "]"

    sb = get_supabase()
    tax_cat = _TOPIC_TO_TAX_CAT.get(topic or "", None) if topic else None

    def _rpc(cat_filter: str | None, k: int) -> list[dict]:
        try:
            resp = sb.rpc("search_tax_knowledge", {
                "query_text":          query,
                "query_embedding":     emb_str,
                "match_count":         k,
                "filter_tax_category": cat_filter,
                "min_score":           0.2,
                "min_trgm_score":      0.15,
                "min_content_len":     30,
            }).execute()
            return resp.data or []
        except Exception as exc:
            log.warning("search_tax_knowledge failed (cat=%s): %s", cat_filter, exc)
            return []

    rows: list[dict] = []
    if tax_cat:
        rows = _rpc(tax_cat, match_count)
    if len(rows) < 3:
        seen_ids = {r.get("id") for r in rows}
        extra = [r for r in _rpc(None, match_count) if r.get("id") not in seen_ids]
        rows = (rows + extra)[:match_count]

    kept = [r for r in rows if (r.get("similarity") or 0) >= _MIN_SIMILARITY_KEEP]
    log.info(
        "[tax] rag: topic=%s raw=%d kept=%d top_sim=%s",
        topic, len(rows), len(kept),
        f"{(rows[0].get('similarity') or 0):.3f}" if rows else "—",
    )
    if len(kept) < _MIN_KEPT_FOR_CONTEXT:
        return "", []

    # source_type 별로 구조화해서 LLM 에 전달
    statutes = [r for r in kept if r.get("source_type") == "statute"]
    rulings  = [r for r in kept if r.get("source_type") == "ruling"]
    cases    = [r for r in kept if r.get("source_type") == "case"]

    lines: list[str] = ["[관련 세무 지식]"]

    if statutes:
        lines.append("\n■ 세법 조문")
        for r in statutes:
            head = _format_chunk_cite(r)
            lines.append(f"- {head}")
            content = (r.get("content") or "").strip()
            if content:
                lines.append(f"  {content[:800]}")
            lines.append("")

    if rulings:
        lines.append("\n■ 국세청 예규·고시")
        for r in rulings:
            src = r.get("source") or "출처 불명"
            ttl = r.get("article_title") or ""
            head = f"{src}{f' — {ttl}' if ttl else ''}".strip()
            lines.append(f"- {head}")
            content = (r.get("content") or "").strip()
            if content:
                lines.append(f"  {content[:600]}")
            lines.append("")

    if cases:
        lines.append("\n■ 조세심판원 심판결정례")
        for r in cases:
            src = r.get("source") or "출처 불명"
            ttl = r.get("article_title") or ""
            head = f"{src}{f' — {ttl}' if ttl else ''}".strip()
            lines.append(f"- {head}")
            content = (r.get("content") or "").strip()
            if content:
                lines.append(f"  {content[:600]}")
            lines.append("")

    return "\n".join(lines), kept


# ────────────────────── 3. 응답 생성 ──────────────────────

_TAX_SYSTEM_PROMPT = """당신은 대한민국 세무 전문 AI 자문가입니다. 소상공인·개인사업자·법인이 사업을 운영하며
마주치는 **세법 규정·세무 절차·납세 의무**에 대해 세법 조문과 국세청 예규, 조세심판원 결정례를 근거로 조언합니다.

[담당 세목]
• **부가가치세** : 과세/면세/영세율 구분, 세금계산서 발행·수취 의무, 간이과세 기준(연매출 1억 400만원),
  매입세액 공제 요건, 신고·납부 기한(1·7월)
• **소득세·법인세** : 과세표준, 누진세율 구간, 소득공제·세액공제 항목(인적공제·자녀세액공제·교육비·의료비 등),
  사업소득·근로소득·양도소득 구분, 종합소득세 확정신고(5월), 법인세 신고(3월)
• **원천세** : 근로소득·사업소득·기타소득 원천징수 방법 및 세율(3.3% 포함),
  원천징수이행상황신고서 제출 의무(매월/반기)
• **4대보험 법적 규정** : 요율 근거 법령, 부과 기준, 직장/지역 가입자 구분 의무,
  보험료 산정 방식 (실제 계산은 급여 계산 도구 사용 권고)
• **국세기본법** : 가산세 종류(무신고·과소신고·납부불성실·세금계산서 관련),
  불복 절차(이의신청 → 심판청구 → 행정소송), 부과제척기간(5년/10년),
  납세자 권리 헌장, 세무조사 절차
• **조세특례** : 창업중소기업 세액감면, 고용증대세액공제, 통합투자세액공제, 사업전환 감면
• **지방세** : 취득세·재산세·지방소득세·주민세·사업소세 기본 규정
• **상속세·증여세** : 세율 구간, 기본공제, 신고 의무 및 기한

[시점 인식 — 반드시 준수]
- "[오늘 날짜]" 기준으로 현재를 판단하세요.
- 당해년도 및 직전년도의 세율·기준금액은 **이미 공표된 확정 수치**입니다.
  (예: 2026-04 기준 → 2026년·2025년 부가세율·소득세율·4대보험 요율은 모두 공표됨)
- 법정 수치를 모르는 경우 허용 패턴:
  * "제 학습 기준 최신값은 YYYY년 기준 X입니다. 국세청(nts.go.kr) 또는 관할 세무서에서 확인하세요."
  * 미래형 표현("발표될 예정", "아직 미확정") — [오늘 날짜]에 이미 지난 연도라면 절대 금지.

[답변 원칙]
1. [관련 세무 지식] 섹션이 주어지면 그 범위 안에서 근거를 인용합니다.
   - **세법 조문** 인용 시: "부가가치세법 제26조 제1항" 처럼 **조·항까지** 표기.
     항이 여럿이면 각각 "제26조 제1항", "제26조 제2항" 으로 구분.
     항 정보가 없으면 조문 번호만("제26조").
   - **예규** 인용 시: "국세청예규 부가46015-XXXX" 형식
   - **심판례** 인용 시: "조세심판 20XX구XXXX" 형식
2. 컨텍스트에 없는 조항·판례·수치를 지어내지 마세요.
3. **답변 구조**:
   - **결론** (한 줄: 과세/면세/공제 가능/불가/조건부 가능 등)
   - **근거** (세법 조문·예규·심판례 2~4개 불릿)
   - **실무 포인트** (납세자가 바로 취해야 할 행동 2~3개 불릿)
   - 복잡하거나 개인 사정에 따라 달라지면 "세무사 상담 권장 포인트" 한 줄
4. **계산 질문 처리**: "실제로 얼마나 내야 하나요?" 류는 규정 설명 + "정확한 계산은 세무사 또는 홈택스 신고 도움 서비스를 이용하세요"로 마무리.
5. **면책 고지 및 시스템 꼬리 문구는 본문에 쓰지 마세요.** 시스템이 자동 첨부합니다.
6. [ARTIFACT] / [SET_NICKNAME] 등 마커 절대 출력 금지.
7. **포괄적 질문** (예: "소득세 알려줘") → 짧은 안내 + [CHOICES] 블록으로 세부 주제 3~5개 제시.
   CHOICES 턴에는 구조(결론/근거/실무 포인트)를 쓰지 말고 선택지만 나열.
8. **세무 신고서 작성·급여 계산 요청**은 이 도구의 범위가 아님을 안내하고
   "급여명세서/신고서 작성은 다른 기능을 이용해 주세요"라고 짧게 유도.
9. 답변은 존댓말, 불필요한 부연 없이.
"""

_TAX_DISCLAIMER = (
    "\n\n---\n"
    "> ⚠️ **면책 고지** · 위 내용은 AI가 세법 조문·예규·심판례를 바탕으로 제공하는 **참고 정보**이며, "
    "구체적 사안에 대한 확정적 세무 자문이 아닙니다. 세금 신고·납부 전에는 반드시 **세무사·공인회계사** 등 "
    "전문가와 상담하시기 바랍니다. (국세상담센터: ☎126)"
)


async def _generate_tax_advice(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    nickname_ctx: str,
) -> str:
    system = _TAX_SYSTEM_PROMPT + "\n\n" + today_context()
    if nickname_ctx:
        system += "\n\n" + nickname_ctx
    if rag_context:
        system += "\n\n" + rag_context
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"

    cleaned_history = _clean_history_for_legal(history[-6:])

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *cleaned_history,
            {"role": "user", "content": message},
        ],
        model=_ADVICE_MODEL,
        temperature=0.3,
    )
    body = (resp.choices[0].message.content or "").strip()
    return _strip_legal_footers(body)


# ────────────────────── 4. artifact 저장 ──────────────────────

def _summarize_for_title(message: str) -> str:
    text = (message or "").strip().splitlines()[0] if message else ""
    return text[:60].strip() or "세무 자문"


async def _save_tax_advice(
    account_id: str,
    question: str,
    answer_body: str,
    topic: str | None,
    sources: list[dict],
) -> str | None:
    sb = get_supabase()
    title = f"[세무조언] {_summarize_for_title(question)}"[:180]

    source_refs: list[str] = []
    for s in sources[:8]:
        src = s.get("source") or ""
        art = s.get("article_no") or ""
        ref = f"{src} {art}".strip() if art else src
        if ref:
            source_refs.append(ref)

    metadata = {
        "topic":     topic,
        "question":  question[:2000],
        "sources":   source_refs,
        "sub_kind":  "tax_advice",
    }
    try:
        ins = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains":    ["documents"],
            "kind":       "artifact",
            "type":       "tax_advice",
            "title":      title,
            "content":    answer_body,
            "status":     "active",
            "metadata":   metadata,
        }).execute()
    except Exception as exc:
        log.warning("tax_advice insert failed: %s", exc)
        return None
    if not ins.data:
        return None
    artifact_id = ins.data[0]["id"]
    record_artifact_for_focus(artifact_id)

    # Tax&HR 서브허브 우선 연결, 없으면 documents 메인허브 fallback
    parent_id = pick_sub_hub_id(sb, account_id, "documents", prefer_keywords=("tax", "Tax", "세무"))
    if not parent_id:
        parent_id = pick_documents_parent(sb, account_id, prefer_keywords=("tax", "세무"))
    if parent_id:
        try:
            sb.table("artifact_edges").insert({
                "account_id": account_id,
                "parent_id":  parent_id,
                "child_id":   artifact_id,
                "relation":   "contains",
            }).execute()
        except Exception:
            pass

    try:
        sb.table("activity_logs").insert({
            "account_id":  account_id,
            "type":        "artifact_created",
            "domain":      "documents",
            "title":       title,
            "description": f"세무 자문 생성 · topic={topic or 'general'} · 참조 {len(source_refs)}건",
            "metadata":    {"artifact_id": artifact_id, "topic": topic},
        }).execute()
    except Exception:
        pass

    try:
        from app.rag.embedder import index_artifact
        index_text = f"{title}\n{question}\n{answer_body[:3000]}"
        await index_artifact(account_id, "documents", artifact_id, index_text)
    except Exception:
        pass

    try:
        from app.memory.long_term import log_artifact_to_memory
        await log_artifact_to_memory(
            account_id, "documents", "tax_advice", title,
            content=answer_body,
            metadata={"topic": topic, "source_refs_count": len(source_refs)},
        )
    except Exception:
        pass

    return artifact_id


# ────────────────────── 5. 외부 진입점 ──────────────────────

@traceable(name="tax_legal.handle_question", run_type="chain")
async def handle_tax_question(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    nickname_ctx: str = "",
    intent: TaxIntent | None = None,
) -> str:
    """세무 법률 질문 처리 진입점. documents.py 에서 doc_tax_advice 로 호출."""
    if intent is None:
        intent = await classify_tax_intent(message, history)

    topic = intent.topic if intent.is_tax else None

    # 법정 수치 주입 (부가세율·소득세 구간·4대보험 요율 등)
    ann_cats = _detect_annual_categories(message)
    ann_years = _detect_years(message, date.today())
    annual_rows = _fetch_annual_values(ann_cats, ann_years) if ann_cats else []
    annual_block = _format_annual_values_block(annual_rows)
    log.info("[tax] annual: cats=%s years=%s rows=%d", ann_cats, ann_years, len(annual_rows))

    tax_rag, chunks = _retrieve_tax_context(message, topic)

    # 지식베이스 미인제스트 fallback
    if not tax_rag and not annual_block:
        tax_rag = (
            "[관련 세무 지식 검색 결과]\n"
            "이 질문에 부합하는 세법 데이터가 내부 지식베이스에 아직 인제스트되어 있지 않습니다. "
            "학습된 일반 세무 지식으로 답하되 **[시점 인식]** 규칙을 따르세요. "
            "구체 수치(세율·기준금액)는 국세청(nts.go.kr) 또는 홈택스에서 최신값을 확인하도록 안내하세요."
        )

    # 주입 순서: annual_block (최우선) > tax_rag (세법 조문·예규·심판례) > rag_context (artifact recall)
    merged_rag = "\n\n".join(p for p in (annual_block, tax_rag, rag_context) if p)

    body = await _generate_tax_advice(
        message=message,
        account_id=account_id,
        history=history,
        rag_context=merged_rag,
        long_term_context=long_term_context,
        nickname_ctx=nickname_ctx,
    )

    # CHOICES 턴 — 저장·면책 고지 스킵
    if _CHOICES_RE.search(body):
        log.info("[tax] clarifying turn (CHOICES) — skip save")
        return body

    artifact_id = await _save_tax_advice(account_id, message, body, topic, chunks)

    tail = _TAX_DISCLAIMER
    if artifact_id:
        tail += f"\n_(Tax 노드에 저장됨 — `{artifact_id}`)_"
    return body + tail
