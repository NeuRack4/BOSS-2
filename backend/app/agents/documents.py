from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from langsmith import traceable

from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.agents.orchestrator import (
    CLARIFY_RULE,
    ARTIFACT_RULE,
)
from app.agents._feedback import feedback_context
from app.agents._suggest import suggest_today_for_domain
from app.agents._artifact import (
    save_artifact_from_reply,
    list_sub_hub_titles,
    today_context,
)
from app.agents._doc_templates import VALID_CONTRACT_SUBTYPES
from app.agents._doc_review import InvalidDocumentError, dispatch_review
from deepagents import create_deep_agent
from app.agents._agent_context import inject_agent_context
from app.agents._documents_tools import (
    DOCUMENTS_TOOLS,
    init_docs_result_store,
    get_docs_result_store,
)
from app.core.config import settings

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

VALID_ADMIN_TYPES = (
    "business_registration",
    "mail_order_registration",
    "purchase_safety_exempt",
)


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "documents")


def _make_docs_model():
    """Documents DeepAgent용 LLM 모델 생성."""
    if settings.planner_provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=settings.planner_claude_model,
            temperature=0.3,
            api_key=settings.anthropic_api_key,
        )
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=settings.planner_openai_model,
        temperature=0.3,
        api_key=settings.openai_api_key,
    )


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
  (3) **analyze_document 도구 호출** — (1)+(2) 가 끝났다고 판단되는 **바로 그 턴**에
      반드시 analyze_document() 도구를 직접 호출하세요.
      ⚠️ [REVIEW_REQUEST] 텍스트 마커를 출력하지 마세요 — 구 시스템 방식으로 현재는 동작하지 않습니다.
      analyze_document(
          user_role="<갑|을|미지정>",
          doc_type="<계약서|제안서|기타>",
          contract_subtype="<labor|lease|service|supply|partnership|franchise|nda 또는 None>"
      )
  (4) analyze_document 호출 턴엔 [ARTIFACT]/[CHOICES] 를 함께 사용하지 마세요.
  (5) 이미 분석된 결과(컨텍스트에 "[최근 분석 결과]" 가 있으면) 에 대한 후속 질문은 그 결과만 참고해 답하세요.

""" + ARTIFACT_RULE + CLARIFY_RULE + """

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


async def _execute_write(account_id: str, result_data: dict) -> str:
    """write_document terminal tool 결과를 Supabase에 저장하고 reply 반환."""
    doc_type  = result_data.get("doc_type", "")
    title     = result_data.get("title", "문서")
    content   = result_data.get("content", "")
    if not content.strip():
        return "서류 내용이 비어있습니다. 다시 시도해 주세요."
    subtype   = result_data.get("subtype")
    due_date  = result_data.get("due_date")
    due_label = result_data.get("due_label")

    subhub = _TYPE_TO_SUBHUB.get(doc_type, "Operations")
    if doc_type and doc_type not in VALID_TYPES:
        log.warning("[documents] unknown doc_type=%r, defaulting subhub to Operations", doc_type)
    meta_lines = [f"type: {doc_type}", f"title: {title}", f"sub_domain: {subhub}"]
    if subtype:
        meta_lines.append(f"contract_subtype: {subtype}")
    if due_date:
        meta_lines.append(f"due_date: {due_date}")
    if due_label:
        meta_lines.append(f"due_label: {due_label}")

    artifact_block = "[ARTIFACT]\n" + "\n".join(meta_lines) + "\n[/ARTIFACT]\n\n" + content
    reply_with_artifact = f"서류를 작성했습니다.\n\n{artifact_block}"

    artifact_id = await save_artifact_from_reply(
        account_id=account_id,
        domain="documents",
        reply=reply_with_artifact,
        default_title=title,
        valid_types=VALID_TYPES,
        extra_meta_keys=("due_label", "contract_subtype"),
        type_to_subhub=_TYPE_TO_SUBHUB,
    )

    doc_label = {
        "contract": "계약서", "estimate": "견적서", "proposal": "제안서",
        "notice": "공지문", "checklist": "체크리스트", "guide": "가이드",
        "subsidy_recommendation": "지원사업 추천서", "admin_application": "행정 신청서",
        "hr_evaluation": "인사평가서", "payroll_doc": "급여명세서", "tax_calendar": "세무 캘린더",
    }.get(doc_type, "서류")

    return f"{doc_label} **{title}**을 작성하고 저장했습니다." + (
        f"\n\n캔버스에서 확인하실 수 있어요. (artifact id: `{artifact_id}`)" if artifact_id else ""
    )


async def _execute_analyze(account_id: str, result_data: dict) -> str:
    """analyze_document terminal tool 결과로 실제 공정성 분석을 실행."""
    user_role        = result_data.get("user_role", "미지정")
    doc_type_str     = result_data.get("doc_type", "계약서")
    contract_subtype = result_data.get("contract_subtype")

    uploaded_doc = _find_recent_uploaded_doc(account_id)
    if not uploaded_doc:
        return "분석할 업로드 문서를 찾을 수 없습니다. 문서를 다시 업로드해 주세요."

    try:
        result = await dispatch_review(
            account_id=account_id,
            doc_artifact_id=uploaded_doc.get("id") if not uploaded_doc.get("_ephemeral") else None,
            ephemeral_doc=uploaded_doc if uploaded_doc.get("_ephemeral") else None,
            user_role=user_role,
            doc_type=doc_type_str,
            contract_subtype=contract_subtype,
        )
    except InvalidDocumentError as e:
        log.warning("[documents] document analysis failed: %s", e)
        return f"문서 분석 실패: {e}"

    return "분석을 시작하겠습니다." + _format_review_append(result)


_DOCS_TERMINAL_REMINDER = """
[경고] terminal tool을 호출하지 않았습니다.
반드시 다음 중 하나를 즉시 호출하세요:
- write_document(doc_type, title, content, ...) — 서류 작성·저장
- analyze_document(user_role, ...) — 공정성 분석

서류 작성 요청에서 terminal tool 미호출은 오류입니다.
"""


async def _run_documents_agent(
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    system_prompt: str,
) -> str:
    """Documents DeepAgent 실행 공통 함수."""
    inject_agent_context(account_id, message, history, rag_context, long_term_context)
    init_docs_result_store()

    model = _make_docs_model()
    messages_in = [*history[-6:], {"role": "user", "content": message}]

    async def _invoke(sys: str) -> list:
        agent = create_deep_agent(model=model, tools=DOCUMENTS_TOOLS, system_prompt=sys)
        result = await agent.ainvoke({"messages": messages_in})
        return result.get("messages", [])

    try:
        out_messages = await _invoke(system_prompt)
    except Exception as exc:
        log.exception("[documents] deepagent invoke failed")
        return f"서류 처리 중 오류가 발생했습니다: {exc}"

    result_data = get_docs_result_store()
    if not result_data:
        log.info("[documents] account=%s no terminal tool — retry", account_id)
        try:
            init_docs_result_store()
            out_messages = await _invoke(system_prompt + "\n\n" + _DOCS_TERMINAL_REMINDER)
        except Exception as exc:
            log.exception("[documents] retry invoke failed")
            return f"서류 처리 중 오류가 발생했습니다: {exc}"
        result_data = get_docs_result_store()

    if not result_data:
        from langchain_core.messages import AIMessage
        for msg in reversed(out_messages):
            if isinstance(msg, AIMessage) and msg.content:
                return str(msg.content).strip()
        return "처리 결과를 반환하지 못했습니다."

    action = result_data.get("action")
    if action == "write":
        return await _execute_write(account_id, result_data)
    if action == "analyze":
        return await _execute_analyze(account_id, result_data)
    return "알 수 없는 action입니다."


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


# 카테고리별 system prompt 추가 블록 — write 경로에서 사용.
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
    "legal": "",
}


# ──────────────────────────────────────────────────────────────────────────
# Public entrypoints
# ──────────────────────────────────────────────────────────────────────────

@traceable(name="documents.run_contract")
async def run_contract(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    subtype: str | None = None,
    party_a: str | None = None,
    party_b: str | None = None,
    amount: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    extra_note: str | None = None,
    **_kwargs,
) -> str:
    sub_ctx = f"subtype={subtype}" if subtype else ""
    party_ctx = ""
    if party_a or party_b:
        party_ctx = f"\n갑: {party_a or '미정'}  을: {party_b or '미정'}"
    amount_ctx = f"\n계약금액: {amount}" if amount else ""
    date_ctx = ""
    if start_date or end_date:
        date_ctx = f"\n계약기간: {start_date or '?'} ~ {end_date or '?'}"
    note_ctx = f"\n추가요청: {extra_note}" if extra_note else ""

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 계약서 작성]
{_CATEGORY_GUIDANCE['review']}

확정된 정보:
{sub_ctx}{party_ctx}{amount_ctx}{date_ctx}{note_ctx}

[수행 순서]
1. get_sub_hubs() 호출로 서브허브 목록 확인
2. 위 확정 정보를 바탕으로 완성된 계약서 본문을 마크다운으로 작성
3. write_document(doc_type="contract", title="<적절한 제목>", content="<전체 본문>",
   subtype="{subtype or 'labor'}", due_date="<YYYY-MM-DD>", due_label="계약 만료") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_estimate")
async def run_estimate(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    client: str | None = None,
    items: str | None = None,
    total_amount: str | None = None,
    valid_until: str | None = None,
    **_kwargs,
) -> str:
    client_ctx  = f"\n고객명: {client}" if client else ""
    items_ctx   = f"\n품목/내용: {items}" if items else ""
    amount_ctx  = f"\n총액: {total_amount}" if total_amount else ""
    valid_ctx   = f"\n견적 유효기간: {valid_until}" if valid_until else ""

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 견적서 작성]
{_CATEGORY_GUIDANCE['operations']}

확정된 정보:
{client_ctx}{items_ctx}{amount_ctx}{valid_ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 견적서 본문 작성 (품목·단가·합계·유효기간 포함)
3. write_document(doc_type="estimate", title="견적서 — <고객명>", content="<전체 본문>",
   due_date="<valid_until YYYY-MM-DD>", due_label="견적 유효기간") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_proposal")
async def run_proposal(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    client: str | None = None,
    scope: str | None = None,
    amount: str | None = None,
    reply_by: str | None = None,
    **_kwargs,
) -> str:
    ctx = "\n".join(filter(None, [
        f"제안 대상: {client}" if client else "",
        f"업무 범위: {scope}" if scope else "",
        f"예산/금액: {amount}" if amount else "",
        f"회신 기한: {reply_by}" if reply_by else "",
    ]))
    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 제안서 작성]
{_CATEGORY_GUIDANCE['review']}
{ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 제안서 작성 (배경·목적·범위·일정·비용 포함)
3. write_document(doc_type="proposal", title="제안서 — <프로젝트명>", content="<전체 본문>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_notice")
async def run_notice(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    audience: str | None = None,
    topic: str | None = None,
    post_date: str | None = None,
    **_kwargs,
) -> str:
    ctx = "\n".join(filter(None, [
        f"공지 대상: {audience}" if audience else "",
        f"공지 주제: {topic}" if topic else "",
        f"게시일: {post_date}" if post_date else "",
    ]))
    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 공지문 작성]
{_CATEGORY_GUIDANCE['operations']}
{ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 공지문 작성
3. write_document(doc_type="notice", title="공지 — <주제>", content="<전체 본문>",
   due_date="<post_date>", due_label="공지 게시일") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_checklist_guide")
async def run_checklist_guide(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    checklist_type: str | None = None,
    topic: str | None = None,
    **_kwargs,
) -> str:
    doc_type = "checklist" if (checklist_type or "").lower() == "checklist" else "guide"
    ctx = f"\n주제: {topic}" if topic else ""
    system = f"""{SYSTEM_PROMPT}

[이번 요청 — {'체크리스트' if doc_type == 'checklist' else '가이드'} 작성]
{_CATEGORY_GUIDANCE['tax_hr']}
{ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 {'체크리스트 (항목별 확인란 포함)' if doc_type == 'checklist' else '가이드 (단계별 절차)'} 작성
3. write_document(doc_type="{doc_type}", title="<적절한 제목>", content="<전체 본문>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


# ──────────────────────────────────────────────────────────────────────────
# Step 3-B — Operations: 지원사업 추천
# ──────────────────────────────────────────────────────────────────────────

@traceable(name="documents.run_subsidy_recommend")
async def run_subsidy_recommend(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    **_kwargs,
) -> str:
    sb = get_supabase()
    try:
        programs = (
            sb.table("subsidy_programs")
            .select("name,description,target,deadline,max_amount")
            .order("deadline", desc=False)
            .limit(10)
            .execute()
            .data or []
        )
    except Exception:
        programs = []
    programs_ctx = "\n".join(
        f"- {p.get('name','?')}: {(p.get('description','') or '')[:80]} "
        f"(마감: {p.get('deadline','?')}, 최대 {p.get('max_amount','?')})"
        for p in programs
    ) if programs else "현재 조회된 지원사업 없음"

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 국가 지원사업 추천]
{_CATEGORY_GUIDANCE['operations']}

현재 등록된 지원사업 목록:
{programs_ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 위 지원사업 중 이 계정에 맞는 것을 추천하고 신청 방법 안내
3. write_document(doc_type="subsidy_recommendation", title="지원사업 추천 보고서", content="<전체 내용>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_admin_application")
async def run_admin_application(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    application_type: str | None = None,
    purpose: str | None = None,
    extra_note: str | None = None,
    **_kwargs,
) -> str:
    _ADMIN_LABELS = {
        "business_registration": "사업자 등록 신청서 — 상호·대표자·업종·소재지·개업일 포함",
        "mail_order_registration": "통신판매업 신고서 — 온라인 쇼핑몰·SNS 판매 신고",
        "purchase_safety_exempt": "구매안전서비스 비적용대상 확인서 — 전자상거래법 §13의2",
    }
    type_labels = "\n".join(f"- {k}: {v}" for k, v in _ADMIN_LABELS.items())
    admin_ctx = "\n".join(filter(None, [
        f"신청서 유형: {application_type}" if application_type else "",
        f"신청 목적: {purpose}" if purpose else "",
        f"특이사항: {extra_note}" if extra_note else "",
    ]))

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 행정 신청서 작성]
{_CATEGORY_GUIDANCE['operations']}

지원 행정서류 종류:
{type_labels}
{admin_ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 행정 신청서 작성
3. write_document(doc_type="admin_application", title="<행정서류명>", content="<전체 내용>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


# ──────────────────────────────────────────────────────────────────────────
# Step 3-A — Tax&HR 신규 3종
# ──────────────────────────────────────────────────────────────────────────

@traceable(name="documents.run_hr_evaluation", run_type="chain")
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


@traceable(name="documents.run_payroll_doc")
async def run_payroll_doc(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    doc_kind: str | None = None,
    target: str | None = None,
    pay_month: str | None = None,
    extra_note: str | None = None,
    **_kwargs,
) -> str:
    ctx = "\n".join(filter(None, [
        f"서류 종류: {doc_kind}" if doc_kind else "",
        f"대상자: {target}" if target else "",
        f"지급월: {pay_month}" if pay_month else "",
        f"특이사항: {extra_note}" if extra_note else "",
    ]))
    title_month = f" {pay_month}" if pay_month else ""
    title_target = f" — {target}" if target else ""

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — {doc_kind or '급여명세서'} 작성]
{_CATEGORY_GUIDANCE['tax_hr']}
{ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. {doc_kind or '급여명세서'} 내용 작성 (직원별 급여 항목 표 포함, 기본급·수당·공제항목·실지급액)
3. write_document(doc_type="payroll_doc", title="{doc_kind or '급여명세서'}{title_month}{title_target}", content="<전체 내용>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_tax_calendar")
async def run_tax_calendar(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    business_type: str | None = None,
    target_year: int | str | None = None,
    extra_note: str | None = None,
    **_kwargs,
) -> str:
    ctx = "\n".join(filter(None, [
        f"사업자 형태: {business_type}" if business_type else "",
        f"대상 연도: {target_year}" if target_year else "올해 기준",
        f"특이사항: {extra_note}" if extra_note else "",
    ]))
    year_str = f" {target_year}" if target_year else ""

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 세무 캘린더 작성]
{_CATEGORY_GUIDANCE['tax_hr']}
{ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 월별 세무 신고 일정 정리 (부가세, 종합소득세, 4대보험, 원천세 등 포함; 사업자 형태 구분 적용)
3. write_document(doc_type="tax_calendar", title="세무 캘린더{year_str}", content="<전체 내용>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_review")
async def run_review(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    user_role: str | None = None,
    contract_subtype: str | None = None,
    **_kwargs,
) -> str:
    role_ctx    = f"\n요청된 역할: {user_role}" if user_role else ""
    subtype_ctx = f"\n계약 subtype: {contract_subtype}" if contract_subtype else ""

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 공정성 분석 (DeepAgent 전용 지시 — 아래 규칙이 위 지시보다 우선)]
⚠️ [REVIEW_REQUEST] 마커는 구 시스템 방식입니다. 이 DeepAgent에서 절대 사용 금지.
반드시 analyze_document() 도구를 직접 호출하세요. 텍스트 마커 출력 시 오류 처리됩니다.

확정된 정보:
{role_ctx}{subtype_ctx}

[수행 순서 — 반드시 이 순서대로]
1. get_uploaded_doc() 호출 → 문서 내용과 doc_id 확인
2. user_role 결정: 아래 확정된 정보에 있으면 그대로 사용, 없으면 히스토리에서 사용자가 선택한 값 확인
3. analyze_document(
       user_role="<갑|을|미지정>",
       doc_type="계약서",
       contract_subtype="<labor|lease|service|supply|partnership|franchise|nda 또는 None>"
   ) 호출 — 이 도구 호출이 공정성 분석을 실행하는 유일한 방법입니다.
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_legal_advice")
async def run_legal_advice(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    question: str | None = None,
    **_kwargs,
) -> str:
    q_ctx = f"\n질문: {question}" if question else ""

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 법률 자문]
소상공인 관련 법률 질문에 답합니다. 실제 법령·판례에 근거해서만 답하고, 날조 금지.
{q_ctx}

[수행 방법]
- 법령·관행 근거가 있는 범위 안에서만 자세히 답하세요.
- 전문 변호사 상담을 권유하는 문구를 적절히 포함하세요.
- 이 질문은 artifact 저장 없이 텍스트 응답만 반환합니다.
  write_document나 analyze_document를 호출하지 마세요.
  도구 없이 직접 텍스트로 답변을 작성하면 됩니다.
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


@traceable(name="documents.run_tax_advice")
async def run_tax_advice(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    question: str | None = None,
    **_kwargs,
) -> str:
    q_ctx = f"\n질문: {question}" if question else ""
    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 세무·노무 자문]
소상공인 세무·노무 관련 질문에 답합니다. 세법·노동법 근거로만 답하고 날조 금지.
{q_ctx}

이 질문은 artifact 저장 없이 텍스트 응답만 반환합니다.
write_document나 analyze_document를 호출하지 마세요.
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)


async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    """Legacy entrypoint — orchestrator legacy_fallback 경로에서 호출됨.
    DeepAgent에게 SYSTEM_PROMPT만 주입하고 도구 선택은 에이전트에게 위임.
    """
    return await _run_documents_agent(
        account_id, message, history, rag_context, long_term_context, SYSTEM_PROMPT
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
                "노동·임대차·공정거래·개인정보·상법·민법·식품위생·건축·저작권 등 분야 무관. "
                "서류 작성/검토가 아니라 **법령 자체에 대한 자문** 이 필요할 때 선택. "
                "세법·세무·부가가치세·소득세·법인세·원천세·국세 관련 질문은 doc_tax_advice 를 사용. "
                "[카테고리: Legal — 법률 자문]"
            ),
            "handler": run_legal_advice,
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "법률 질문 원문"},
                    "topic":    {"type": "string", "description": "노동/임대차 등 대분야 힌트(선택)"},
                },
                "required": ["question"],
            },
        },
        {
            "name": "doc_tax_advice",
            "description": (
                "세법·세무 규정에 관한 질문에 전용 RAG(세법 조문·국세청 예규·조세심판례 3축)로 답한다. "
                "부가가치세·소득세·법인세·원천세·4대보험 규정·국세기본법(가산세·불복)·"
                "조세특례·지방세·상속세·증여세 등 세금 관련 법령 자문 전담. "
                "세금 계산·신고서 작성이 아닌 **세법 규정 자체에 대한 자문** 일 때 선택. "
                "[카테고리: Tax&HR — 세무 자문]"
            ),
            "handler": run_tax_advice,
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "세무 질문 원문"},
                    "topic":    {"type": "string", "description": "vat/income_tax/corporate_tax 등 세목 힌트(선택)"},
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
