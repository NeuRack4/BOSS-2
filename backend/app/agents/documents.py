from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone

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
    build_doc_context,
    detect_doc_intent,
)
from app.agents._doc_review import InvalidDocumentError, dispatch_review

log = logging.getLogger(__name__)


VALID_TYPES: tuple[str, ...] = (
    "contract",
    "estimate",
    "proposal",
    "notice",
    "checklist",
    "guide",
)

_REVIEW_REQUEST_RE = re.compile(r"\[REVIEW_REQUEST\](.*?)\[/REVIEW_REQUEST\]", re.DOTALL)
_UPLOADED_DOC_WINDOW_MIN = 60  # 최근 60분 이내 업로드만 컨텍스트로 자동 노출


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


def _find_recent_uploaded_doc(account_id: str) -> dict | None:
    """최근 60분 이내 업로드된 uploaded_doc artifact 1개 반환 (가장 최신)."""
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
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _find_recent_analysis_for(account_id: str, doc_id: str) -> dict | None:
    sb = get_supabase()
    rows = (
        sb.table("artifacts")
        .select("id,title,content,metadata,created_at")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .eq("type", "analysis")
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
        or []
    )
    for r in rows:
        meta = r.get("metadata") or {}
        if meta.get("analyzed_doc_id") == doc_id:
            return r
    return None


def _build_upload_context(account_id: str) -> str:
    doc = _find_recent_uploaded_doc(account_id)
    if not doc:
        return ""
    meta = doc.get("metadata") or {}
    preview = (doc.get("content") or "")[:600]
    chunks = [
        "[최근 업로드 문서]",
        f"doc_id: {doc['id']}",
        f"title: {doc.get('title','')}",
        f"original_name: {meta.get('original_name','')}",
        f"mime: {meta.get('mime_type','')}  ·  size: {meta.get('size_bytes',0)} bytes  ·  parsed_len: {meta.get('parsed_len',0)}",
        f"uploaded_at: {doc.get('created_at','')}",
        "--- 본문 앞부분 ---",
        preview,
    ]
    # 동일 문서에 대해 이미 분석이 있으면 같이 노출
    analysis = _find_recent_analysis_for(account_id, doc["id"])
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
    if not parsed.get("doc_id"):
        return None
    return parsed


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
        lines.append("")
        lines.append(f"**주요 위험 조항 ({len(risks)}건)**")
        for i, c in enumerate(risks[:5], 1):
            sev = c.get("severity", "Mid")
            lines.append(f"{i}. [{sev}] {c.get('clause','')[:80]}")
            r = c.get("reason") or ""
            if r:
                lines.append(f"   - 사유: {r[:150]}")
            sf = c.get("suggestion_from") or ""
            st = c.get("suggestion_to") or ""
            if sf and st:
                lines.append(f"   - 수정: `{sf[:60]}` → `{st[:80]}`")
        if len(risks) > 5:
            lines.append(f"... 외 {len(risks) - 5}건 (분석 노드에서 전체 확인)")
    lines.append("")
    lines.append(f"_(분석 artifact: `{result['analysis_id']}` — 캔버스에서 원본 문서와 함께 확인할 수 있어요.)_")

    # 프론트엔드 ReviewResultCard 렌더용 구조화 페이로드. 사용자에겐 노출되지 않고 파서가 잘라낸다.
    payload = {
        "analysis_id":     result["analysis_id"],
        "analyzed_doc_id": result.get("analyzed_doc_id"),
        "gap_ratio":       result["gap_ratio"],
        "eul_ratio":       result["eul_ratio"],
        "summary":         result.get("summary") or "",
        "risk_clauses":    result.get("risk_clauses") or [],
    }
    lines.append(f"[[REVIEW_JSON]]{json.dumps(payload, ensure_ascii=False)}[[/REVIEW_JSON]]")
    return "\n".join(lines)


async def _maybe_dispatch_review(account_id: str, reply: str) -> str:
    """응답 본문의 [REVIEW_REQUEST] 블록을 감지해 분석을 실행하고 결과를 덧붙임."""
    marker = _parse_review_marker(reply)
    if not marker:
        return reply
    doc_id = marker["doc_id"]
    user_role = marker.get("user_role") or "미지정"
    if user_role not in ("갑", "을", "미지정"):
        user_role = "미지정"
    doc_type = marker.get("doc_type") or "계약서"
    if doc_type not in ("계약서", "제안서", "기타"):
        doc_type = "계약서"
    subtype = marker.get("contract_subtype") or None
    if subtype == "" or subtype == "없음":
        subtype = None

    cleaned = _strip_review_marker(reply)
    try:
        result = await dispatch_review(
            account_id=account_id,
            doc_artifact_id=doc_id,
            user_role=user_role,        # type: ignore[arg-type]
            doc_type=doc_type,           # type: ignore[arg-type]
            contract_subtype=subtype,
        )
    except InvalidDocumentError as e:
        return cleaned + f"\n\n---\n_(분석 실패: {e} — 비즈니스 문서가 맞는지 확인해주세요.)_"
    except ValueError as e:
        return cleaned + f"\n\n---\n_(분석 실패: {e})_"
    except Exception as e:
        log.exception("review dispatch failed")
        return cleaned + f"\n\n---\n_(분석 중 예기치 못한 오류: {str(e)[:150]})_"
    return cleaned + _format_review_append(result)


async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    # 1. 휴리스틱 intent 감지 → 템플릿/법령 컨텍스트 주입
    type_guess, subtype_guess = detect_doc_intent(message)
    if not type_guess:
        for h in reversed(history[-6:]):
            if h.get("role") == "user":
                t2, s2 = detect_doc_intent(h.get("content") or "")
                if t2:
                    type_guess, subtype_guess = t2, s2
                    break

    doc_ctx = build_doc_context(type_guess, subtype_guess)

    system = SYSTEM_PROMPT + "\n\n" + today_context() + "\n\n" + doc_ctx

    upload_ctx = _build_upload_context(account_id)
    if upload_ctx:
        system += "\n\n" + upload_ctx

    hubs = list_sub_hub_titles(account_id, "documents")
    if hubs:
        system += "\n\n[이 계정의 documents 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "documents")
    if fb:
        system += f"\n\n{fb}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content or ""

    # 2. REVIEW 마커가 있으면 분석 실행 + 결과 본문에 덧붙임
    reply = await _maybe_dispatch_review(account_id, reply)

    # 3. 일반 artifact 저장 (계약서 초안 등)
    await save_artifact_from_reply(
        account_id,
        "documents",
        reply,
        default_title="서류",
        valid_types=VALID_TYPES,
        extra_meta_keys=("due_label", "contract_subtype"),
        subtype_whitelist={"contract_subtype": VALID_CONTRACT_SUBTYPES},
    )
    return reply
