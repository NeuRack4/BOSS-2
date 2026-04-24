"""Legal 서브허브 핸들러 — 법률 질문에 RAG 기반 조언.

파이프라인:
    1. is_legal_query  : 메시지가 법률 자문 의도인지 gpt-4o-mini 로 판정.
                         (서류 작성/검토가 아닌 "이런 법적 상황이 어떻게 되나요?" 류)
    2. retrieve        : 질문 임베딩 → search_legal_knowledge RPC 로 다분야 법령 조문 수집.
    3. generate_advice : system + RAG + history → GPT-4o 응답 (면책 문구 자동 첨부).
    4. save_artifact   : type='legal_advice' 로 Documents > Legal 서브허브 아래 저장 +
                         activity_logs + 임베딩.

외부 계약:
    - `search_legal_knowledge` RPC (019 마이그레이션).
    - `pick_sub_hub_id` 로 Legal 서브허브 선택. 없으면 documents 메인허브로 fallback.
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
_ADVICE_MODEL = "gpt-4o"

_CHOICES_RE = re.compile(r"\[CHOICES\](.*?)\[/CHOICES\]", re.DOTALL)
_YEAR_RE = re.compile(r"(?<!\d)(20\d{2})(?!\d)")

# 메시지에서 감지할 카테고리 키워드 → legal_annual_values.category 매핑.
# 한 메시지에 여러 카테고리 키워드가 있으면 모두 주입 (작은 연관 수치 묶음이라 비용 OK).
_CATEGORY_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("minimum_wage", (
        "최저임금", "최저시급", "시간당 임금", "최저 시급",
    )),
    ("vat_rate", (
        "부가가치세율", "부가세율", "vat 율", "vat율",
    )),
    ("vat_simplified_threshold", (
        "간이과세", "간이과세자", "간이 과세", "간이사업자",
    )),
    ("income_tax_brackets", (
        "종합소득세", "종소세", "소득세 구간", "과세표준", "소득세율",
    )),
    ("social_insurance_rates", (
        "4대보험", "사대보험", "국민연금", "건강보험", "고용보험", "산재보험",
        "장기요양", "보험료율",
    )),
    ("commercial_lease_deposit_cap", (
        "환산보증금", "상가임대차 보호", "상가임대차 환산",
    )),
    ("smb_threshold", (
        "소상공인 기준", "소기업 기준", "중소기업 기준",
    )),
    ("privacy_penalty", (
        "개인정보 과태료", "개인정보 유출 과태료", "개인정보 보호법 과태료",
        "개인정보 과징금",
    )),
    ("franchise_deposit", (
        "가맹금 예치", "가맹금예치",
    )),
    ("labor_thresholds", (
        "수습 임금", "주 52시간", "주52시간", "연장근로수당", "야간수당",
        "연차 일수", "연차휴가", "퇴직금 발생", "해고 예고", "수습 기간",
    )),
)


def _detect_annual_categories(message: str) -> list[str]:
    """메시지에서 법정 수치 카테고리 키워드를 찾아 중복 없이 반환."""
    if not message:
        return []
    low = message.casefold()
    hits: list[str] = []
    for cat, kws in _CATEGORY_KEYWORDS:
        for kw in kws:
            if kw.casefold() in low:
                hits.append(cat)
                break
    return hits


def _detect_years(message: str, today: date) -> list[int]:
    """메시지에서 YYYY 연도 추출. 없으면 [today.year, today.year+1]."""
    years = sorted({int(m) for m in _YEAR_RE.findall(message or "") if 2000 <= int(m) <= 2100})
    if years:
        return years
    # 명시 연도가 없으면 당해년도를 주입 (사용자가 "지금 최저임금은?" 류).
    return [today.year]


def _fetch_annual_values(categories: list[str], years: list[int]) -> list[dict]:
    """legal_annual_values 조회. 매치된 각 category 에 대해:
         1) 요청 연도 정확 매치 우선
         2) 없으면 요청 연도 ±1 (폴백)
       결과가 있는 것만 모아 반환.
    """
    if not categories:
        return []
    sb = get_supabase()
    # 후보 연도 세트: 요청 연도 + (요청 연도-1) + (요청 연도+1) — 폴백용.
    candidate_years: list[int] = sorted({y + d for y in years for d in (-1, 0, 1)})
    try:
        rows = (
            sb.table("legal_annual_values")
            .select("category,year,value,source_name,source_url,note,unverified,effective_from")
            .in_("category", categories)
            .in_("year", candidate_years)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        log.warning("legal_annual_values fetch failed: %s", exc)
        return []

    # category 별로 요청 연도 > 가까운 연도 순으로 1~2개만 남김.
    out: list[dict] = []
    for cat in categories:
        cat_rows = [r for r in rows if r.get("category") == cat]
        if not cat_rows:
            continue
        # 우선순위: 요청 연도 정확 매치 → 가까운 연도 (거리 오름차순)
        requested = set(years)
        cat_rows.sort(key=lambda r: (
            0 if r.get("year") in requested else 1,
            min(abs(r.get("year", 0) - y) for y in years),
            -r.get("year", 0),  # 동점이면 최신 우선
        ))
        out.extend(cat_rows[:2])  # 카테고리당 최대 2개 (비교용: 당해+직전)
    return out


def _format_annual_values_block(rows: list[dict]) -> str:
    """주입용 블록 문자열. LLM 에게 "이 수치만 근거로 답하라" 힌트 포함."""
    if not rows:
        return ""
    lines = [
        "[법정 수치 (권위 있는 출처) — 반드시 이 수치만 근거로 답하세요]",
    ]
    for r in rows:
        cat = r.get("category")
        year = r.get("year")
        value = r.get("value")
        src = r.get("source_name") or ""
        url = r.get("source_url") or ""
        note = r.get("note") or ""
        unverified = r.get("unverified") or False

        head = f"- [{cat}] {year}년"
        if unverified:
            head += " (⚠️ 미검증 — 최신 공식 발표 확인 권장)"
        lines.append(head)
        try:
            value_str = json.dumps(value, ensure_ascii=False)
        except Exception:
            value_str = str(value)
        lines.append(f"  값: {value_str}")
        meta = " · ".join(p for p in [src, note] if p)
        if meta:
            lines.append(f"  출처: {meta}")
        if url:
            lines.append(f"  참고 URL: {url}")
    lines.append("")
    lines.append(
        "답변 시 위 수치를 정확히 인용하고, 숫자는 원화 단위·소수점·반올림을 원본 그대로. "
        "미검증 항목은 답변 안에서 '공식 확인 권장' 을 명시. 학습 지식보다 위 수치를 우선."
    )
    return "\n".join(lines)

DISCLAIMER = (
    "\n\n---\n"
    "> ⚠️ **면책 고지** · 위 내용은 AI 가 공개 법령을 바탕으로 제공하는 **참고 정보**이며, "
    "구체적 사안에 대한 확정적 법적 자문이 아닙니다. 중요한 결정 전에는 변호사·공인노무사·세무사 등 "
    "해당 분야 전문가와 상담하시기 바랍니다."
)

# history 에서 제거할 footer 패턴들. LLM 이 이전 assistant 턴의 꼬리를 보고
# 본문에 그대로 복제하거나 UUID 를 환각하는 것을 방지.
_DISCLAIMER_LINE_RE = re.compile(
    r"(?:\n+---\n+)?>?\s*⚠️[^\n]*면책 고지[\s\S]*",
)
_NODE_FOOTER_RE = re.compile(
    r"\n*_?\(?\s*Legal 노드에 저장됨[^)]*\)?\s*_?\n*",
)


def _strip_legal_footers(content: str) -> str:
    """assistant 응답에서 면책 고지 + 노드 저장 꼬리만 제거. 본문은 유지."""
    if not content:
        return content
    out = _NODE_FOOTER_RE.sub("", content)
    out = _DISCLAIMER_LINE_RE.sub("", out)
    return out.rstrip()


def _clean_history_for_legal(history: list[dict]) -> list[dict]:
    """history 의 assistant 턴에서 legal footer 를 벗김. LLM 이 꼬리를 모사하지 않도록."""
    cleaned: list[dict] = []
    for h in history:
        if h.get("role") == "assistant":
            body = _strip_legal_footers(h.get("content") or "")
            if body:
                cleaned.append({"role": "assistant", "content": body})
        else:
            cleaned.append(h)
    return cleaned


# ────────────────────── 1. intent 판정 ──────────────────────

_CLASSIFY_PROMPT = """당신은 사용자의 메시지를 분류하는 라우터입니다.
메시지가 "법률·법령·규제에 관한 질문" 인지 판단하세요.

**legal_advice = true** 로 분류해야 하는 경우 (범위 넓게 잡음):
- 법률/법령/조례/시행령/시행규칙의 **내용·설명·요약 요청** (예: "소방법 알려줘", "근로기준법이 뭐야", "상가 임대차보호법 요약해줘")
- 특정 조항·제도·권리·의무에 대한 질문 (예: "권리금 반환 청구 가능?", "갱신요구권이 뭐죠?")
- 분쟁·다툼·위반 상황의 대응 방법·절차·책임·구제수단 질문
- 특정 행위의 합법성·불법성·처벌·과태료·형량 질문
- 인허가·신고·등록·등기 같은 행정 절차 질문
- 영역 불문: 노동·임대차·공정거래·개인정보·세법·상법·민법·가맹·전자상거래·식품위생·소방·건축·환경·저작권·의료·형사·행정 등 전부.

**legal_advice = false** 로 분류해야 하는 경우:
- 실제 서류 **작성/초안** 요청 ("계약서 써줘", "공지문 초안 만들어줘", "견적서 양식으로 작성해줘")
- 업로드된 문서 검토·분석 요청 ("이 계약서 공정성 봐줘", "위험조항 뽑아줘")
- 비-법률 주제 (채용 공고 작성·마케팅·매출·개인 잡담·인사 등)

애매하면 legal_advice=true 로 분류하세요. "알려줘", "요약해줘", "뭐야", "어떻게 돼" 같은 지식 질의형 어미가 붙은 법 관련 메시지는 전부 true.

[최근 대화 (user 턴 일부)]
{history_snippet}

[현재 메시지]
{message}

JSON 한 줄로만 답하세요:
{{"legal_advice": true|false, "topic": "labor|lease|privacy|fair_trade|consumer|franchise|ecommerce|tax|food_hygiene|smb|civil|commercial|criminal|other|none", "reason": "한 줄"}}"""


# legal_knowledge_chunks.domain 과 일치해야 함 (필터용). "none" 은 filter_domain=null 로 fallback.
VALID_TOPICS = (
    "labor", "lease", "privacy", "fair_trade", "consumer", "franchise",
    "ecommerce", "tax", "food_hygiene", "smb", "civil", "commercial", "criminal",
    "other",
)


@dataclass
class LegalIntent:
    is_legal: bool
    topic: str | None  # None = 전체 검색
    reason: str


async def classify_legal_intent(message: str, history: list[dict]) -> LegalIntent:
    """메시지가 법률 자문 의도인지 판정 + 주제 추정."""
    user_turns = [h.get("content", "") for h in history[-4:] if h.get("role") == "user"]
    snippet = "\n".join(f"- {t[:200]}" for t in user_turns[-3:]) or "(이전 대화 없음)"
    prompt = _CLASSIFY_PROMPT.format(history_snippet=snippet, message=message[:800])
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
        log.warning("legal intent classify failed: %s", exc)
        return LegalIntent(is_legal=False, topic=None, reason="classify_error")

    is_legal = bool(data.get("legal_advice", False))
    topic = str(data.get("topic") or "none").strip().lower()
    if topic in ("none", ""):
        topic_val: str | None = None
    elif topic in VALID_TOPICS:
        topic_val = topic
    else:
        topic_val = None
    reason = str(data.get("reason") or "")[:200]
    log.info(
        "[legal] classify is_legal=%s topic=%s reason=%r msg=%r",
        is_legal, topic_val, reason[:80], message[:80],
    )
    return LegalIntent(is_legal=is_legal, topic=topic_val, reason=reason)


# ────────────────────── 2. RAG 검색 ──────────────────────

# RAG 품질 컷오프.
# 실측: 코퍼스 내 관련 매치는 cos_sim 0.60~0.75, 무관 매치(예: 소방법 쿼리 → 근로기준법 기숙사 조항)
# 는 0.35~0.55 대. 0.58 을 넘기면 실질적 관련성이 있다고 보고 포함.
_MIN_SIMILARITY_KEEP = 0.58
# 결과 세트가 이 건수 미만이면 "부족하다" 판단 — 컨텍스트 빈 채로 LLM 일반 지식 fallback 유도.
_MIN_KEPT_FOR_CONTEXT = 2


def _retrieve_legal_context(
    query: str,
    topic: str | None,
    match_count: int = 6,
) -> tuple[str, list[dict]]:
    """질의 임베딩 → search_legal_knowledge RPC. (rag_text, raw_chunks) 반환.

    topic 이 주어지면 먼저 도메인 필터 검색. 결과가 3건 미만이면 필터 없이 재검색해 보완.
    최종적으로 `similarity < _MIN_SIMILARITY_KEEP` 인 매치는 모두 제거 — 무관 법령 노이즈 차단.
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

    def _rpc(domain_filter: str | None, k: int) -> list[dict]:
        try:
            resp = sb.rpc("search_legal_knowledge", {
                "query_text":       query,
                "query_embedding":  emb_str,
                "match_count":      k,
                "filter_domain":    domain_filter,
                "min_score":        0.2,
                "min_trgm_score":   0.15,
                "min_content_len":  30,
            }).execute()
            return resp.data or []
        except Exception as exc:
            log.warning("search_legal_knowledge failed (domain=%s): %s", domain_filter, exc)
            return []

    rows: list[dict] = []
    if topic:
        rows = _rpc(topic, match_count)
    if len(rows) < 3:
        # 필터 결과가 빈약 → 필터 없이 보강
        seen_ids = {r.get("id") for r in rows}
        extra = [r for r in _rpc(None, match_count) if r.get("id") not in seen_ids]
        rows = (rows + extra)[:match_count]

    # 품질 컷오프 — similarity 필드는 RPC 가 반환하는 cos_sim (0~1).
    kept = [r for r in rows if (r.get("similarity") or 0) >= _MIN_SIMILARITY_KEEP]
    log.info(
        "[legal] rag: topic=%s raw=%d kept=%d (cutoff=%.2f) top_sim=%s",
        topic, len(rows), len(kept), _MIN_SIMILARITY_KEEP,
        f"{(rows[0].get('similarity') or 0):.3f}" if rows else "—",
    )
    if len(kept) < _MIN_KEPT_FOR_CONTEXT:
        # 관련 있는 매치가 충분하지 않음 → 빈 컨텍스트. LLM 은 일반 지식 fallback 프롬프트를 사용.
        return "", []

    lines = ["[관련 법령 조문]"]
    for r in kept:
        src  = r.get("source") or "출처 불명"
        art  = r.get("article_no") or ""
        ttl  = r.get("article_title") or ""
        para = r.get("paragraph_no")

        cite = src
        if art:
            cite += f" {art}"
        if ttl:
            cite += f"({ttl})"
        if para:
            cite += f" 제{para}항"

        lines.append(f"- {cite.strip()}")
        content = (r.get("content") or "").strip()
        if content:
            lines.append(f"  {content[:800]}")
        lines.append("")
    return "\n".join(lines), kept


# ────────────────────── 3. 응답 생성 ──────────────────────

_SYSTEM_PROMPT = """당신은 대한민국 법률 전문 AI 자문가입니다. 소상공인이 사업을 운영하며 부딪히는 다양한 법률 문제
(노동·임대차·공정거래·개인정보·세법·상법·민법·가맹·전자상거래·식품위생 등) 에 대해 **실제 법령과 대법원 판례의 일반적 해석**
을 바탕으로 조언을 제공합니다.

[시점 인식 — 반드시 준수]
- 시스템이 주입하는 "[오늘 날짜]" 를 기준 현재로 삼으세요. 당신의 학습 컷오프와 [오늘 날짜] 사이에는 시차가 있을 수 있습니다.
- 사용자가 묻는 연도가 [오늘 날짜] 의 **당해년 또는 직전년도**라면, 그 수치는 **이미 공표되어 있습니다** 고 전제하세요.
  (예: 오늘이 2026-04-20 이면 2025·2026년 최저임금·세율·과태료는 전부 공표됨. 2024년은 당연히 과거값.)
- 학습 컷오프 이후의 정확한 수치를 모를 때 허용되는 답변 패턴:
  * "제 학습 데이터 기준으로 확인 가능한 최신값은 **YYYY년 X원** 입니다. 해당 연도 이후의 공식값은 고용노동부 공식 사이트(minimumwage.go.kr 등) 에서 확인하세요."
  * 모르면 모른다고 하되 **현재 상황에 맞춰** 표현. "발표될 예정", "아직 확정되지 않았다", "내년에 결정될 것" 같이
    **[오늘 날짜] 에 모순되는 미래형 표현 절대 금지.**
- 조항/제도(예: 근로기준법 제17조 체결 의무)는 대개 변하지 않으므로 당신의 학습 지식을 그대로 인용해도 됩니다.

[답변 원칙]
1. 아래 [관련 법령 조문] 섹션이 주어지면 반드시 그 범위 안에서 근거를 인용하며 답합니다.
2. 조항을 인용할 땐 "근로기준법 제17조 제2항" 처럼 **조·항까지** 정식 형식으로 명시합니다.
   항 정보가 없으면 조문 번호만("제17조"). 항이 여럿이면 각각 구분해 표기.
3. 컨텍스트에 없는 조항·판례·숫자를 지어내지 마세요. 확신이 없으면 "확답은 어렵고 일반적으로는..." 식으로 한계를 밝힙니다.
4. 답변 구조:
   - **결론** 한 줄 (가능 / 제한적 가능 / 불가 / 상황에 따라 다름)
   - **근거** 관련 법령·조항 2~4개 불릿
   - **실무 가이드** 사용자가 바로 적용할 수 있는 행동 2~3개 불릿
   - 복잡한 사안이면 "전문가 상담이 권장되는 포인트" 한 줄
5. **면책 고지 및 "Legal 노드에 저장됨 — ..." 같은 꼬리 문구는 절대 본문에 쓰지 마세요.** 시스템이 응답 끝에 자동으로 첨부합니다.
   이전 대화에서 그런 꼬리가 보였더라도 무시하고 본문에만 집중하세요. UUID/artifact_id 도 임의로 만들어내지 마세요.
6. [ARTIFACT] / [SET_NICKNAME] / [SET_PROFILE] 마커는 절대 출력하지 마세요.
7. **포괄적 질문 처리** — 질문이 너무 넓으면 (예: "소방법 알려줘", "세법 설명해줘") 바로 답하지 말고,
   한 줄짜리 안내 + `[CHOICES]` 블록으로 3~5개의 세부 주제 선택지를 제시해 한 번에 좁히세요. 예:
   ```
   소방법은 범위가 넓어서 좁혀서 답하는 게 좋아요. 어느 쪽이 궁금하신가요?
   [CHOICES]
   소방시설 설치 기준
   화재 예방 조치 의무
   소방 안전 점검 절차
   위반 시 과태료·벌칙
   직접 입력
   [/CHOICES]
   ```
   **CHOICES 로 되묻는 턴은 답변이 아니므로 구조(결론/근거/실무가이드)를 쓰지 말고 짧은 안내만 넣으세요.**
8. 답변은 존댓말, 군더더기 없는 톤.
"""


async def _generate_advice(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    nickname_ctx: str,
) -> str:
    system = _SYSTEM_PROMPT + "\n\n" + today_context()
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
    # 혹시 LLM 이 또 꼬리를 붙였다면 한 번 더 제거 (보험).
    return _strip_legal_footers(body)


# ────────────────────── 4. artifact 저장 ──────────────────────

def _summarize_for_title(message: str) -> str:
    text = (message or "").strip().splitlines()[0] if message else ""
    text = text[:60].strip()
    return text or "법률 자문"


async def _save_legal_advice(
    account_id: str,
    question: str,
    answer_body: str,
    topic: str | None,
    sources: list[dict],
) -> str | None:
    """legal_advice artifact 저장 + Legal 서브허브 contains 엣지 + activity + 임베딩."""
    sb = get_supabase()
    title = f"[법률조언] {_summarize_for_title(question)}"[:180]

    source_refs = []
    for s in sources[:8]:
        src = s.get("source") or ""
        art = s.get("article_no") or ""
        ref = f"{src} {art}".strip()
        if ref:
            source_refs.append(ref)

    metadata = {
        "topic":     topic,
        "question":  question[:2000],
        "sources":   source_refs,
        "sub_kind":  "legal_advice",
    }
    try:
        ins = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains":    ["documents"],
            "kind":       "artifact",
            "type":       "legal_advice",
            "title":      title,
            "content":    answer_body,
            "status":     "active",
            "metadata":   metadata,
        }).execute()
    except Exception as exc:
        log.warning("legal_advice insert failed: %s", exc)
        return None
    if not ins.data:
        return None
    artifact_id = ins.data[0]["id"]
    record_artifact_for_focus(artifact_id)

    # Legal 서브허브 우선 연결. 없으면 documents 메인허브 fallback.
    parent_id = pick_sub_hub_id(sb, account_id, "documents", prefer_keywords=("legal",))
    if not parent_id:
        parent_id = pick_documents_parent(sb, account_id, prefer_keywords=("legal",))
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
            "description": f"법률 조언 생성 · topic={topic or 'general'} · 참조 {len(source_refs)}건",
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
            account_id, "documents", "legal_advice", title,
            content=answer_body,
            metadata={"topic": topic, "source_refs_count": len(source_refs)},
        )
    except Exception:
        pass

    return artifact_id


# ────────────────────── 5. 외부 진입점 ──────────────────────

@traceable(name="legal.handle_question", run_type="chain")
async def handle_legal_question(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    nickname_ctx: str = "",
    intent: LegalIntent | None = None,
) -> str:
    """Legal 질문 처리 진입점. documents.py 에서 sub-branch 로 호출."""
    if intent is None:
        intent = await classify_legal_intent(message, history)

    topic = intent.topic if intent.is_legal else None

    # 0. 법정 수치 테이블 (연도·카테고리 감지 시) — 가장 먼저, 최우선 근거로 주입.
    ann_cats = _detect_annual_categories(message)
    ann_years = _detect_years(message, date.today())
    annual_rows = _fetch_annual_values(ann_cats, ann_years) if ann_cats else []
    annual_block = _format_annual_values_block(annual_rows)
    log.info(
        "[legal] annual: cats=%s years=%s rows=%d",
        ann_cats, ann_years, len(annual_rows),
    )

    legal_rag, chunks = _retrieve_legal_context(message, topic)

    # 코퍼스에 해당 법령이 없고, 법정 수치 블록도 없으면 LLM 일반 지식으로 답하되 한계 명시.
    # (annual_block 이 있으면 그 자체가 authoritative 이므로 추가 힌트 불필요)
    if not legal_rag and not annual_block:
        legal_rag = (
            "[관련 법령 조문 검색 결과]\n"
            "이 질문에 부합하는 법령이 내부 지식베이스에 인제스트되어 있지 않습니다. "
            "당신이 학습한 일반 법률 지식으로 답하되, 반드시 **[시점 인식]** 규칙을 따르세요. "
            "구체 수치(금액·과태료·세율)는 당신의 학습 컷오프 시점의 값임을 명시하고, "
            "'최신 공식값은 관할 부처(고용노동부·국세청·공정위 등) 사이트에서 확인' 을 덧붙이세요."
        )

    # documents 도메인의 기존 rag_context (canvas artifact recall 등) 도 같이 주입.
    # 주입 순서: annual_block (최우선 권위) > legal_rag (조문) > rag_context (artifact recall)
    merged_rag = "\n\n".join(p for p in (annual_block, legal_rag, rag_context) if p)

    body = await _generate_advice(
        message=message,
        account_id=account_id,
        history=history,
        rag_context=merged_rag,
        long_term_context=long_term_context,
        nickname_ctx=nickname_ctx,
    )

    # CHOICES 로 되묻는 턴은 "조언" 이 아니라 대화 중간 단계 — 저장/면책 꼬리 스킵.
    if _CHOICES_RE.search(body):
        log.info("[legal] clarifying turn (CHOICES present) — skip save + disclaimer")
        return body

    # artifact 저장 (best-effort). 실패해도 본문은 돌려준다.
    artifact_id = await _save_legal_advice(account_id, message, body, topic, chunks)

    tail = DISCLAIMER
    if artifact_id:
        tail += f"\n_(Legal 노드에 저장됨 — `{artifact_id}`)_"
    return body + tail
