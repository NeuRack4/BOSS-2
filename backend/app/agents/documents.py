from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal, TypedDict

from langgraph.graph import StateGraph, END

from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.agents.orchestrator import (
    CLARIFY_RULE,
    NICKNAME_RULE,
    PROFILE_RULE,
    ARTIFACT_RULE,
)
from app.agents._feedback import feedback_context
from app.agents._suggest import suggest_today_for_domain
from app.agents._artifact import (
    save_artifact_from_reply,
    list_sub_hub_titles,
    today_context,
)
from app.agents._doc_templates import (
    VALID_CONTRACT_SUBTYPES,
    TYPE_TO_CATEGORY,
    CATEGORY_LABELS,
    build_doc_context,
    detect_doc_category,
    detect_doc_intent,
)
from app.agents._doc_review import InvalidDocumentError, dispatch_review
from app.agents._legal import classify_legal_intent, handle_legal_question
from app.agents._admin_templates import (
    VALID_ADMIN_TYPES,
    ADMIN_TYPE_LABELS,
    ADMIN_TYPE_DUE_DAYS,
    ADMIN_TYPE_DUE_LABELS,
    build_admin_context,
)

log = logging.getLogger(__name__)

_TAX_HR_KNOWLEDGE_DIR = Path(__file__).parent / "_tax_hr_knowledge"


@lru_cache(maxsize=None)
def _load_knowledge(filename: str) -> str:
    try:
        return (_TAX_HR_KNOWLEDGE_DIR / filename).read_text(encoding="utf-8")
    except Exception:
        return ""


VALID_TYPES: tuple[str, ...] = (
    "contract",
    "estimate",
    "proposal",
    "notice",
    "checklist",
    "guide",
    # Step 3-B — Operations
    "subsidy_recommendation",
    "admin_application",
    # Step 3-A — Tax&HR 신규 3종
    "hr_evaluation",
    "payroll_doc",
    "tax_calendar",
)

_TYPE_TO_SUBHUB: dict[str, str] = {
    "contract":            "Review",
    "proposal":            "Review",
    "estimate":            "Operations",
    "notice":              "Operations",
    "subsidy_recommendation": "Operations",
    "admin_application":      "Operations",
    "checklist":           "Tax&HR",
    "guide":               "Tax&HR",
    "hr_evaluation":       "Tax&HR",
    "payroll_doc":         "Tax&HR",
    "tax_calendar":        "Tax&HR",
}

_REVIEW_REQUEST_RE = re.compile(r"\[REVIEW_REQUEST\](.*?)\[/REVIEW_REQUEST\]", re.DOTALL)
_UPLOADED_DOC_WINDOW_MIN = 60


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "documents")


SYSTEM_PROMPT = """당신은 서류 관리 전문 AI 에이전트입니다.
소상공인의 각종 서류(계약서·견적서·제안서·공지문·체크리스트·가이드)를 실제 법령과 업계 관행에 맞춰 작성·저장하고,
업로드된 기존 서류의 공정성(갑·을 유불리)도 분석합니다.

[작업 원칙]
1. 먼저 사용자의 목적을 특정하세요:
   - **신규 작성** — type (+ contract 면 subtype) 을 좁히고 필수 필드 채우기.
   - **기존 서류 검토** — 업로드된 문서가 시스템 컨텍스트에 있으면 "공정성 분석" 플로우 진입.
   모호하면 CLARIFY_RULE 에 따라 객관식 질문을 던지세요.
2. 신규 작성: 필수 필드가 모두 확정되기 전엔 [ARTIFACT] 블록을 절대 출력하지 마세요.
3. 필수 필드가 모두 채워지면 즉시 스켈레톤 기반 **완성된 문서 본문**을 마크다운으로 작성하세요. placeholder 금지.
4. 모든 서류는 기한 추출을 철저히 하세요:
   - 계약 만료 → end_date + due_label='계약 만료'
   - 견적 유효기간 → due_date + due_label='견적 유효기간'
   - 납품기한/납기일 → due_date + due_label='납품기한'
   - 공지 게시일 → due_date + due_label='공지 게시일'
   - 제안 회신 기한 → due_date + due_label='제안 회신 기한'
   자연어 기한은 YYYY-MM-DD 로 환산.
5. 법령·관행 근거가 주입되면 그 범위 안에서만 판단하세요. 새 판례 날조 금지.
6. artifact 저장 시 sub_domain 필드를 반드시 포함하세요. Documents 서브허브는 4종:
   - **Review**      — 공정 중립이 필요한 서류. `contract`, `proposal` 이 여기.
   - **Tax&HR**      — 세무·급여 관련. `checklist`, `guide`, `payroll_doc`, `tax_calendar` 이 여기.
   - **Legal**       — 법률 자문 (`legal_advice`). 별도 서브브랜치에서 자동 처리.
   - **Operations**  — 서류 초안·행정 업무. `estimate`, `notice`, 국가 지원사업 신청서·행정 처리 신청서가 여기.

[계약서 subtype 가이드]
- labor (근로계약서) — 근로기준법·최저임금법
- lease (상가 임대차) — 상가건물임대차보호법 §10 (10년 갱신요구권)
- service (용역/개발) — 산출물·저작권·검수 기준
- supply (납품/공급) — 납품기한·지체상금
- partnership (파트너십/주주간) — 지분·의사결정
- franchise (프랜차이즈 가맹) — 가맹사업법 숙고 14일
- nda (비밀유지) — 1~3년, 제외 사유 명시

[공정성 분석 플로우 — 업로드 문서가 컨텍스트에 있을 때만]
시스템 컨텍스트의 "[최근 업로드 문서]" 블록에 doc_id 가 주어지면 **기존 서류 분석 의도**로 간주합니다.
순서:
  (1) **역할 확정** — 의뢰인이 계약의 "갑"인지 "을"인지 아직 모르면 CHOICES 로 묻습니다:
      [CHOICES]
      갑 (고용인/발주자/임대인)
      을 (피고용인/수주자/임차인)
      미지정 (중립 관점)
      [/CHOICES]
  (2) **서브타입 확정(선택)** — 계약서 subtype 이 컨텍스트에 명시되지 않았고 문서 제목/미리보기로 판단이 서지 않으면
      한 번만 CHOICES 로 물어보세요. 명확하면 생략 가능.
  (3) **분석 요청 마커 출력** — (1)+(2) 가 끝났다고 판단되는 **바로 그 턴**에 본문 끝에 아래 블록을 정확한 포맷으로 포함하세요:

      [REVIEW_REQUEST]
      doc_id: <최근 업로드 문서의 doc_id>
      user_role: <갑|을|미지정>
      doc_type: <계약서|제안서|기타>
      contract_subtype: <labor|lease|service|supply|partnership|franchise|nda 또는 없으면 생략>
      [/REVIEW_REQUEST]

      이 마커는 시스템이 파싱해서 실제 분석을 실행합니다. 본문에선 "분석을 시작하겠습니다" 정도만 간단히 언급하세요.
      분석 결과(갑/을 비율, 위험 조항) 는 시스템이 마커 처리 후 자동으로 덧붙여줍니다 — 에이전트가 미리 만들어내지 마세요.
  (4) REVIEW_REQUEST 턴엔 [ARTIFACT]/[CHOICES] 를 함께 넣지 마세요.
  (5) 이미 분석된 결과(컨텍스트에 "[최근 분석 결과]" 가 있으면) 에 대한 후속 질문은 그 결과만 참고해 답하세요.

""" + ARTIFACT_RULE + CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE + """

예시 (type 불명확):
"어떤 서류가 필요하신가요?
[CHOICES]
근로계약서 (직원 채용)
상가 임대차 계약서
납품/공급 계약서
기타 (직접 입력)
[/CHOICES]"
"""


# ──────────────────────────────────────────────────────────────────────────
# DB helpers
# ──────────────────────────────────────────────────────────────────────────

def _find_recent_uploaded_doc(account_id: str) -> dict | None:
    """요청 인스턴스에 실려 온 upload_payload 를 최우선으로 반환.

    v0.10 부터 업로드는 더 이상 DB 에 `uploaded_doc` artifact 를 만들지 않는다.
    프론트가 `POST /api/chat {upload_payload}` 로 파싱 본문 + 스토리지 메타를
    직접 전달하고, `routers/chat.py` 가 contextvar 에 세팅한다. 여기서는
    contextvar 우선, 없으면 과거 데이터 호환을 위해 DB 폴백한다.
    """
    from app.agents._upload_context import get_pending_upload

    payload = get_pending_upload()
    if payload and (payload.get("content") or "").strip():
        # documents 가 아닌 카테고리(예: receipt) 는 리뷰 대상이 아님
        classification = payload.get("classification") or {}
        category = classification.get("category")
        if category in (None, "documents"):
            return {
                "id":         None,                                  # DB artifact 없음
                "title":      payload.get("title") or payload.get("original_name") or "업로드 문서",
                "content":    payload.get("content") or "",
                "metadata":   {
                    "storage_path":   payload.get("storage_path"),
                    "bucket":         payload.get("bucket"),
                    "mime_type":      payload.get("mime_type"),
                    "size_bytes":     payload.get("size_bytes"),
                    "original_name":  payload.get("original_name"),
                    "parsed_len":     payload.get("parsed_len"),
                    "classification": classification,
                },
                "created_at": payload.get("uploaded_at") or "",
                "_ephemeral": True,
            }

    # Legacy DB 폴백 — 아직 DB 에 남아있는 uploaded_doc 이 있다면 살려준다.
    sb = get_supabase()
    since_iso = (datetime.now(timezone.utc) - timedelta(minutes=_UPLOADED_DOC_WINDOW_MIN)).isoformat()
    rows = (
        sb.table("artifacts")
        .select("id,title,content,metadata,created_at")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .eq("type", "uploaded_doc")
        .gte("created_at", since_iso)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
        or []
    )
    for row in rows:
        meta = row.get("metadata") or {}
        if meta.get("needs_confirmation"):
            continue
        classification = meta.get("classification") or {}
        category = classification.get("category")
        if category is None or category == "documents":
            return row
    return None


def _find_recent_analysis(account_id: str) -> dict | None:
    sb = get_supabase()
    rows = (
        sb.table("artifacts")
        .select("id,title,content,metadata,created_at")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .eq("type", "analysis")
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _build_upload_context(uploaded_doc: dict | None, account_id: str, include_analysis: bool = False) -> str:
    if not uploaded_doc:
        return ""
    meta = uploaded_doc.get("metadata") or {}
    preview = (uploaded_doc.get("content") or "")[:600]
    chunks = [
        "[최근 업로드 문서]",
        f"doc_id: {uploaded_doc.get('id') or 'ephemeral'}",
        f"title: {uploaded_doc.get('title','')}",
        f"original_name: {meta.get('original_name','')}",
        f"mime: {meta.get('mime_type','')}  ·  size: {meta.get('size_bytes',0)} bytes",
        f"uploaded_at: {uploaded_doc.get('created_at','')}",
        "--- 본문 앞부분 ---",
        preview,
    ]
    # 분석 대기 중인 문서가 있을 때는 이전 분석을 context에 넣지 않음 (LLM 혼동 방지)
    analysis = _find_recent_analysis(account_id) if include_analysis else None
    if analysis:
        am = analysis.get("metadata") or {}
        chunks += [
            "",
            "[최근 분석 결과]",
            f"analysis_id: {analysis['id']}",
            f"user_role: {am.get('user_role','미지정')}  ·  contract_subtype: {am.get('contract_subtype') or '—'}",
            f"gap_ratio: {am.get('gap_ratio','?')}%  ·  eul_ratio: {am.get('eul_ratio','?')}%",
            f"risk_clauses_count: {len(am.get('risk_clauses') or [])}",
            "--- summary ---",
            (analysis.get("content") or "")[:500],
        ]
    return "\n".join(chunks)


def _parse_review_marker(reply: str) -> dict | None:
    m = _REVIEW_REQUEST_RE.search(reply)
    if not m:
        return None
    parsed: dict[str, str] = {}
    for line in m.group(1).strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            parsed[k.strip().lower()] = v.strip()
    return parsed if parsed.get("doc_id") else None


def _strip_review_marker(reply: str) -> str:
    return _REVIEW_REQUEST_RE.sub("", reply).strip()


def _format_review_append(result: dict) -> str:
    lines = [
        "",
        "---",
        f"**공정성 분석 결과** · 갑 **{result['gap_ratio']}%** / 을 **{result['eul_ratio']}%**",
        "",
        result.get("summary") or "",
    ]
    risks = result.get("risk_clauses") or []
    if risks:
        lines += ["", f"**주요 위험 조항 ({len(risks)}건)**"]
        for i, c in enumerate(risks[:5], 1):
            sev = c.get("severity", "Mid")
            lines.append(f"{i}. [{sev}] {c.get('clause','')[:80]}")
            if c.get("reason"):
                lines.append(f"   - 사유: {c['reason'][:150]}")
            if c.get("suggestion_from") and c.get("suggestion_to"):
                lines.append(f"   - 수정: `{c['suggestion_from'][:60]}` → `{c['suggestion_to'][:80]}`")
        if len(risks) > 5:
            lines.append(f"... 외 {len(risks) - 5}건 (분석 노드에서 전체 확인)")
    lines.append("")
    lines.append(f"_(분석 artifact: `{result['analysis_id']}` — 캔버스에서 확인할 수 있어요.)_")
    payload = {
        "analysis_id": result["analysis_id"],
        "gap_ratio":   result["gap_ratio"],
        "eul_ratio":   result["eul_ratio"],
        "summary":     result.get("summary") or "",
        "risk_clauses": result.get("risk_clauses") or [],
    }
    lines.append(f"[[REVIEW_JSON]]{json.dumps(payload, ensure_ascii=False)}[[/REVIEW_JSON]]")
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# LangGraph state
# ──────────────────────────────────────────────────────────────────────────

DocCategory = Literal["review", "tax_hr", "legal", "operations"]
DocIntent = Literal[
    "legal",            # 법률 자문 → _legal_node
    "review",           # 업로드 문서 공정성 분석 → _review_node
    "write_review",     # 계약서·제안서 작성 → _write_review_node
    "write_tax_hr",     # 세무·인사평가·체크리스트·가이드 → _write_tax_hr_node
    "write_operations", # 견적서·공지문·지원사업·행정 → _write_operations_node
    "ask_category",     # 카테고리 불명 → _ask_category_node (4-category CHOICES)
]


class DocState(TypedDict):
    message: str
    account_id: str
    history: list[dict]
    rag_context: str
    long_term_context: str
    # set by classify node
    intent: DocIntent
    category: DocCategory | None
    uploaded_doc: dict | None
    # output
    reply: str


# 카테고리별 system prompt 추가 블록 — write 경로에서 사용.
# Planner 가 capability 레벨에서 이미 톤을 결정했더라도, legacy 폴백·직접 run() 호출 시
# 이 블록이 에이전트의 톤과 타입 CHOICES 를 4카테고리 축으로 고정해준다.
_CATEGORY_GUIDANCE: dict[str, str] = {
    "review": """\
[카테고리: Review — 공정 중립이 필요한 서류]
이 카테고리는 계약서·제안서처럼 양측(갑/을, 발주자/수주자) 이익이 맞물린 서류를 다룹니다.
- 작성 시 한쪽이 현저히 불리하지 않도록 관행·법령 기준의 표준 조항을 활용하세요.
- contract 은 갑/을 지칭이 필요하므로 `[CHOICES]` 로 역할을 먼저 확정.
- type 이 아직 모호하면 아래 CHOICES 로 먼저 물어보세요:
  [CHOICES]
  계약서 (양측 간 법적 구속력)
  제안서 (제안·협상 단계)
  [/CHOICES]
- 저장 시 `sub_domain: Review`.
""",
    "tax_hr": """\
[카테고리: Tax&HR — 세무·급여 문서 (채용 제외)]
이 카테고리는 세무 신고·4대보험·급여 관련 문서를 다룹니다.
- 지원 타입: checklist(체크리스트), guide(가이드/매뉴얼),
  payroll_doc(급여명세서·원천징수영수증·4대보험신고서), tax_calendar(세무 캘린더).
- 급여명세서(payroll_doc)는 엑셀 파일로 자동 생성됩니다.
- 프로필의 직원 수·업종 정보가 있으면 적극 활용. 없으면 CHOICES 로 좁혀가세요.
- **채용(모집·공고·면접)은 recruitment 도메인 소관**이므로 이 카테고리에서 다루지 마세요.
- type 이 모호하면:
  [CHOICES]
  체크리스트 (단계별 확인 항목)
  가이드 (절차·원칙 안내문)
  급여명세서 (엑셀 자동생성)
  세무 캘린더
  [/CHOICES]
- 저장 시 `sub_domain: Tax&HR`.
""",
    "operations": """\
[카테고리: Operations — 서류 초안·행정 업무]
이 카테고리는 견적서·공지문·국가 지원사업 신청서·행정 처리 신청서 등 일상 서류 초안 작성을 담당합니다.
- 현재 지원 타입: estimate(견적서), notice(공지문), subsidy_recommendation(지원사업 추천),
  admin_application(행정 신청서 — 사업자등록 신청서·통신판매업 신고서·구매안전서비스 비적용 확인서).
- 마감·게시 일자가 있는 서류는 `due_date` + `due_label` 반드시 포함.
- type 이 모호하면:
  [CHOICES]
  견적서 (품목·단가·유효기간)
  공지문 (대상·일정·내용)
  [/CHOICES]
- 저장 시 `sub_domain: Operations`.
""",
    # legal 은 `_legal_node` 경로에서 별도 처리되므로 write 에 주입되지 않지만,
    # 형식상 키를 포함해둔다.
    "legal": "",
}


# ──────────────────────────────────────────────────────────────────────────
# Graph nodes
# ──────────────────────────────────────────────────────────────────────────

async def _classify_node(state: DocState) -> DocState:
    """intent 분류 (v1.3 2단 라우터).

    1. 업로드된 문서 있음 → review (기존 공정성 분석)
    2. type 잡힘 → TYPE_TO_CATEGORY 로 write_<category>
    3. type 없음 + legal 의도 → legal
    4. type 없음 + category 키워드 잡힘 → write_<category>
    5. 둘 다 없음 → ask_category (4-카테고리 CHOICES)

    동시 감지는 하되 타입이 잡히면 타입을 우선한다. (사용자 지시: Q2)
    """
    message = state["message"]
    account_id = state["account_id"]
    history = state["history"]

    uploaded_doc = _find_recent_uploaded_doc(account_id)
    if uploaded_doc:
        log.info(
            "[documents/graph] classify → review (account=%s doc=%s)",
            account_id, uploaded_doc.get("id") or "ephemeral",
        )
        return {
            **state,
            "intent": "review",
            "category": "review",
            "uploaded_doc": uploaded_doc,
        }

    # type + category 동시 감지 — 타입 우선
    type_guess, _ = detect_doc_intent(message)
    category: str | None = None
    if type_guess:
        category = TYPE_TO_CATEGORY.get(type_guess)

    # type 이 안 잡힌 경우에만 legal / category 키워드 분기
    if not type_guess:
        intent_obj = await classify_legal_intent(message, history)
        if intent_obj.is_legal:
            log.info("[documents/graph] classify → legal (account=%s)", account_id)
            return {
                **state,
                "intent": "legal",
                "category": "legal",
                "uploaded_doc": None,
            }
        category = detect_doc_category(message)

    # 분기 매핑
    intent: DocIntent
    if category == "review":
        intent = "write_review"
    elif category == "tax_hr":
        intent = "write_tax_hr"
    elif category == "operations":
        intent = "write_operations"
    elif category == "legal":
        log.info("[documents/graph] classify → legal (via category kw) (account=%s)", account_id)
        return {
            **state,
            "intent": "legal",
            "category": "legal",
            "uploaded_doc": None,
        }
    else:
        intent = "ask_category"

    log.info(
        "[documents/graph] classify → %s (account=%s type=%s category=%s)",
        intent, account_id, type_guess, category,
    )
    return {
        **state,
        "intent": intent,
        "category": category if category in ("review", "tax_hr", "operations") else None,
        "uploaded_doc": None,
    }


async def _legal_node(state: DocState) -> DocState:
    """법률 질의 처리."""
    reply = await handle_legal_question(
        state["message"],
        state["account_id"],
        state["history"],
        rag_context=state["rag_context"],
        long_term_context=state["long_term_context"],
    )
    return {**state, "reply": reply}


_REVIEW_NODE_EXTRA = """
[공정성 분석 노드 전용 규칙 — 반드시 준수]
- 이 노드의 유일한 임무는 역할(갑/을/미지정)과 서브타입을 확정한 뒤 [REVIEW_REQUEST] 마커를 출력하는 것입니다.
- **분석 결과(갑/을 비율, 위험 조항 목록, 요약 텍스트)를 직접 생성하는 것은 절대 금지**입니다.
  실제 분석은 시스템이 [REVIEW_REQUEST] 마커를 처리한 후 자동으로 수행합니다.
- 역할이 아직 불명확하면 [CHOICES] 로 한 번만 물어보고, 역할이 확정되면 즉시 [REVIEW_REQUEST] 블록을 출력하세요.
- 분석 결과처럼 보이는 문장("갑의 비율은 N%", "위험 조항 X건" 등)을 생성하면 시스템이 무효 처리합니다.
"""

_ANALYSIS_HALLUCINATION_SIGNALS = (
    "갑의 비율", "을의 비율", "갑 비율", "을 비율",
    "위험 조항", "불리한 조건", "손해 비율", "갑에게 불리", "을에게 불리",
    "공정성 분석 결과", "분석 완료", "분석 결과에 따르면",
)


def _looks_like_hallucinated_analysis(reply: str) -> bool:
    """LLM이 마커 없이 분석 결과를 직접 생성했는지 휴리스틱 감지."""
    low = reply.lower()
    hits = sum(1 for sig in _ANALYSIS_HALLUCINATION_SIGNALS if sig in low)
    return hits >= 2


def _infer_user_role_from_context(message: str, history: list[dict]) -> str:
    """메시지·히스토리에서 갑/을 역할 키워드를 추출. 불명확하면 '미지정'."""
    combined = message + " " + " ".join(h.get("content") or "" for h in history[-6:])
    low = combined.lower()
    if any(k in low for k in ("고용인", "발주자", "임대인", "사용자", "갑")):
        return "갑"
    if any(k in low for k in ("피고용인", "수주자", "임차인", "근로자", "을")):
        return "을"
    return "미지정"


async def _review_node(state: DocState) -> DocState:
    """업로드된 문서 공정성 분석 처리.

    LLM이 [REVIEW_REQUEST] 마커를 출력하면 dispatch_review 실행.
    마커 없이 분석을 hallucination 하면 역할 추론 후 강제 dispatch.
    역할이 미확정이면 CHOICES 응답 반환.
    """
    account_id = state["account_id"]
    uploaded_doc = state["uploaded_doc"]
    # 분석 대기 중 — 이전 분석 결과를 context에 주입하지 않음
    upload_ctx = _build_upload_context(uploaded_doc, account_id, include_analysis=False)

    hubs = list_sub_hub_titles(account_id, "documents")
    system = SYSTEM_PROMPT + _REVIEW_NODE_EXTRA + "\n\n" + today_context()
    if upload_ctx:
        system += "\n\n" + upload_ctx
    if hubs:
        system += "\n\n[이 계정의 documents 서브허브]\n- " + "\n- ".join(hubs)
    if state["long_term_context"]:
        system += f"\n\n[사용자 장기 기억]\n{state['long_term_context']}"
    if state["rag_context"]:
        system += f"\n\n{state['rag_context']}"
    fb = feedback_context(account_id, "documents")
    if fb:
        system += f"\n\n{fb}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *state["history"],
            {"role": "user", "content": state["message"]},
        ],
    )
    reply = resp.choices[0].message.content or ""

    marker = _parse_review_marker(reply)

    # LLM이 마커 없이 분석을 직접 생성한 경우 → 강제 dispatch
    if not marker and _looks_like_hallucinated_analysis(reply):
        log.warning(
            "[documents/graph] hallucinated analysis detected (account=%s doc=%s) — force dispatch",
            account_id, uploaded_doc.get("id") or "ephemeral",
        )
        user_role = _infer_user_role_from_context(state["message"], state["history"])
        marker = {
            "doc_id": uploaded_doc.get("id") or "ephemeral",
            "user_role": user_role,
            "doc_type": "계약서",
            "contract_subtype": None,
        }
        reply = ""  # hallucinated text 버림

    if not marker:
        # 역할 미확정 — CHOICES 응답 그대로 반환
        return {**state, "reply": reply}

    doc_id = marker["doc_id"]
    user_role = marker.get("user_role") or "미지정"
    if user_role not in ("갑", "을", "미지정"):
        user_role = "미지정"
    doc_type = marker.get("doc_type") or "계약서"
    if doc_type not in ("계약서", "제안서", "견적서", "기타"):
        doc_type = "계약서"
    subtype = marker.get("contract_subtype") or None
    if subtype in ("", "없음"):
        subtype = None

    cleaned = _strip_review_marker(reply)
    # ephemeral (upload_payload) 경로 vs legacy DB artifact 경로 분기
    dispatch_kwargs: dict = {
        "account_id":        account_id,
        "user_role":         user_role,
        "doc_type":          doc_type,
        "contract_subtype":  subtype,
    }
    if uploaded_doc.get("_ephemeral") or not uploaded_doc.get("id"):
        dispatch_kwargs["ephemeral_doc"] = uploaded_doc
    else:
        dispatch_kwargs["doc_artifact_id"] = doc_id
    try:
        result = await dispatch_review(**dispatch_kwargs)
        final = cleaned + _format_review_append(result)
    except InvalidDocumentError as e:
        final = cleaned + f"\n\n---\n_(분석 실패: {e} — 비즈니스 문서가 맞는지 확인해주세요.)_"
    except ValueError as e:
        final = cleaned + f"\n\n---\n_(분석 실패: {e})_"
    except Exception:
        log.exception("[documents/graph] review dispatch failed")
        final = cleaned + "\n\n---\n_(분석 중 예기치 못한 오류가 발생했어요. 잠시 후 다시 시도해주세요.)_"

    return {**state, "reply": final}


async def _run_write(state: DocState, category: DocCategory) -> DocState:
    """카테고리 공통 서류 작성 — system prompt 의 category guidance 블록만 다름.

    Review/Tax&HR/Operations 세 write 노드가 공유하는 실제 로직.
    Legal 은 `_legal_node` 에서 별도 처리되므로 여기 오지 않는다.
    """
    account_id = state["account_id"]
    message = state["message"]

    type_guess, subtype_guess = detect_doc_intent(message)
    if not type_guess:
        for h in reversed(state["history"][-6:]):
            if h.get("role") == "user":
                t2, s2 = detect_doc_intent(h.get("content") or "")
                if t2:
                    type_guess, subtype_guess = t2, s2
                    break

    doc_ctx = build_doc_context(type_guess, subtype_guess)
    cat_block = _CATEGORY_GUIDANCE.get(category, "")
    hubs = list_sub_hub_titles(account_id, "documents")
    system = SYSTEM_PROMPT + "\n\n" + today_context()
    if cat_block:
        system += "\n\n" + cat_block
    system += "\n\n" + doc_ctx
    if hubs:
        system += "\n\n[이 계정의 documents 서브허브]\n- " + "\n- ".join(hubs)
    # 분석 결과 후속 질문 대응 — 이전 분석 context 를 write 노드에서만 주입
    analysis = _find_recent_analysis(account_id)
    if analysis:
        am = analysis.get("metadata") or {}
        prev_analysis_ctx = "\n".join([
            "[최근 분석 결과]",
            f"analysis_id: {analysis['id']}",
            f"user_role: {am.get('user_role','미지정')}  ·  contract_subtype: {am.get('contract_subtype') or '—'}",
            f"gap_ratio: {am.get('gap_ratio','?')}%  ·  eul_ratio: {am.get('eul_ratio','?')}%",
            f"risk_clauses_count: {len(am.get('risk_clauses') or [])}",
            "--- summary ---",
            (analysis.get("content") or "")[:500],
        ])
        system += "\n\n" + prev_analysis_ctx
    if state["long_term_context"]:
        system += f"\n\n[사용자 장기 기억]\n{state['long_term_context']}"
    if state["rag_context"]:
        system += f"\n\n{state['rag_context']}"
    fb = feedback_context(account_id, "documents")
    if fb:
        system += f"\n\n{fb}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *state["history"],
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content or ""

    await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title="서류",
        valid_types=VALID_TYPES,
        extra_meta_keys=("due_label", "contract_subtype"),
        subtype_whitelist={"contract_subtype": VALID_CONTRACT_SUBTYPES},
        type_to_subhub=_TYPE_TO_SUBHUB,
    )
    return {**state, "reply": reply}


async def _write_review_node(state: DocState) -> DocState:
    return await _run_write(state, "review")


async def _write_tax_hr_node(state: DocState) -> DocState:
    return await _run_write(state, "tax_hr")


async def _write_operations_node(state: DocState) -> DocState:
    return await _run_write(state, "operations")


async def _ask_category_node(state: DocState) -> DocState:
    """카테고리 모호 — 4-category CHOICES 를 즉시 반환 (LLM 호출 없음).

    사용자가 선택한 라벨은 다음 턴 message 로 들어와서 `detect_doc_category`
    또는 `detect_doc_intent` 가 재판정한다 (라벨에 "계약서/세무/법률 자문/견적서"
    등 대표 키워드 포함).
    """
    lines = [
        "어떤 도움이 필요하신가요? 아래 네 가지 중에서 골라주세요.",
        "",
        "[CHOICES]",
        CATEGORY_LABELS["review"],
        CATEGORY_LABELS["tax_hr"],
        CATEGORY_LABELS["legal"],
        CATEGORY_LABELS["operations"],
        "[/CHOICES]",
    ]
    return {**state, "reply": "\n".join(lines)}


def _route_intent(state: DocState) -> DocIntent:
    return state["intent"]


# ──────────────────────────────────────────────────────────────────────────
# Build graph
# ──────────────────────────────────────────────────────────────────────────

def _build_graph():
    g = StateGraph(DocState)
    g.add_node("classify", _classify_node)
    g.add_node("legal", _legal_node)
    g.add_node("review", _review_node)
    g.add_node("write_review", _write_review_node)
    g.add_node("write_tax_hr", _write_tax_hr_node)
    g.add_node("write_operations", _write_operations_node)
    g.add_node("ask_category", _ask_category_node)
    g.set_entry_point("classify")
    g.add_conditional_edges("classify", _route_intent, {
        "legal":            "legal",
        "review":           "review",
        "write_review":     "write_review",
        "write_tax_hr":     "write_tax_hr",
        "write_operations": "write_operations",
        "ask_category":     "ask_category",
    })
    g.add_edge("legal", END)
    g.add_edge("review", END)
    g.add_edge("write_review", END)
    g.add_edge("write_tax_hr", END)
    g.add_edge("write_operations", END)
    g.add_edge("ask_category", END)
    return g.compile()


_graph = _build_graph()


# ──────────────────────────────────────────────────────────────────────────
# Public entrypoints
# ──────────────────────────────────────────────────────────────────────────

async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    initial: DocState = {
        "message": message,
        "account_id": account_id,
        "history": history,
        "rag_context": rag_context,
        "long_term_context": long_term_context,
        "intent": "ask_category",  # classify_node 가 반드시 덮어쓴다
        "category": None,
        "uploaded_doc": None,
        "reply": "",
    }
    result = await _graph.ainvoke(initial)
    return result["reply"]


async def run_contract(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    subtype: str,
    party_a: str,
    party_b: str,
    amount: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    extra_note: str | None = None,
) -> str:
    if subtype not in VALID_CONTRACT_SUBTYPES:
        subtype = "service"
    lines = [f"[subtype] {subtype}", f"[갑] {party_a}", f"[을] {party_b}"]
    if amount:
        lines.append(f"[금액/조건] {amount}")
    if start_date:
        lines.append(f"[시작일] {start_date}")
    if end_date:
        lines.append(f"[종료일] {end_date}")
    if extra_note:
        lines.append(f"[특이사항] {extra_note}")
    synthetic = (
        f"{subtype} 계약서 초안을 작성해주세요. 아래 조건이 모두 확정되었으니 "
        "추가 질문 없이 바로 [ARTIFACT] 블록(type=contract, contract_subtype 포함) + 본문을 출력하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_estimate(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    client: str,
    items: str | None = None,
    total_amount: str | None = None,
    valid_until: str | None = None,
) -> str:
    lines = [f"[발주처] {client}"]
    if items:
        lines.append(f"[품목] {items}")
    if total_amount:
        lines.append(f"[총액] {total_amount}")
    if valid_until:
        lines.append(f"[유효기간] {valid_until}")
    synthetic = (
        "견적서 초안을 작성해주세요. [ARTIFACT] 블록(type=estimate, due_date=유효기간, due_label='견적 유효기간') 포함.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_proposal(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    client: str,
    scope: str | None = None,
    amount: str | None = None,
    reply_by: str | None = None,
) -> str:
    lines = [f"[제안 대상] {client}"]
    if scope:
        lines.append(f"[제안 범위] {scope}")
    if amount:
        lines.append(f"[제안가] {amount}")
    if reply_by:
        lines.append(f"[회신 기한] {reply_by}")
    synthetic = (
        "제안서 초안을 작성해주세요. [ARTIFACT] 블록(type=proposal, due_date=회신기한, due_label='제안 회신 기한') 포함.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_notice(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    audience: str,
    topic: str,
    post_date: str | None = None,
) -> str:
    lines = [f"[대상] {audience}", f"[주제] {topic}"]
    if post_date:
        lines.append(f"[게시일] {post_date}")
    synthetic = (
        "공지문을 작성해주세요. [ARTIFACT] 블록(type=notice, due_date=게시일, due_label='공지 게시일') 포함.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_checklist_guide(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    topic: str,
    kind: str = "checklist",
) -> str:
    """체크리스트·가이드 작성 — 연말정산 특화 지식 주입."""
    artifact_type = "checklist" if kind == "checklist" else "guide"

    knowledge = ""
    if any(k in topic for k in ("연말정산", "year-end", "연말 정산")):
        knowledge = _load_knowledge("year_end_checklist.md")

    sub_hub_list = await list_sub_hub_titles(account_id, "documents")
    feedback = await feedback_context(account_id, "documents")

    system = (
        SYSTEM_PROMPT
        + "\n\n"
        + _CATEGORY_GUIDANCE["tax_hr"]
        + f"\n\n[작업 지시]\n"
        f"'{topic}' 주제로 {kind} 문서를 작성하세요.\n"
        f"- 실용적·완결된 체크 항목으로 구성\n"
        f"- 법적 근거 있는 항목은 법조 명시\n"
        f"- 응답 마지막에 [ARTIFACT](type={artifact_type}, sub_domain=Tax&HR) 포함\n"
        + (f"\n\n[참조 지식]\n{knowledge}" if knowledge else "")
        + (f"\n\n[등록된 서브허브]\n{sub_hub_list}" if sub_hub_list else "")
        + today_context()
    )
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if feedback:
        system += f"\n\n[피드백]\n{feedback}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content or ""
    await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title=f"{topic} {kind}",
        valid_types=VALID_TYPES,
        type_to_subhub=_TYPE_TO_SUBHUB,
    )
    return reply


# ──────────────────────────────────────────────────────────────────────────
# Step 3-B — Operations: 지원사업 추천
# ──────────────────────────────────────────────────────────────────────────

async def run_subsidy_recommend(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    count: int = 1,
    confirm_deadline: bool = False,
    **kw,
) -> str:
    """사용자 프로필+메모리 기반 지원사업 추천.

    subsidy_programs DB 를 RRF 검색 → 활성 공고만 필터 → LLM 이
    각 공고에 대해 10점 만점 점수 + 매칭 이유 생성 → subsidy_recommendation artifact 저장.
    """
    import asyncio
    from datetime import date, timedelta
    from app.core.supabase import get_supabase
    from app.core.embedder import embed_text

    sb = get_supabase()

    # 마감 일정 추가 확인 경로
    if confirm_deadline:
        try:
            row = (
                sb.table("artifacts")
                .select("id,metadata")
                .eq("account_id", account_id)
                .eq("type", "subsidy_recommendation")
                .order("created_at", desc=True)
                .limit(1)
                .maybe_single()
                .execute()
            )
            artifact = row.data
        except Exception:
            artifact = None

        if artifact:
            meta = artifact.get("metadata") or {}
            candidate = meta.get("candidate_deadline")
            if candidate:
                try:
                    sb.table("artifacts").update(
                        {"metadata": {**meta, "due_date": candidate, "due_label": "지원사업 신청 마감"}}
                    ).eq("id", artifact["id"]).execute()
                except Exception:
                    pass
                return f"📅 신청 마감일 **{candidate}**을 일정에 추가했어요. 스케줄 카드에서 확인하실 수 있어요."
        return "일정에 추가할 마감일 정보를 찾지 못했어요. 지원사업 추천을 다시 요청해 보세요."

    # 프로필 조회
    try:
        profile_row = (
            sb.table("profiles")
            .select("business_type,location,business_stage,employees_count,primary_goal")
            .eq("id", account_id)
            .maybe_single()
            .execute()
        )
        profile = profile_row.data or {}
    except Exception:
        profile = {}

    # 프로필 핵심 필드 부족 시 폼 유도
    missing = [k for k in ("business_type", "location") if not profile.get(k)]
    if missing:
        return (
            "맞춤 추천을 위해 업종과 지역 정보가 필요해요. "
            "아래 폼을 채워주시면 바로 찾아드릴게요!\n\n"
            "[[ONBOARDING_FORM]]"
        )

    # 검색 쿼리: 메시지 + 프로필 + 장기 기억 일부
    query_parts = [message]
    if profile.get("business_type"):
        query_parts.append(profile["business_type"])
    if profile.get("location"):
        query_parts.append(profile["location"])
    if profile.get("business_stage"):
        query_parts.append(profile["business_stage"])
    if long_term_context:
        query_parts.append(long_term_context[:300])
    query = " ".join(p for p in query_parts if p)

    # search_subsidy_programs RPC (vector+FTS RRF)
    def _rpc_search(q: str, n: int) -> list[dict]:
        emb = embed_text(q)
        try:
            return (
                sb.rpc(
                    "search_subsidy_programs",
                    {"query_embedding": emb, "query_text": q, "match_count": n},
                )
                .execute()
                .data or []
            )
        except Exception:
            return []

    try:
        raw_rows = await asyncio.to_thread(_rpc_search, query, count * 6)
    except Exception:
        raw_rows = []

    today = date.today()
    cutoff = today + timedelta(days=7)

    def _visible(p: dict) -> bool:
        if p.get("is_ongoing"):
            return True
        end = p.get("end_date")
        if end:
            try:
                if date.fromisoformat(end) < today:
                    return False
            except ValueError:
                pass
        start = p.get("start_date")
        if start:
            try:
                if date.fromisoformat(start) > cutoff:
                    return False
            except ValueError:
                pass
        return True

    programs: list[dict] = []
    if raw_rows:
        row_ids = [r["row_id"] for r in raw_rows]
        score_map = {r["row_id"]: r.get("score", 0.0) for r in raw_rows}
        try:
            detail_result = (
                sb.table("subsidy_programs")
                .select(
                    "id,title,organization,region,program_kind,"
                    "start_date,end_date,period_raw,is_ongoing,"
                    "description,detail_url,form_files"
                )
                .in_("id", row_ids)
                .execute()
            )
            details = detail_result.data or []
        except Exception:
            details = []

        for d in details:
            d["_score"] = score_map.get(d["id"], 0.0)
        details.sort(key=lambda x: x["_score"], reverse=True)
        programs = [p for p in details if _visible(p)][:20]  # LLM에 최대 20개 후보 전달

    if not programs:
        return (
            "현재 조건에 맞는 활성 지원사업을 찾지 못했어요. "
            "지원사업 모달에서 직접 검색해보시거나, 업종·지역 프로필을 설정하시면 더 정확한 추천이 가능해요."
        )

    # 공고 후보 블록 조립
    prog_blocks: list[str] = []
    for i, p in enumerate(programs, 1):
        if p.get("is_ongoing"):
            period = "상시 모집"
        elif p.get("start_date") and p.get("end_date"):
            period = f"{p['start_date']} ~ {p['end_date']}"
        elif p.get("end_date"):
            period = f"~ {p['end_date']}"
        else:
            period = p.get("period_raw") or "기간 미정"

        url = p.get("external_url") or p.get("detail_url") or ""
        prog_blocks.append(
            f"[후보 {i}]\n"
            f"  공고명: {p['title']}\n"
            f"  주관기관: {p.get('organization') or '미상'}\n"
            f"  지역: {p.get('region') or '전국'}\n"
            f"  지원기간: {period}\n"
            f"  내용: {(p.get('description') or '')[:300]}\n"
            f"  공고URL: {url or '없음'}"
        )

    profile_block = (
        f"업종: {profile.get('business_type') or '미상'} | "
        f"지역: {profile.get('location') or '미상'} | "
        f"단계: {profile.get('business_stage') or '미상'} | "
        f"직원: {profile.get('employees_count') or '미상'}"
    )

    system_prompt = (
        "당신은 소상공인 전문 어시스턴트입니다.\n"
        "아래 후보 공고들 중 사용자 프로필에 실제로 적합한 것만 골라 추천하세요.\n\n"
        "규칙:\n"
        "- 업종·지역·사업 단계와 무관한 공고는 절대 포함하지 말고 무시하세요.\n"
        "- 적합한 공고가 없으면 왜 맞는 공고가 없는지 이유를 1~2문장으로 친절하게 설명하고, "
        "어떤 조건이 갖춰지면 추천이 가능한지 간단히 안내하세요. 이 경우 [ARTIFACT] 블록을 절대 포함하지 마세요.\n"
        "- 가장 적합한 공고 1개만 추천하세요.\n"
        "- 각 추천 항목 형식:\n"
        "  **공고명**\n"
        "  주관기관 | 신청기간\n"
        "  추천 이유: (업종·지역 연결 1~2문장)\n"
        "  공고URL이 있으면 반드시 마지막에 [공고 보러 가기](URL) 형식으로 링크를 포함하세요.\n\n"
        "- 점수, 등급, 수치 평가는 절대 쓰지 마세요.\n"
        "- [ARTIFACT] 블록에 start_date/end_date/due_date 를 포함하지 마세요.\n"
        "- 응답 마지막에 반드시 아래 [ARTIFACT] 블록을 추가하세요:\n"
        "[ARTIFACT]\ntype: subsidy_recommendation\ntitle: 지원사업 추천\n"
        "content: <추천된 공고명 요약>\n[/ARTIFACT]\n\n"
        f"[사용자 프로필]\n{profile_block}\n\n"
        f"[후보 공고 목록]\n" + "\n\n".join(prog_blocks)
    )

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ],
        model="gpt-4o",
    )
    reply = resp.choices[0].message.content or ""
    artifact_id = await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title="지원사업 추천",
        valid_types=tuple(VALID_TYPES),
        type_to_subhub=_TYPE_TO_SUBHUB,
    )

    # 추천 성공 시 마감일을 candidate_deadline 으로 저장 (사용자 확인 후 due_date 로 이동)
    actually_recommended = "[ARTIFACT]" in reply and "찾지 못" not in reply and "없습니다" not in reply[:200]
    if actually_recommended and artifact_id:
        deadline = next(
            (p.get("end_date") for p in programs if p.get("end_date") and not p.get("is_ongoing")),
            None,
        )
        if deadline:
            try:
                sb.table("artifacts").update(
                    {"metadata": {"candidate_deadline": deadline}}
                ).eq("id", artifact_id).execute()
            except Exception:
                pass
            reply += (
                f"\n\n📅 신청 마감일은 **{deadline}**이에요. 일정에 추가할까요?\n"
                "[CHOICES]\n마감 일정 추가\n아니요\n[/CHOICES]"
            )
    return reply


async def run_admin_application(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    application_type: str,
    purpose: str = "",
    extra_note: str | None = None,
) -> str:
    """행정 신청서 초안 — 프로필 자동 채움 + 양식 모사 마크다운."""
    from datetime import date

    # application_type 정규화 — enum 외 값이면 사용자 메시지에서 추론
    if application_type not in VALID_ADMIN_TYPES:
        msg_lower = (message + " " + application_type).lower()
        if any(k in msg_lower for k in ("통신판매업", "전자상거래 신고")):
            application_type = "mail_order_registration"
        elif any(k in msg_lower for k in ("구매안전", "비적용")):
            application_type = "purchase_safety_exempt"
        else:
            application_type = "business_registration"

    sb = get_supabase()

    # 프로필 조회 (신규 컬럼 포함 전체)
    try:
        profile_row = (
            sb.table("profiles")
            .select(
                "display_name,business_name,business_type,location,employees_count,"
                "business_reg_no,phone_mobile,phone_business,email,"
                "opening_date,business_form,industry_code,profile_meta"
            )
            .eq("id", account_id)
            .maybe_single()
            .execute()
        )
        profile = profile_row.data or {}
    except Exception:
        profile = {}

    profile_meta: dict = profile.pop("profile_meta", None) or {}

    # opening_date: date → str 변환
    if profile.get("opening_date"):
        try:
            od = profile["opening_date"]
            if hasattr(od, "isoformat"):
                profile["opening_date"] = od.isoformat()
        except Exception:
            pass

    admin_ctx = build_admin_context(application_type, profile, profile_meta)
    label = ADMIN_TYPE_LABELS.get(application_type, application_type)
    due_days = ADMIN_TYPE_DUE_DAYS.get(application_type, 7)
    due_label = ADMIN_TYPE_DUE_LABELS.get(application_type, "행정 처리 기한")
    due_date = (date.today() + timedelta(days=due_days)).isoformat()

    extra_parts: list[str] = []
    if purpose:
        extra_parts.append(f"[신청 목적] {purpose}")
    if extra_note:
        extra_parts.append(f"[특이사항] {extra_note}")

    system = (
        SYSTEM_PROMPT
        + "\n\n"
        + _CATEGORY_GUIDANCE["operations"]
        + f"\n\n[작업 지시]\n"
        f"아래 양식 지식자산과 프로필 데이터를 사용해 '{label}' 초안을 작성하세요.\n"
        f"- 양식 구조(표·체크박스·섹션)를 그대로 유지하세요.\n"
        f"- 프로필 값이 있는 placeholder 는 실제 값으로 교체하세요.\n"
        f"- 값이 없는 placeholder 는 {{{{...}}}} 형태로 유지하세요.\n"
        f"- 주민등록번호·법인등록번호는 절대 생성하지 마세요.\n"
        f"- 응답 마지막에 아래 [ARTIFACT] 블록을 반드시 포함하세요:\n"
        f"  [ARTIFACT]\n"
        f"  type: admin_application\n"
        f"  title: {label}\n"
        f"  sub_domain: Operations\n"
        f"  due_date: {due_date}\n"
        f"  due_label: {due_label}\n"
        f"  [/ARTIFACT]\n"
        + "\n\n"
        + admin_ctx
        + "\n\n"
        + today_context()
    )
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"

    user_content = message
    if extra_parts:
        user_content = "\n".join(extra_parts) + f"\n\n원본 요청: {message}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": user_content},
        ],
    )
    reply = resp.choices[0].message.content or ""

    await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title=label,
        valid_types=VALID_TYPES,
        extra_meta_keys=("due_label",),
        type_to_subhub=_TYPE_TO_SUBHUB,
    )
    return reply


# ──────────────────────────────────────────────────────────────────────────
# Step 3-A — Tax&HR 신규 3종
# ──────────────────────────────────────────────────────────────────────────

async def run_hr_evaluation(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    evaluatee: str,
    period: str,
    metrics: list[str] | None = None,
    evaluation_type: str = "연간",
) -> str:
    """인사평가서 — 프로필 + 지식 파일 주입, LLM 직접 호출."""
    sb = get_supabase()
    try:
        profile_row = (
            sb.table("profiles")
            .select("business_type,employees_count,business_name")
            .eq("id", account_id)
            .maybe_single()
            .execute()
        )
        profile = profile_row.data or {}
    except Exception:
        profile = {}

    knowledge = _load_knowledge("hr_evaluation_guide.md")
    sub_hub_list = await list_sub_hub_titles(account_id, "documents")
    feedback = await feedback_context(account_id, "documents")

    metrics_line = ", ".join(metrics) if metrics else "업무 성과·태도·고객 응대·팀워크·성장 의지"
    biz_type = profile.get("business_type") or "소매/서비스업"
    emp_count = profile.get("employees_count")

    system = (
        SYSTEM_PROMPT
        + "\n\n"
        + _CATEGORY_GUIDANCE["tax_hr"]
        + "\n\n[작업 지시]\n"
        f"아래 조건으로 인사평가서를 작성하세요.\n"
        f"- 평가 대상: {evaluatee}\n"
        f"- 평가 기간: {period} ({evaluation_type})\n"
        f"- 평가 지표: {metrics_line}\n"
        f"- 업종: {biz_type}"
        + (f" | 직원수: {emp_count}명" if emp_count else "")
        + "\n\n작성 규칙:\n"
        "1. 지표별 5점 척도 표 (항목 | 점수 | 평가 근거)\n"
        "2. 종합 등급(S/A/B/C/D) + 코멘트 3~5줄\n"
        "3. 서명·날짜 란 포함\n"
        "4. 법적 보관 의무 안내 (3년, 근로기준법 §42)\n"
        f"5. 응답 마지막에 [ARTIFACT](type=hr_evaluation, sub_domain=Tax&HR, title={evaluatee} 인사평가서 {period}) 포함\n"
        + (f"\n\n[인사평가 기준 자료]\n{knowledge}" if knowledge else "")
        + (f"\n\n[등록된 서브허브]\n{sub_hub_list}" if sub_hub_list else "")
        + today_context()
    )
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if feedback:
        system += f"\n\n[피드백]\n{feedback}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content or ""
    await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title=f"{evaluatee} 인사평가서 {period}",
        valid_types=VALID_TYPES,
        type_to_subhub=_TYPE_TO_SUBHUB,
    )
    return reply


async def run_payroll_doc(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    doc_kind: str,
    target: str,
    pay_month: str,
    extra_note: str | None = None,
) -> str:
    """급여명세서(Excel 자동생성) · 원천징수영수증 · 4대보험신고서 초안."""
    import asyncio as _asyncio
    from app.agents._payroll_excel import generate_payroll_excel

    _PAYROLL_SLIP_KEYWORDS = ("급여명세서", "임금명세서", "급여 명세서", "임금 명세서")
    is_payslip = any(k in doc_kind for k in _PAYROLL_SLIP_KEYWORDS)

    sb = get_supabase()

    # ── 원천징수영수증 / 4대보험 신고서 → LLM 마크다운 ──
    if not is_payslip:
        knowledge = _load_knowledge("tax_calendar_2026.md")
        sub_hub_list = await list_sub_hub_titles(account_id, "documents")
        feedback = await feedback_context(account_id, "documents")
        user_msg = message
        if extra_note:
            user_msg = f"[특이사항] {extra_note}\n\n{message}"
        system = (
            SYSTEM_PROMPT
            + "\n\n"
            + _CATEGORY_GUIDANCE["tax_hr"]
            + f"\n\n[작업 지시]\n"
            f"'{doc_kind}' 문서를 작성하세요. 대상자: {target}, 기간: {pay_month}.\n"
            f"2026년 기준 4대보험 요율·소득세 간이세액표를 적용하고, 신고 전 재확인 안내 포함.\n"
            f"응답 마지막에 [ARTIFACT](type=payroll_doc, sub_domain=Tax&HR) 포함.\n"
            + (f"\n\n[세무 기준 자료]\n{knowledge}" if knowledge else "")
            + (f"\n\n[등록된 서브허브]\n{sub_hub_list}" if sub_hub_list else "")
            + today_context()
        )
        if long_term_context:
            system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
        if feedback:
            system += f"\n\n[피드백]\n{feedback}"
        resp = await chat_completion(
            messages=[{"role": "system", "content": system}, *history, {"role": "user", "content": user_msg}],
        )
        reply = resp.choices[0].message.content or ""
        await save_artifact_from_reply(
            account_id, "documents", reply,
            default_title=f"{doc_kind} — {target}",
            valid_types=VALID_TYPES,
            type_to_subhub=_TYPE_TO_SUBHUB,
        )
        return reply

    # ── 급여명세서 — Excel 자동생성 경로 ──

    import asyncio as _asyncio
    from app.agents._payroll_excel import generate_payroll_excel

    _PREVIEW_MARKER = "[PAYROLL_PREVIEW_DATA:"

    # ── Path A: Recruitment 미리보기에서 확정된 계산 결과 재사용 ──
    preview_data: dict | None = None
    for h in reversed(history or []):
        content = h.get("content", "") if isinstance(h, dict) else ""
        if _PREVIEW_MARKER in content:
            try:
                idx = content.index(_PREVIEW_MARKER) + len(_PREVIEW_MARKER)
                depth = 0
                end = -1
                for i in range(idx, len(content)):
                    if content[i] == "{":
                        depth += 1
                    elif content[i] == "}":
                        depth -= 1
                        if depth == 0:
                            end = i
                            break
                if end != -1:
                    preview_data = json.loads(content[idx:end + 1])
            except Exception:
                pass
            break

    if preview_data:
        emp_name = preview_data.get("employee_name", target)
        confirmed_month = preview_data.get("pay_month", pay_month)
        pay_day_num = preview_data.get("pay_day", 25)
        emp_type = preview_data.get("employment_type", "시급제")

        payroll_data = {
            "name": emp_name,
            "employment_type": emp_type,
            "pay_date": f"{confirmed_month}-{int(pay_day_num):02d}",
            "hourly_rate": preview_data.get("hourly_rate", 0),
            "hours_worked": preview_data.get("hours_worked", 0),
            "base_pay": preview_data.get("base_pay", 0),
            "overtime_hours": preview_data.get("overtime_hours", 0),
            "overtime_pay": preview_data.get("overtime_pay", 0),
            "night_hours": preview_data.get("night_hours", 0),
            "night_pay": preview_data.get("night_pay", 0),
            "holiday_hours": preview_data.get("holiday_hours", 0),
            "holiday_pay": preview_data.get("holiday_pay", 0),
            "meal_allowance": preview_data.get("meal_allowance", 0),
            "family_allowance": 0,
            "income_tax": preview_data.get("income_tax", 0),
            "local_income_tax": preview_data.get("local_income_tax", 0),
            "national_pension": preview_data.get("national_pension", 0),
            "health_insurance": preview_data.get("health_insurance", 0),
            "ltc_insurance": preview_data.get("ltc_insurance", 0),
            "employment_insurance": preview_data.get("employment_insurance", 0),
            "total_pay": preview_data.get("gross_pay", 0),
            "total_deductions": preview_data.get("total_deductions", 0),
            "net_pay": preview_data.get("net_pay", 0),
            "has_allowances": bool(preview_data.get("meal_allowance", 0)),
        }

        try:
            excel_bytes, _ = generate_payroll_excel(payroll_data)
        except Exception as exc:
            log.exception("급여명세서 Excel 생성 실패: %s", exc)
            return (
                f"{emp_name} 급여명세서 엑셀 생성 중 오류가 발생했어요.\n\n"
                f"[ARTIFACT]\ntype: payroll_doc\ntitle: {emp_name} 급여명세서 {confirmed_month}\nsub_domain: Tax&HR\n[/ARTIFACT]"
            )

        _BUCKET = "documents-uploads"
        storage_key = f"{account_id}/payroll/{uuid.uuid4().hex}/payroll_slip.xlsx"

        def _upload_from_preview():
            try:
                sb.storage.from_(_BUCKET).upload(
                    path=storage_key,
                    file=excel_bytes,
                    file_options={
                        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "upsert": "false",
                    },
                )
                res = sb.storage.from_(_BUCKET).create_signed_url(storage_key, expires_in=604800)
                if isinstance(res, dict):
                    return res.get("signedURL") or res.get("signedUrl") or ""
                return ""
            except Exception as exc:
                log.warning("급여명세서 Storage 업로드 실패: %s", exc)
                return ""

        download_url = await _asyncio.to_thread(_upload_from_preview)

        net_pay_val = payroll_data["net_pay"]
        gross_val = payroll_data["total_pay"]
        total_ded = payroll_data["total_deductions"]

        lines_out = [f"**{emp_name}** ({confirmed_month}) 급여명세서를 생성했어요."]
        lines_out.append(f"- 고용 유형: {emp_type}")
        hours = preview_data.get("hours_worked", 0)
        if hours:
            ot = preview_data.get("overtime_hours", 0)
            lines_out.append(f"- 근무시간: {hours}h" + (f" (연장 {ot}h)" if ot else ""))
        if gross_val:
            lines_out.append(f"- 지급액 합계: {gross_val:,}원")
        if total_ded:
            lines_out.append(f"- 공제액 합계: {total_ded:,}원")
        if net_pay_val:
            lines_out.append(f"- **실수령액: {net_pay_val:,}원**")

        reply = "\n".join(lines_out)
        if download_url:
            reply += f"\n\n[📥 급여명세서 엑셀 다운로드]({download_url})"
        else:
            reply += "\n\n(파일 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.)"
        reply += "\n\n> ⚠️ 4대보험 요율·소득세는 2026년 기준이며, 신고 전 국세청·공단 공식 자료로 재확인하세요."
        reply += (
            f"\n\n[ARTIFACT]\ntype: payroll_doc\ntitle: {emp_name} 급여명세서 {confirmed_month}\n"
            f"sub_domain: Tax&HR\n"
            + (f"file_url: {download_url}\n" if download_url else "")
            + "[/ARTIFACT]"
        )
        await save_artifact_from_reply(
            account_id, "documents", reply,
            default_title=f"{emp_name} 급여명세서 {confirmed_month}",
            valid_types=VALID_TYPES,
            extra_meta_keys=("file_url",),
            type_to_subhub=_TYPE_TO_SUBHUB,
        )
        return reply

    # ── Path B: 직원 DB 조회 → 선택 UI 반환 ─────────────────

    try:
        emp_list_res = (
            sb.table("employees")
            .select("id,name,employment_type,hourly_rate,monthly_salary,pay_day,department,position")
            .eq("account_id", account_id)
            .eq("status", "active")
            .order("name")
            .execute()
        )
        employees = emp_list_res.data or []
    except Exception:
        employees = []

    if employees:
        picker_payload = json.dumps(
            {"employees": employees, "pay_month": pay_month},
            ensure_ascii=False,
        )
        return (
            f"어떤 직원의 **{pay_month}** 급여명세서를 만들까요? "
            f"아래에서 직원을 선택해 주세요.\n\n"
            f"[ACTION:SELECT_EMPLOYEE_FOR_PAYROLL:{picker_payload}]"
        )

    # ── Path C: 직원 DB 없음 → LLM 추출 폴백 ────────────────
    try:
        profile_row = (
            sb.table("profiles")
            .select("business_type,employees_count")
            .eq("id", account_id)
            .maybe_single()
            .execute()
        )
        profile = profile_row.data or {}
    except Exception:
        profile = {}

    # LLM으로 급여 구조화 데이터 추출 (gpt-4o-mini, JSON only)
    _RATES_BLOCK = (
        "[2026년 4대보험 요율 — 근로자 부담]\n"
        "- 국민연금: 4.5% (상한 590만원)\n"
        "- 건강보험: 3.545%\n"
        "- 장기요양보험: 건강보험료 × 12.95%\n"
        "- 고용보험: 0.9%\n"
        "- 소득세: 간이세액표 기준 (비과세 식대 월 20만원 공제 후)\n"
        "- 초단시간(주 15h 미만): 4대보험 미적용, 소득세만 공제\n\n"
        "[고용 유형]\n"
        "- 초단시간: 1주 소정근로 15시간 미만 (단시간 알바)\n"
        "- 시급제: 1주 15시간 이상 시급/일급\n"
        "- 월급제: 월 고정급"
    )
    json_system = (
        "당신은 급여 계산 전문가입니다. 사용자 요청에서 급여명세서 데이터를 추출해 JSON만 반환하세요. 설명 없이 JSON만.\n\n"
        + _RATES_BLOCK
        + f"\n\n[사업장 프로필] 업종: {profile.get('business_type') or '미상'}"
        + f" | 직원수: {profile.get('employees_count') or '미상'}\n\n"
        'JSON 스키마 (알 수 없는 항목은 0):\n'
        '{"employment_type":"초단시간|시급제|월급제","has_allowances":bool,'
        '"name":"string","pay_date":"YYYY-MM-DD",'
        '"hourly_rate":0,"hours_worked":0.0,"base_pay":0,'
        '"overtime_hours":0.0,"overtime_pay":0,'
        '"night_hours":0.0,"night_pay":0,'
        '"holiday_hours":0.0,"holiday_pay":0,'
        '"meal_allowance":0,"family_allowance":0,'
        '"income_tax":0,"national_pension":0,"health_insurance":0,'
        '"ltc_insurance":0,"employment_insurance":0,'
        '"total_pay":0,"total_deductions":0,"net_pay":0}'
    )
    user_context = f"대상자: {target}, 지급월: {pay_month}"
    if extra_note:
        user_context += f", 특이사항: {extra_note}"
    user_context += f"\n\n{message}"

    json_resp = await chat_completion(
        messages=[{"role": "system", "content": json_system}, {"role": "user", "content": user_context}],
        model="gpt-4o-mini",
        temperature=0,
    )
    raw_json = (json_resp.choices[0].message.content or "{}").strip()
    try:
        if raw_json.startswith("```"):
            raw_json = re.sub(r"^```[a-z]*\n?", "", raw_json).rstrip("`").strip()
        payroll_data = json.loads(raw_json)
    except Exception:
        payroll_data = {}

    if not payroll_data.get("name"):
        payroll_data["name"] = target
    if not payroll_data.get("pay_date"):
        try:
            payroll_data["pay_date"] = f"{pay_month.strip()[:7]}-25"
        except Exception:
            pass

    # Excel 생성
    try:
        excel_bytes, filename = generate_payroll_excel(payroll_data)
    except Exception as exc:
        log.exception("급여명세서 Excel 생성 실패: %s", exc)
        return (
            "급여명세서 엑셀 생성 중 오류가 발생했어요. 데이터를 확인 후 다시 시도해 주세요.\n\n"
            f"[ARTIFACT]\ntype: payroll_doc\ntitle: {target} 급여명세서\nsub_domain: Tax&HR\n[/ARTIFACT]"
        )

    # Supabase Storage 업로드
    _BUCKET = "documents-uploads"
    storage_key = f"{account_id}/payroll/{uuid.uuid4().hex}/payroll_slip.xlsx"

    def _upload_excel() -> str:
        try:
            sb.storage.from_(_BUCKET).upload(
                path=storage_key,
                file=excel_bytes,
                file_options={
                    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "upsert": "false",
                },
            )
            res = sb.storage.from_(_BUCKET).create_signed_url(storage_key, expires_in=604800)
            if isinstance(res, dict):
                return res.get("signedURL") or res.get("signedUrl") or ""
            return ""
        except Exception as exc:
            log.warning("급여명세서 Storage 업로드 실패: %s", exc)
            return ""

    download_url = await _asyncio.to_thread(_upload_excel)

    # 답변 조합
    emp = payroll_data.get("employment_type", "")
    total_pay = payroll_data.get("total_pay", 0)
    total_ded = payroll_data.get("total_deductions", 0)
    net_pay = payroll_data.get("net_pay", 0)

    lines = [f"**{target}** ({pay_month}) 급여명세서를 작성했어요."]
    if emp:
        lines.append(f"- 고용 유형: {emp}")
    if total_pay:
        lines.append(f"- 지급액 합계: {total_pay:,}원")
    if total_ded:
        lines.append(f"- 공제액 합계: {total_ded:,}원")
    if net_pay:
        lines.append(f"- **실수령액: {net_pay:,}원**")

    reply = "\n".join(lines)
    if download_url:
        reply += f"\n\n[📥 급여명세서 엑셀 다운로드]({download_url})"
    else:
        reply += "\n\n(파일 업로드에 실패했어요. 잠시 후 다시 시도해 주세요.)"
    reply += "\n\n> ⚠️ 4대보험 요율·소득세는 2026년 기준이며, 신고 전 국세청·공단 공식 자료로 재확인하세요."
    reply += (
        f"\n\n[ARTIFACT]\ntype: payroll_doc\ntitle: {target} 급여명세서 {pay_month}\n"
        f"sub_domain: Tax&HR\n"
        + (f"file_url: {download_url}\n" if download_url else "")
        + "[/ARTIFACT]"
    )

    await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title=f"{target} 급여명세서 {pay_month}",
        valid_types=VALID_TYPES,
        extra_meta_keys=("file_url",),
        type_to_subhub=_TYPE_TO_SUBHUB,
    )
    return reply


async def run_tax_calendar(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    business_type: str,
    target_year: int,
    extra_note: str | None = None,
) -> str:
    """세무 신고 캘린더 — 지식 파일 주입 + 프로필 업종 활용."""
    knowledge = _load_knowledge("tax_calendar_2026.md")
    sub_hub_list = await list_sub_hub_titles(account_id, "documents")
    feedback = await feedback_context(account_id, "documents")

    system = (
        SYSTEM_PROMPT
        + "\n\n"
        + _CATEGORY_GUIDANCE["tax_hr"]
        + "\n\n[작업 지시]\n"
        f"'{business_type}' 사업자의 {target_year}년 세무 신고 캘린더를 작성하세요.\n"
        "작성 규칙:\n"
        "1. 월별 표 형식 (월 | 신고·납부 항목 | 기한 | 근거 법조)\n"
        "2. 사업자 유형(개인 일반/간이/법인)에 따라 해당 항목만 포함\n"
        "3. 4대보험 납부일도 포함\n"
        "4. 기한이 주말·공휴일이면 다음 영업일로 자동 연장됨을 안내 (국세기본법 §5)\n"
        "5. 마지막에 '당해 연도 세율은 법령 개정 시 변동 가능, 신고 전 국세청 재확인' 주의 문구\n"
        f"6. 응답 마지막에 [ARTIFACT](type=tax_calendar, sub_domain=Tax&HR, title={target_year}년 세무 캘린더) 포함\n"
        + (f"\n\n[세무 기준 자료]\n{knowledge}" if knowledge else "")
        + (f"\n\n[등록된 서브허브]\n{sub_hub_list}" if sub_hub_list else "")
        + today_context()
    )
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if extra_note:
        system += f"\n\n[특이사항] {extra_note}"
    if feedback:
        system += f"\n\n[피드백]\n{feedback}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content or ""
    await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title=f"{target_year}년 세무 캘린더",
        valid_types=VALID_TYPES,
        type_to_subhub=_TYPE_TO_SUBHUB,
    )
    return reply


async def run_review(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    user_role: str = "미지정",
    contract_subtype: str | None = None,
) -> str:
    if user_role not in ("갑", "을", "미지정"):
        user_role = "미지정"
    sub = f", contract_subtype={contract_subtype}" if contract_subtype else ""
    synthetic = (
        f"최근 업로드한 문서의 공정성을 분석해주세요 (user_role={user_role}{sub}). "
        "추가 CHOICES 없이 바로 [REVIEW_REQUEST] 마커를 출력하세요.\n\n"
        f"원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_legal_advice(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    question: str,
    topic: str | None = None,
) -> str:
    from app.agents._legal import LegalIntent
    intent = await classify_legal_intent(question, history)
    if not intent.is_legal and topic:
        intent = LegalIntent(is_legal=True, topic=topic, reason="tool-invoked")
    if not intent.is_legal:
        return await run(question, account_id, history, rag_context, long_term_context)
    return await handle_legal_question(
        question,
        account_id,
        history,
        rag_context=rag_context,
        long_term_context=long_term_context,
        intent=intent,
    )


def describe(account_id: str) -> list[dict]:
    caps: list[dict] = [
        {
            "name": "doc_contract",
            "description": (
                "계약서 초안 작성 — 근로·임대차·용역·납품·파트너십·프랜차이즈·NDA 7종. "
                "'계약서 써줘/만들어줘' 요청이면 이 tool. "
                "subtype·갑·을 확정 시에만 호출. "
                "[카테고리: Review — 공정 중립이 필요한 서류]"
            ),
            "handler": run_contract,
            "parameters": {
                "type": "object",
                "properties": {
                    "subtype":    {"type": "string", "enum": list(VALID_CONTRACT_SUBTYPES)},
                    "party_a":    {"type": "string", "description": "갑 (고용인/발주자/임대인)"},
                    "party_b":    {"type": "string", "description": "을 (피고용인/수주자/임차인)"},
                    "amount":     {"type": "string", "description": "금액/보수/임대료 등"},
                    "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "end_date":   {"type": "string", "description": "YYYY-MM-DD"},
                    "extra_note": {"type": "string"},
                },
                "required": ["subtype", "party_a", "party_b"],
            },
        },
        {
            "name": "doc_estimate",
            "description": (
                "견적서 초안 작성 — 발주처·품목·총액·유효기간. "
                "'견적서 써줘/뽑아줘' 요청이면 이 tool. "
                "[카테고리: Operations — 서류 초안·행정 업무]"
            ),
            "handler": run_estimate,
            "parameters": {
                "type": "object",
                "properties": {
                    "client":       {"type": "string"},
                    "items":        {"type": "string", "description": "품목·수량·단가를 자유 기술"},
                    "total_amount": {"type": "string"},
                    "valid_until":  {"type": "string", "description": "유효기간 YYYY-MM-DD"},
                },
                "required": ["client"],
            },
        },
        {
            "name": "doc_proposal",
            "description": (
                "제안서 초안 작성 — 제안 대상·업무 범위·가격·회신 기한. "
                "'제안서 써줘/초안 만들어줘' 요청이면 이 tool. "
                "[카테고리: Review — 공정 중립이 필요한 서류]"
            ),
            "handler": run_proposal,
            "parameters": {
                "type": "object",
                "properties": {
                    "client":   {"type": "string"},
                    "scope":    {"type": "string"},
                    "amount":   {"type": "string"},
                    "reply_by": {"type": "string", "description": "회신 기한 YYYY-MM-DD"},
                },
                "required": ["client"],
            },
        },
        {
            "name": "doc_notice",
            "description": (
                "직원·고객·거래처 대상 공지문 작성 — 대상·주제·게시일. "
                "임금 지급·휴무·가격 변경·매장 공지 등 일방적 통지문. "
                "[카테고리: Operations — 서류 초안·행정 업무]"
            ),
            "handler": run_notice,
            "parameters": {
                "type": "object",
                "properties": {
                    "audience":  {"type": "string", "description": "직원 / 고객 / 거래처 등"},
                    "topic":     {"type": "string"},
                    "post_date": {"type": "string", "description": "게시일 YYYY-MM-DD"},
                },
                "required": ["audience", "topic"],
            },
        },
        {
            "name": "doc_checklist_guide",
            "description": (
                "세무·운영 관련 체크리스트 또는 가이드 — "
                "창업 준비·연말정산·4대보험·근태 관리 등 절차·원칙 문서. "
                "[카테고리: Tax&HR — 세무·급여 (채용 제외)]"
            ),
            "handler": run_checklist_guide,
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "kind":  {"type": "string", "enum": ["checklist", "guide"], "default": "checklist"},
                },
                "required": ["topic"],
            },
        },
        # ──────────────────────────────────────────────────────
        # Step 3-B — Operations 신규 2종
        # ──────────────────────────────────────────────────────
        {
            "name": "doc_subsidy_recommend",
            "description": (
                "사용자 업종·지역·사업 단계에 맞는 정부 지원사업을 검색·추천. "
                "'지원사업 뭐가 있어', '보조금 받을 수 있어', '정부 지원 받고 싶어', "
                "'어떤 지원사업이 잘 맞을까', '지원사업 추천해줘', '보조금 추천' 같은 맥락이면 이 tool. "
                "각 공고에 대해 10점 만점 점수 + 매칭 이유 제공. 기본 1개, 요청 시 N개. "
                "추천 후 [CHOICES]에서 '마감 일정 추가'를 선택한 경우 confirm_deadline=true 로 재호출. "
                "[카테고리: Operations — 지원사업 추천]"
            ),
            "handler": run_subsidy_recommend,
            "parameters": {
                "type": "object",
                "properties": {
                    "count": {"type": "integer", "description": "추천 개수 (기본 1)", "default": 1},
                    "confirm_deadline": {"type": "boolean", "description": "마감 일정 추가 확인 (사용자가 CHOICES에서 '마감 일정 추가'를 선택한 경우 true)", "default": False},
                },
            },
        },
        {
            "name": "doc_admin_application",
            "description": (
                "한국 행정 신청서 초안 — 프로필 데이터 자동 채움 + 실제 양식 모사 마크다운 생성. "
                "현재 지원 양식: 사업자등록 신청서 / 통신판매업 신고서 / 구매안전서비스 비적용대상 확인서. "
                "'사업자등록 신청서 써줘', '통신판매업 신고서 만들어줘', '구매안전서비스 확인서' 요청이면 이 tool. "
                "[카테고리: Operations — 행정 업무 신청서]"
            ),
            "handler": run_admin_application,
            "parameters": {
                "type": "object",
                "properties": {
                    "application_type": {
                        "type": "string",
                        "enum": list(VALID_ADMIN_TYPES),
                        "description": (
                            "신청서 종류: "
                            "business_registration=사업자등록 신청서, "
                            "mail_order_registration=통신판매업 신고서, "
                            "purchase_safety_exempt=구매안전서비스 비적용대상 확인서"
                        ),
                    },
                    "purpose":    {"type": "string", "description": "신청 목적·사유 (선택)"},
                    "extra_note": {"type": "string", "description": "특이사항 (선택)"},
                },
                "required": ["application_type"],
            },
        },
        # ──────────────────────────────────────────────────────
        # Step 3-A — Tax&HR 신규 2종 (hr_evaluation 제외)
        # ──────────────────────────────────────────────────────
        {
            "name": "doc_payroll_doc",
            "description": (
                "급여명세서 Excel 최종 생성. recruit_payroll_preview 에서 미리보기를 확인하고 '급여명세서 생성' 을 선택한 뒤 호출. "
                "원천징수영수증·4대보험 신고용 문서 초안도 담당. "
                "[카테고리: Tax&HR — 세무 (채용 제외)]"
            ),
            "handler": run_payroll_doc,
            "parameters": {
                "type": "object",
                "properties": {
                    "doc_kind":   {"type": "string", "enum": ["급여명세서", "원천징수영수증", "4대보험 신고서"]},
                    "target":     {"type": "string", "description": "대상자 (직원명)"},
                    "pay_month":  {"type": "string", "description": "지급월 (예: 2026-03) 또는 대상 기간"},
                    "extra_note": {"type": "string"},
                },
                "required": ["doc_kind", "target", "pay_month"],
            },
        },
        {
            "name": "doc_tax_calendar",
            "description": (
                "연간 세무 신고 캘린더 — 부가세·종소세·법인세·원천세·4대보험 일정을 월별 표로. "
                "'세무 일정 정리해줘', '세금 신고 캘린더', '부가세 신고 일정' 요청이면 이 tool. "
                "사업자 형태(개인/법인)에 따라 분기. "
                "[카테고리: Tax&HR — 세무 일정]"
            ),
            "handler": run_tax_calendar,
            "parameters": {
                "type": "object",
                "properties": {
                    "business_type": {"type": "string", "description": "사업자 형태: '개인 일반' | '개인 간이' | '법인'"},
                    "target_year":   {"type": "integer", "description": "대상 연도 (예: 2026)"},
                    "extra_note":    {"type": "string"},
                },
                "required": ["business_type", "target_year"],
            },
        },
        {
            "name": "doc_legal_advice",
            "description": (
                "한국 법률·법령·조례·시행령에 대한 질문에 RAG 기반으로 답한다. "
                "노동·임대차·공정거래·개인정보·세법·상법·식품위생·건축·저작권 등 분야 무관. "
                "서류 작성/검토가 아니라 **법령 자체에 대한 자문** 이 필요할 때 선택. "
                "[카테고리: Legal — 법률 자문]"
            ),
            "handler": run_legal_advice,
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "법률 질문 원문"},
                    "topic":    {"type": "string", "description": "노동/임대차/세법 등 대분야 힌트(선택)"},
                },
                "required": ["question"],
            },
        },
    ]

    _recent_doc = _find_recent_uploaded_doc(account_id)
    log.info(
        "[documents/describe] account=%s doc_review_available=%s source=%s",
        account_id,
        bool(_recent_doc),
        "ephemeral" if (_recent_doc or {}).get("_ephemeral") else ("db" if _recent_doc else "none"),
    )
    if _recent_doc:
        _doc_title = (_recent_doc.get("title") or "").strip() or "최근 업로드 문서"
        caps.append({
            "name": "doc_review",
            "description": (
                f"[즉시 호출 가능] 현재 업로드된 서류 '{_doc_title}' 의 공정성"
                "(갑·을 비율, 위험 조항)을 분석한다. 사용자가 '공정성 분석', '검토', "
                "'계약서/제안서 봐줘' 등을 요청하면 바로 이 tool 을 호출하세요. "
                "문서는 이미 서버가 파싱 완료한 상태이므로 '업로드 안 됐다'고 답하거나 "
                "다시 업로드를 요청하면 안 됩니다. user_role 이 '갑/을/미지정' 중 불확실하면 "
                "미지정으로 호출하세요. "
                "[카테고리: Review — 기존 서류 공정성 분석]"
            ),
            "handler": run_review,
            "parameters": {
                "type": "object",
                "properties": {
                    "user_role":        {"type": "string", "enum": ["갑", "을", "미지정"], "default": "미지정"},
                    "contract_subtype": {"type": "string", "enum": list(VALID_CONTRACT_SUBTYPES)},
                },
            },
        })

    return caps
