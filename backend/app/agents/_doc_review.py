"""서류 공정성 분석 모듈 — gap/eul 비율 + risk_clauses JSON 생성.

파이프라인:
    1. _validate_document   : LLM 으로 비즈니스 문서 여부 1차 검증 (비정상 → 422).
    2. _retrieve_knowledge  : 문서 앞 2000자 임베딩 1회 + 3-way RPC 병렬 호출로
                              (법령 / 위험 패턴 / 허용 조항) 컨텍스트 구성.
    3. analyze              : system + rag_context + 입장(갑/을) 포함 user prompt 로
                              GPT-4o-mini JSON 모드 호출 → ReviewResult.

외부 모듈과의 계약:
    - 임베딩은 `app.core.embedder.embed_text` (sync, BAAI/bge-m3, 1024dim).
    - Supabase RPC 세 개는 012 마이그레이션에서 정의:
        search_law_contract_knowledge
        search_pattern_contract_knowledge
        search_acceptable_contract_knowledge

이 모듈은 artifact 저장이나 파일 업로드를 다루지 않는다 — 순수 분석 함수.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Literal

from app.core.embedder import embed_text
from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.agents._artifact import record_artifact_for_focus

log = logging.getLogger(__name__)

_REVIEW_MODEL = "gpt-4o-mini"

UserRole = Literal["갑", "을", "미지정"]
DocType = Literal["계약서", "제안서", "기타"]


@dataclass
class RiskClause:
    clause: str
    reason: str
    severity: Literal["High", "Mid", "Low"]
    suggestion_from: str
    suggestion_to: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ReviewResult:
    summary: str
    gap_ratio: int
    eul_ratio: int
    risk_clauses: list[RiskClause]

    def to_dict(self) -> dict:
        return {
            "summary": self.summary,
            "gap_ratio": self.gap_ratio,
            "eul_ratio": self.eul_ratio,
            "risk_clauses": [c.to_dict() for c in self.risk_clauses],
        }


class InvalidDocumentError(Exception):
    """비즈니스 문서로 인식되지 않음 (소설·랜덤 텍스트 등)."""


_VALIDATE_PROMPT = """아래 문서가 실제 비즈니스 목적의 문서(계약서·제안서·협약서·견적서·MOU 등)인지 판단하세요.

다음 중 하나에 해당하면 비정상 문서입니다:
- 명백히 허구이거나 비현실적인 내용 (노예계약, 범죄 행위, 판타지 설정 등)
- 비즈니스와 무관한 텍스트 (소설, 뉴스 기사, 개인 일기 등)
- 의미 없는 랜덤 텍스트

JSON 한 줄로만 반환: {{"is_valid": true|false, "reason": "판단 근거 한 줄"}}

[문서]
{content}"""


_SYSTEM_PROMPT = """당신은 한국 계약법과 노동법에 정통한 계약서 검토 전문가입니다.
한국의 법령 기준과 업계 관행을 기준으로 **실질적으로** 문제가 되는 조항만 지적합니다.
관행적이고 합법적인 조항은 위험으로 분류하지 않습니다.

## 입장별 분석 원칙
동일한 계약서라도 의뢰인 입장에 따라 이득/손해 비율과 위험 조항이 달라집니다.
- 갑 입장: 갑에게 불리한 조항, 을에게 과도하게 유리한 조항을 위험으로 분류
- 을 입장: 을에게 불리한 조항, 갑에게 과도하게 유리한 조항을 위험으로 분류
- 을의 손해 비율이 80%이면 갑의 이득 비율은 약 80% 로 일관되게 산출하세요.
"""


_DOC_TYPE_GUIDANCE = {
    "계약서": """\
## 문서 유형: 계약서 (법적 구속력)
- 위반 시 손해배상·위약금·해지 등 페널티 조항
- 해지 조건과 중도 해지 불이익
- 의무 이행 기한과 불이행 책임
- 분쟁 해결 방법(관할 법원, 중재 조항) 편향 여부
- 법령(근로기준법·민법·상법 등) 위반 여부""",
    "제안서": """\
## 문서 유형: 제안서
- 업무 범위(Scope) 모호성 — 추후 분쟁 가능성
- 납기·일정 리스크 — 비현실적 기한 또는 지연 페널티 예고
- 가격·비용 산정 근거
- 지식재산권·결과물 소유권 귀속
- 책임 한계 미명시로 의뢰인 과도 책임 노출""",
    "기타": """\
## 문서 유형: 기타
문서 성격에 맞게 범용적으로 검토하되, 의뢰인에게 불리한 조항과 법적 리스크 중심으로 분석.""",
}


_USER_PROMPT_TEMPLATE = """{rag_context}위 참고 자료를 바탕으로 아래 문서를 "{user_role}" 입장에서 분석하여 다음을 JSON 으로 반환하세요.

의뢰인은 "{user_role}" 입니다. 모든 판단(유불리 비율, 위험 조항, 수정 제안)은 이 입장에서만 작성하세요.

{doc_type_guidance}

## 위험 조항 판단 기준 (반드시 준수)
다음에 해당하는 경우에만 위험 조항으로 분류:
- 한국 법령(근로기준법·민법·상법 등)을 명백히 위반
- 동종 업계 관행 대비 현저히 불리 (단순 불리는 제외)
- 의뢰인에게 일방적으로 과도한 책임/페널티 부과
- 해석이 모호해 분쟁 시 의뢰인에게 불리하게 작용할 가능성이 높음

## 위험 조항이 아닌 것
- 관행적으로 통용되는 조항 (무단결근 무급, 퇴직 1개월 전 통보 등)
- 법적으로 문제없는 표준 조항
- 단순히 다소 불리한 조항

## 출력 형식 (JSON only, 마크다운 금지)
{{
  "summary": "5~7문장 요약 — 문서 종류·의뢰인 입장·주요 조건·유불리 비율 근거·전반적 판단",
  "gap_ratio": 0~100 정수,
  "eul_ratio": 0~100 정수 (gap_ratio + eul_ratio = 100),
  "risk_clauses": [
    {{
      "clause": "해당 조항 원문 발췌 (50자 이내)",
      "reason": "왜 실질적으로 문제인지 (관행/법령 기준 명시)",
      "severity": "High|Mid|Low",
      "suggestion_from": "수정이 필요한 부분 원문 (30자 이내)",
      "suggestion_to": "상대가 수락 가능한 수정 문구 (50자 이내)"
    }}
  ]
}}

[문서 원문]
{content}"""


def _call_rpc(name: str, params: dict) -> list[dict]:
    try:
        resp = get_supabase().rpc(name, params).execute()
        return resp.data or []
    except Exception as exc:
        log.warning("rpc %s failed: %s", name, exc)
        return []


def _retrieve_knowledge(content: str, contract_subtype: str | None) -> str:
    """문서 앞 2000자로 3-way RAG 검색 → system 에 주입할 문자열 반환."""
    query = content[:2000].strip()
    if not query:
        return ""

    try:
        embedding = embed_text(query)
    except Exception as exc:
        log.warning("embed_text failed: %s", exc)
        return ""
    emb_str = "[" + ",".join(f"{v:.10f}" for v in embedding) + "]"

    law = _call_rpc("search_law_contract_knowledge", {
        "query_text": query,
        "query_embedding": emb_str,
        "match_count": 4,
        "filter_category": contract_subtype if contract_subtype in ("labor", "lease", "service", "supply") else None,
        "min_score": 0.3,
        "min_trgm_score": 0.5,
        "min_content_len": 40,
    })
    pattern = _call_rpc("search_pattern_contract_knowledge", {
        "query_text": query,
        "query_embedding": emb_str,
        "match_count": 4,
        "filter_risk_level": None,
        "filter_contract_type": contract_subtype,
        "min_score": 0.25,
        "min_trgm_score": 0.35,
        "min_content_len": 30,
    })
    acceptable = _call_rpc("search_acceptable_contract_knowledge", {
        "query_text": query,
        "query_embedding": emb_str,
        "match_count": 4,
        "filter_contract_type": contract_subtype,
        "min_score": 0.25,
        "min_trgm_score": 0.35,
        "min_content_len": 30,
    })

    if not (law or pattern or acceptable):
        return ""

    lines: list[str] = []
    if law:
        lines.append("[관련 법령 조문]")
        for c in law:
            meta = c.get("metadata") or {}
            src = f"{meta.get('law_name') or ''} {meta.get('article') or ''}".strip() or "출처 불명"
            lines.append(f"출처: {src}")
            lines.append(f"내용: {(c.get('content') or '').strip()}")
            lines.append("")
    if pattern:
        lines.append("[위험 조항 패턴]")
        for c in pattern:
            lines.append(
                f"패턴: {c.get('pattern_name') or ''} | 위험도: {c.get('risk_level') or ''} | 계약유형: {c.get('contract_type') or ''}"
            )
            lines.append(f"내용: {(c.get('content') or '').strip()}")
            lines.append("")
    if acceptable:
        lines.append("[관행적 허용 조항 — 아래 조항은 업계 관행상 수락 가능]")
        for c in acceptable:
            lines.append(
                f"허용조항: {c.get('clause_name') or ''} | 근거: {c.get('legal_basis') or ''} | 계약유형: {c.get('contract_type') or ''}"
            )
            lines.append(f"내용: {(c.get('content') or '').strip()}")
            lines.append("")
    lines.append("---\n")
    return "\n".join(lines)


async def _validate_document(content: str) -> None:
    resp = await chat_completion(
        messages=[{"role": "user", "content": _VALIDATE_PROMPT.format(content=content[:2000])}],
        model=_REVIEW_MODEL,
        response_format={"type": "json_object"},
        temperature=0,
    )
    raw = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return
    if not data.get("is_valid", True):
        raise InvalidDocumentError(data.get("reason", "비즈니스 문서로 인식되지 않습니다."))


async def analyze(
    content: str,
    *,
    user_role: UserRole = "미지정",
    doc_type: DocType = "기타",
    contract_subtype: str | None = None,
) -> ReviewResult:
    """문서 텍스트 → 공정성 분석 결과.

    Raises:
        InvalidDocumentError: 비즈니스 문서로 인식 안 됨
        ValueError:           LLM 응답이 JSON 파싱 실패
    """
    await _validate_document(content)

    rag_context = _retrieve_knowledge(content, contract_subtype)

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _USER_PROMPT_TEMPLATE.format(
                    rag_context=rag_context,
                    content=content,
                    user_role=user_role,
                    doc_type_guidance=_DOC_TYPE_GUIDANCE.get(doc_type, _DOC_TYPE_GUIDANCE["기타"]),
                ),
            },
        ],
        model=_REVIEW_MODEL,
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    raw = (resp.choices[0].message.content or "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM 응답 JSON 파싱 실패: {e}\n원문 앞 300자: {raw[:300]}")

    raw_clauses = data.get("risk_clauses") or []
    risk_clauses: list[RiskClause] = []
    for c in raw_clauses:
        sev = (c.get("severity") or "Mid").capitalize()
        if sev not in ("High", "Mid", "Low"):
            sev = "Mid"
        risk_clauses.append(
            RiskClause(
                clause=str(c.get("clause") or "")[:400],
                reason=str(c.get("reason") or "")[:600],
                severity=sev,  # type: ignore[arg-type]
                suggestion_from=str(c.get("suggestion_from") or c.get("suggestion") or "")[:200],
                suggestion_to=str(c.get("suggestion_to") or "")[:400],
            )
        )

    gap = int(data.get("gap_ratio") or 50)
    eul = int(data.get("eul_ratio") or (100 - gap))
    # 합이 100 이 아니면 보정
    if gap + eul != 100:
        eul = max(0, min(100, 100 - gap))

    return ReviewResult(
        summary=str(data.get("summary") or "")[:2000],
        gap_ratio=gap,
        eul_ratio=eul,
        risk_clauses=risk_clauses,
    )


async def dispatch_review(
    *,
    account_id: str,
    doc_artifact_id: str,
    user_role: UserRole = "미지정",
    doc_type: DocType = "계약서",
    contract_subtype: str | None = None,
) -> dict:
    """분석 실행 + analysis artifact 저장 + analyzed_from 엣지 + activity + 임베딩.

    reviews 라우터 + documents 에이전트 공용. 실패 시 예외를 그대로 던진다.
    """
    sb = get_supabase()

    doc = (
        sb.table("artifacts")
        .select("id,account_id,title,content,type,metadata")
        .eq("id", doc_artifact_id)
        .eq("account_id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not doc:
        raise ValueError("업로드된 문서를 찾을 수 없습니다.")
    d = doc[0]
    if d.get("type") != "uploaded_doc":
        raise ValueError("분석 대상은 uploaded_doc 만 허용됩니다.")

    content = (d.get("content") or "").strip()
    if not content:
        raise ValueError("문서 본문이 비어 있습니다.")

    result = await analyze(
        content,
        user_role=user_role,
        doc_type=doc_type,
        contract_subtype=contract_subtype,
    )

    title = f"[검토] {d.get('title') or '문서'}"[:180]
    analysis_meta = {
        "analyzed_doc_id": d["id"],
        "user_role":       user_role,
        "doc_type":        doc_type,
        "contract_subtype": contract_subtype,
        "gap_ratio":       result.gap_ratio,
        "eul_ratio":       result.eul_ratio,
        "risk_clauses":    [c.to_dict() for c in result.risk_clauses],
    }

    ins = sb.table("artifacts").insert({
        "account_id": account_id,
        "domains":    ["documents"],
        "kind":       "artifact",
        "type":       "analysis",
        "title":      title,
        "content":    result.summary,
        "status":     "active",
        "metadata":   analysis_meta,
    }).execute()
    if not ins.data:
        raise RuntimeError("분석 결과 저장 실패")
    analysis_id = ins.data[0]["id"]
    record_artifact_for_focus(analysis_id)

    # analyzed_from 엣지: 원본 업로드 문서만 유일한 부모.
    # (서브허브 contains 엣지는 의도적으로 생성하지 않음 — 분석 결과는 업로드 노드의 자식으로만 존재)
    try:
        sb.table("artifact_edges").insert({
            "account_id": account_id,
            "parent_id":  d["id"],
            "child_id":   analysis_id,
            "relation":   "analyzed_from",
        }).execute()
    except Exception:
        pass

    try:
        sb.table("activity_logs").insert({
            "account_id":  account_id,
            "type":        "artifact_created",
            "domain":      "documents",
            "title":       title,
            "description": f"공정성 분석 완료 · 갑 {result.gap_ratio}% / 을 {result.eul_ratio}% · 위험 {len(result.risk_clauses)}건",
            "metadata":    {"artifact_id": analysis_id, "analyzed_doc_id": d["id"]},
        }).execute()
    except Exception:
        pass

    try:
        from app.rag.embedder import index_artifact
        risk_summary = " / ".join(c.clause[:60] for c in result.risk_clauses[:5])
        index_text = f"{title}\n{result.summary}\n위험조항: {risk_summary}"
        await index_artifact(account_id, "documents", analysis_id, index_text)
    except Exception:
        pass

    return {
        "analysis_id":     analysis_id,
        "analyzed_doc_id": d["id"],
        "summary":         result.summary,
        "gap_ratio":       result.gap_ratio,
        "eul_ratio":       result.eul_ratio,
        "risk_clauses":    [c.to_dict() for c in result.risk_clauses],
    }
