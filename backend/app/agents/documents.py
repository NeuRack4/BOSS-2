from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
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

log = logging.getLogger(__name__)


VALID_TYPES: tuple[str, ...] = (
    "contract",
    "estimate",
    "proposal",
    "notice",
    "checklist",
    "guide",
)

_TYPE_TO_SUBHUB: dict[str, str] = {
    "contract":  "Review",
    "proposal":  "Review",
    "estimate":  "Operations",
    "notice":    "Operations",
    "checklist": "Tax&HR",
    "guide":     "Tax&HR",
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
   - **Tax&HR**      — 인사평가·세무 관련. `checklist`, `guide` 가 여기.
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
[카테고리: Tax&HR — 인사평가·세무 (채용 제외)]
이 카테고리는 세무 신고·4대보험·급여·인사평가·근태 관리 관련 문서를 다룹니다.
- 현재 지원 타입: checklist(체크리스트), guide(가이드/매뉴얼).
  인사평가서·급여명세서·세무 캘린더 capability 는 추후 추가 예정.
- 프로필의 직원 수·업종 정보가 있으면 적극 활용. 없으면 CHOICES 로 좁혀가세요.
- **채용(모집·공고·면접)은 recruitment 도메인 소관**이므로 이 카테고리에서 다루지 마세요.
- type 이 모호하면:
  [CHOICES]
  체크리스트 (단계별 확인 항목)
  가이드 (절차·원칙 안내문)
  [/CHOICES]
- 저장 시 `sub_domain: Tax&HR`.
""",
    "operations": """\
[카테고리: Operations — 서류 초안·행정 업무]
이 카테고리는 견적서·공지문·국가 지원사업 신청서·행정 처리 신청서 등 일상 서류 초안 작성을 담당합니다.
- 현재 지원 타입: estimate(견적서), notice(공지문).
  지원사업·행정 신청서 capability 는 추후 추가 예정 — 요청이 들어오면 "아직 지원사업 자동 작성은 준비 중입니다.
  대신 어떤 지원사업인지 알려주시면 일반 서류 형식으로 초안을 잡아드릴 수 있습니다." 로 대응.
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
    if doc_type not in ("계약서", "제안서", "기타"):
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
    artifact_type = "checklist" if kind == "checklist" else "guide"
    synthetic = (
        f"'{topic}' 주제로 {kind} 문서를 작성해주세요. [ARTIFACT] 블록(type={artifact_type}) 포함.\n\n"
        f"원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


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
                "세무·인사·운영 관련 체크리스트 또는 가이드 — "
                "창업 준비·연말정산·4대보험·근태 관리·인사평가 등 절차·원칙 문서. "
                "[카테고리: Tax&HR — 인사평가·세무 (채용 제외)]"
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
