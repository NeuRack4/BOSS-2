# Phase 2: Documents DeepAgent 전환 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `documents.py`의 내부 LangGraph StateGraph(classify→route→write 7-node)를 deepagents SDK DeepAgent로 교체한다. 외부 인터페이스(`describe()` + `run_*` 핸들러)는 그대로 유지한다.

**Architecture:** 각 `run_*` 핸들러는 `_run_documents_agent()` 공통 함수를 호출한다. 이 함수가 Documents DeepAgent를 생성·실행하며, non-terminal tool로 컨텍스트를 수집한 뒤 terminal tool(`write_document` 또는 `analyze_document`)을 호출해 artifact를 저장한다. 기존 `save_artifact_from_reply()`는 그대로 사용하되, LLM이 `[ARTIFACT]` 마커를 생성하지 않고 tool이 프로그래매틱하게 구성한다.

**Tech Stack:** `deepagents` SDK, `langchain-anthropic` / `langchain-openai`, `langchain-core @tool`, Python ContextVar, `app.agents._artifact.save_artifact_from_reply`

---

## 변경 파일 목록

| 역할 | 파일 |
|------|------|
| **생성** | `backend/app/agents/_documents_tools.py` |
| **수정** | `backend/app/agents/documents.py` (StateGraph 제거, DeepAgent 연결) |
| **생성** | `backend/tests/agents/test_documents_tools.py` |

---

## 배경 지식 (구현 전 필독)

### 현재 문제
`documents.py`의 내부 StateGraph는 `run_contract()` 같은 핸들러가 호출될 때도 `_classify_node`가 **다시** intent를 분류한다. Planner가 이미 `doc_contract` capability를 선택했는데도 classify node가 또 분류하는 이중 작업이다.

### 목표 흐름
```
orchestrator → run_contract(..., subtype="labor", ...) 
  → _run_documents_agent(system=<계약서 시스템프롬프트>, step_args={subtype="labor"})
    → DeepAgent
        → get_sub_hubs() [non-terminal]
        → (필요시) get_uploaded_doc() [non-terminal]
        → write_document(doc_type="contract", title="근로계약서", content="...") [TERMINAL]
    → _execute_write() → save_artifact_from_reply() → Supabase 저장
  → reply 반환
```

### 핵심 인터페이스
- `app.agents._artifact.save_artifact_from_reply` — artifact 저장 (기존 그대로)
- `app.agents._artifact.list_sub_hub_titles(account_id, domain)` — 서브허브 목록
- `app.agents._doc_review.dispatch_review(account_id, doc_artifact_id, ephemeral_doc, user_role, doc_type, contract_subtype)` — 공정성 분석 + artifact 저장
- `app.agents._agent_context.inject_agent_context / get_account_id / get_history / get_rag_context / get_long_term_context` — Phase 1에서 생성한 ContextVar

---

## Task 1: `_documents_tools.py` — Non-terminal Tools + Result Store

**Files:**
- Create: `backend/app/agents/_documents_tools.py`

- [ ] **Step 1: 파일 생성**

`backend/app/agents/_documents_tools.py`:

```python
"""Documents DeepAgent 도구 모음.

Non-terminal: get_uploaded_doc, get_recent_analysis, get_sub_hubs
Terminal: write_document, analyze_document
Result store: init_docs_result_store / get_docs_result_store
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any

from langchain_core.tools import tool

from app.agents._agent_context import get_account_id, get_history, get_rag_context, get_long_term_context

log = logging.getLogger("boss2.documents_tools")

# ──────────────────────────────────────────────────────────────────────────
# Per-request result store
# ──────────────────────────────────────────────────────────────────────────
_docs_result: ContextVar[dict | None] = ContextVar("docs_result", default=None)


def init_docs_result_store() -> dict:
    """요청 시작 시 호출 — 빈 dict로 초기화하고 반환."""
    store: dict = {}
    _docs_result.set(store)
    return store


def get_docs_result_store() -> dict | None:
    """현재 결과 store 반환. terminal tool 호출 전이면 빈 dict."""
    return _docs_result.get(None)


# ──────────────────────────────────────────────────────────────────────────
# Non-terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def get_uploaded_doc() -> dict:
    """최근 업로드된 문서의 내용과 메타데이터를 반환합니다.
    공정성 분석 요청 시 반드시 먼저 호출해 doc_id를 확인하세요.
    업로드 문서가 없으면 빈 dict를 반환합니다.
    """
    account_id = get_account_id()
    from app.agents.documents import _find_recent_uploaded_doc
    doc = _find_recent_uploaded_doc(account_id)
    if not doc:
        return {}
    return {
        "id":      doc.get("id"),
        "title":   doc.get("title") or "",
        "preview": (doc.get("content") or "")[:600],
        "ephemeral": bool(doc.get("_ephemeral")),
    }


@tool
def get_recent_analysis() -> dict:
    """직전에 수행된 공정성 분석 결과를 반환합니다.
    분석 결과가 없으면 빈 dict를 반환합니다.
    """
    account_id = get_account_id()
    from app.agents.documents import _find_recent_analysis
    analysis = _find_recent_analysis(account_id)
    if not analysis:
        return {}
    meta = analysis.get("metadata") or {}
    return {
        "analysis_id":       analysis.get("id"),
        "user_role":         meta.get("user_role", "미지정"),
        "gap_ratio":         meta.get("gap_ratio"),
        "eul_ratio":         meta.get("eul_ratio"),
        "contract_subtype":  meta.get("contract_subtype"),
        "summary":           (analysis.get("content") or "")[:400],
    }


@tool
def get_sub_hubs() -> list[str]:
    """이 계정의 Documents 서브허브 목록을 반환합니다.
    서류 저장 시 sub_domain 결정에 참고하세요.
    서브허브는 Review, Tax&HR, Operations, Legal 4종입니다.
    """
    account_id = get_account_id()
    from app.agents._artifact import list_sub_hub_titles
    return list_sub_hub_titles(account_id, "documents")


# ──────────────────────────────────────────────────────────────────────────
# Terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def write_document(
    doc_type: str,
    title: str,
    content: str,
    subtype: str | None = None,
    due_date: str | None = None,
    due_label: str | None = None,
) -> str:
    """[TERMINAL] 서류를 작성하고 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    doc_type: contract | estimate | proposal | notice | checklist | guide |
              subsidy_recommendation | admin_application | hr_evaluation |
              payroll_doc | tax_calendar
    title: 문서 제목 (예: "근로계약서 — 주방 보조 홍길동")
    content: 완성된 문서 본문 (마크다운). 반드시 실제 내용으로 채울 것. placeholder 금지.
    subtype: contract 에만 사용 (labor|lease|service|supply|partnership|franchise|nda)
    due_date: YYYY-MM-DD 형식 기한 (견적 유효기간, 계약 만료일 등)
    due_label: 기한 설명 (예: "계약 만료", "견적 유효기간")
    """
    store = _docs_result.get(None)
    if store is not None:
        store["action"] = "write"
        store["doc_type"] = doc_type
        store["title"] = title
        store["content"] = content
        store["subtype"] = subtype
        store["due_date"] = due_date
        store["due_label"] = due_label
    return "서류가 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def analyze_document(
    user_role: str,
    doc_type: str = "계약서",
    contract_subtype: str | None = None,
) -> str:
    """[TERMINAL] 업로드된 문서의 공정성을 분석합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    반드시 get_uploaded_doc()을 먼저 호출해 doc_id를 확인한 뒤 이 도구를 호출하세요.

    user_role: 갑 | 을 | 미지정
    doc_type: 계약서 | 제안서 | 기타
    contract_subtype: labor | lease | service | supply | partnership | franchise | nda (없으면 None)
    """
    store = _docs_result.get(None)
    if store is not None:
        store["action"] = "analyze"
        store["user_role"] = user_role
        store["doc_type"] = doc_type
        store["contract_subtype"] = contract_subtype
    return "공정성 분석이 시작됩니다. 추가 도구 호출 없이 종료하세요."


# 편의 export
DOCUMENTS_TOOLS = [
    get_uploaded_doc,
    get_recent_analysis,
    get_sub_hubs,
    write_document,
    analyze_document,
]

DOCUMENTS_TERMINAL_TOOL_NAMES = {"write_document", "analyze_document"}
```

- [ ] **Step 2: import 검증**

```bash
cd backend
C:/Users/pc/anaconda3/envs/boss2/python.exe -c "
from app.agents._documents_tools import (
    DOCUMENTS_TOOLS, DOCUMENTS_TERMINAL_TOOL_NAMES,
    init_docs_result_store, get_docs_result_store,
    write_document, analyze_document,
)
print(len(DOCUMENTS_TOOLS), 'tools')
print(DOCUMENTS_TERMINAL_TOOL_NAMES)
print('OK')
"
```

Expected: `5 tools`, `{'write_document', 'analyze_document'}`, `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/_documents_tools.py
git commit -m "feat: _documents_tools.py — Documents DeepAgent tools (non-terminal 3 + terminal 2)"
```

---

## Task 2: `documents.py` — DeepAgent 실행 엔진 추가

**Files:**
- Modify: `backend/app/agents/documents.py` (맨 위 import 영역 + 새 함수 추가)

StateGraph를 제거하기 전에 DeepAgent runner를 먼저 추가한다.

- [ ] **Step 1: 상단 import에 deepagents 관련 추가**

`backend/app/agents/documents.py` 파일의 import 블록(현재 1–45줄)을 수정한다. 기존 import를 유지하고 아래 내용을 추가:

```python
# 기존 import 맨 끝에 추가 (langgraph import 아래)
from deepagents import create_deep_agent
from app.agents._agent_context import inject_agent_context
from app.agents._documents_tools import (
    DOCUMENTS_TOOLS,
    init_docs_result_store,
    get_docs_result_store,
)
from app.core.config import settings
```

- [ ] **Step 2: `_make_docs_model()` 팩토리 함수 추가**

`documents.py`의 `SYSTEM_PROMPT` 상수 정의 바로 위(현재 ~97줄)에 추가:

```python
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
```

- [ ] **Step 3: `_execute_write()` 헬퍼 추가**

`_build_upload_context()` 함수 아래(현재 ~280줄)에 추가:

```python
async def _execute_write(account_id: str, result_data: dict) -> str:
    """write_document terminal tool 결과를 Supabase에 저장하고 reply 반환."""
    doc_type = result_data.get("doc_type", "")
    title    = result_data.get("title", "문서")
    content  = result_data.get("content", "")
    subtype  = result_data.get("subtype")
    due_date = result_data.get("due_date")
    due_label = result_data.get("due_label")

    # [ARTIFACT] 블록을 프로그래매틱하게 구성 (LLM 마커 의존 제거)
    subhub = _TYPE_TO_SUBHUB.get(doc_type, "Operations")
    meta_lines = [f"type: {doc_type}", f"title: {title}", f"sub_domain: {subhub}"]
    if subtype:
        meta_lines.append(f"contract_subtype: {subtype}")
    if due_date:
        meta_lines.append(f"due_date: {due_date}")
    if due_label:
        meta_lines.append(f"due_label: {due_label}")

    artifact_block = "[ARTIFACT]\n" + "\n".join(meta_lines) + "\n\n" + content + "\n[/ARTIFACT]"
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

    # 사용자 응답 (마커 없이 깔끔하게)
    doc_label = {
        "contract": "계약서", "estimate": "견적서", "proposal": "제안서",
        "notice": "공지문", "checklist": "체크리스트", "guide": "가이드",
        "subsidy_recommendation": "지원사업 추천서", "admin_application": "행정 신청서",
        "hr_evaluation": "인사평가서", "payroll_doc": "급여명세서", "tax_calendar": "세무 캘린더",
    }.get(doc_type, "서류")

    return f"{doc_label} **{title}**을 작성하고 저장했습니다." + (
        f"\n\n캔버스에서 확인하실 수 있어요. (artifact id: `{artifact_id}`)" if artifact_id else ""
    )
```

- [ ] **Step 4: `_execute_analyze()` 헬퍼 추가**

`_execute_write()` 바로 아래에 추가:

```python
async def _execute_analyze(account_id: str, result_data: dict) -> str:
    """analyze_document terminal tool 결과로 실제 공정성 분석을 실행."""
    user_role      = result_data.get("user_role", "미지정")
    doc_type_str   = result_data.get("doc_type", "계약서")
    contract_subtype = result_data.get("contract_subtype")

    # 업로드된 문서 다시 조회
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
        return f"문서 분석 실패: {e}"

    return "분석을 시작하겠습니다." + _format_review_append(result)
```

- [ ] **Step 5: `_run_documents_agent()` 메인 함수 추가**

`_execute_analyze()` 바로 아래에 추가:

```python
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
    """Documents DeepAgent 실행 공통 함수.

    각 run_* 핸들러가 이 함수를 호출한다.
    """
    inject_agent_context(account_id, message, history, rag_context, long_term_context)
    store = init_docs_result_store()

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
            out_messages = await _invoke(system_prompt + "\n\n" + _DOCS_TERMINAL_REMINDER)
        except Exception as exc:
            log.exception("[documents] retry invoke failed")
            return f"서류 처리 중 오류가 발생했습니다: {exc}"
        result_data = get_docs_result_store()

    if not result_data:
        # chitchat fallback (법률·세무 Q&A 등 저장 없는 응답)
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
```

- [ ] **Step 6: import 검증**

```bash
cd backend
C:/Users/pc/anaconda3/envs/boss2/python.exe -c "
from app.agents.documents import _run_documents_agent, _execute_write, _execute_analyze
print('OK')
"
```

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/app/agents/documents.py
git commit -m "feat: documents.py — DeepAgent runner (_run_documents_agent) + execute helpers 추가"
```

---

## Task 3: `documents.py` — 핵심 핸들러 DeepAgent로 전환

**Files:**
- Modify: `backend/app/agents/documents.py` (run_contract, run_estimate, run_review, run_legal_advice 수정)

이 Task는 가장 핵심적인 4개 핸들러를 전환한다. 나머지 핸들러는 Task 4에서 처리한다.

- [ ] **Step 1: `run_contract` 전환**

`documents.py`에서 `run_contract` 함수를 찾아 다음으로 교체:

```python
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
```

- [ ] **Step 2: `run_estimate` 전환**

```python
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
```

- [ ] **Step 3: `run_review` 전환 (doc_review 핸들러)**

`documents.py`에서 `run_review` 함수를 찾아 교체:

```python
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

[이번 요청 — 공정성 분석]
업로드된 문서에 대한 공정성 분석을 수행합니다.

확정된 정보:
{role_ctx}{subtype_ctx}

[수행 순서]
1. get_uploaded_doc() 호출로 문서 내용과 doc_id 확인
2. user_role이 확정되지 않았으면 문서를 보고 판단, 혹은 "미지정"으로 진행
3. analyze_document(user_role="<갑|을|미지정>", doc_type="계약서",
   contract_subtype="<subtype 또는 None>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)
```

- [ ] **Step 4: `run_legal_advice` 전환**

```python
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
```

- [ ] **Step 5: 검증 (import + 함수 존재 확인)**

```bash
cd backend
C:/Users/pc/anaconda3/envs/boss2/python.exe -c "
from app.agents.documents import run_contract, run_estimate, run_review, run_legal_advice
print('핸들러 OK')
"
```

Expected: `핸들러 OK`

- [ ] **Step 6: Commit**

```bash
git add backend/app/agents/documents.py
git commit -m "feat: documents.py — run_contract/estimate/review/legal_advice DeepAgent로 전환"
```

---

## Task 4: `documents.py` — 나머지 핸들러 전환 + StateGraph 제거

**Files:**
- Modify: `backend/app/agents/documents.py`

- [ ] **Step 1: 나머지 핸들러 전환**

아래 핸들러들을 같은 패턴으로 전환한다. 각 핸들러는 `run()` 대신 `_run_documents_agent()`를 호출하며, capability별 system prompt를 주입한다.

`run_notice`:
```python
@traceable(name="documents.run_notice")
async def run_notice(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    target: str | None = None,
    content_summary: str | None = None,
    effective_date: str | None = None,
    **_kwargs,
) -> str:
    ctx = "\n".join(filter(None, [
        f"공지 대상: {target}" if target else "",
        f"내용 요약: {content_summary}" if content_summary else "",
        f"게시일: {effective_date}" if effective_date else "",
    ]))
    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 공지문 작성]
{_CATEGORY_GUIDANCE['operations']}
{ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 공지문 작성
3. write_document(doc_type="notice", title="공지 — <내용 요약>", content="<전체 본문>",
   due_date="<effective_date>", due_label="공지 게시일") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)
```

`run_proposal`:
```python
@traceable(name="documents.run_proposal")
async def run_proposal(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    client: str | None = None,
    project_summary: str | None = None,
    budget: str | None = None,
    **_kwargs,
) -> str:
    ctx = "\n".join(filter(None, [
        f"제안 대상: {client}" if client else "",
        f"프로젝트 요약: {project_summary}" if project_summary else "",
        f"예산: {budget}" if budget else "",
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
```

`run_checklist_guide`:
```python
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

[이번 요청 — {('체크리스트' if doc_type == 'checklist' else '가이드')} 작성]
{_CATEGORY_GUIDANCE['tax_hr']}
{ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 {"체크리스트 (항목별 확인란 포함)" if doc_type == "checklist" else "가이드 (단계별 절차)"} 작성
3. write_document(doc_type="{doc_type}", title="<적절한 제목>", content="<전체 본문>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)
```

`run_tax_advice`:
```python
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
```

`run_subsidy_recommend`, `run_admin_application`, `run_payroll_doc`, `run_tax_calendar`의 경우: 이 핸들러들은 복잡한 DB 쿼리(직원 목록, 지원사업 DB)나 Excel 생성 로직이 포함되어 있다. 현재 Turn에서 전환하지 않고 **기존 코드를 그대로 유지**한다. 이 핸들러들은 여전히 `run()` (StateGraph)를 호출한다 — StateGraph를 완전히 제거하기 전에 이 핸들러들을 전환해야 한다.

> **주의:** `run_subsidy_recommend`, `run_admin_application`, `run_payroll_doc`, `run_tax_calendar`가 아직 `run()`을 호출하므로 StateGraph(`_graph`)를 이 Task에서 제거하지 **않는다**. Task 5에서 이 4개 핸들러도 전환 후 StateGraph를 제거한다.

- [ ] **Step 2: import 검증**

```bash
cd backend
C:/Users/pc/anaconda3/envs/boss2/python.exe -c "
from app.agents.documents import (
    run_notice, run_proposal, run_checklist_guide,
    run_tax_advice,
)
print('OK')
"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/documents.py
git commit -m "feat: documents.py — run_notice/proposal/checklist_guide/tax_advice DeepAgent 전환"
```

---

## Task 5: `documents.py` — 복잡 핸들러 전환 + StateGraph 완전 제거

**Files:**
- Modify: `backend/app/agents/documents.py`

- [ ] **Step 1: 남은 4개 핸들러 간단 전환**

`run_subsidy_recommend`는 국가 지원사업 DB 조회 + 매칭 로직이 있다. 전환 시 기존 DB 쿼리 로직을 system prompt 컨텍스트로 주입하는 방식으로 처리한다.

먼저 `documents.py`에서 `run_subsidy_recommend`, `run_admin_application`, `run_payroll_doc`, `run_tax_calendar` 함수를 찾아 각각의 로직을 읽은 뒤, 아래 패턴으로 전환한다:

```python
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
    # 기존 DB 조회 로직 유지 — 지원사업 목록을 system 컨텍스트에 주입
    # (현재 함수에서 DB 쿼리하는 코드를 그대로 가져와 context 문자열로 변환)
    sb = get_supabase()
    programs = (
        sb.table("subsidy_programs")
        .select("name,description,target,deadline,max_amount")
        .order("deadline", desc=False)
        .limit(10)
        .execute()
        .data or []
    )
    programs_ctx = "\n".join(
        f"- {p['name']}: {p.get('description','')[:80]} (마감: {p.get('deadline','?')}, 최대 {p.get('max_amount','?')})"
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
```

`run_admin_application`:
```python
@traceable(name="documents.run_admin_application")
async def run_admin_application(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    admin_type: str | None = None,
    **_kwargs,
) -> str:
    from app.agents._admin_templates import ADMIN_TYPE_LABELS, build_admin_context
    type_labels = "\n".join(f"- {k}: {v}" for k, v in ADMIN_TYPE_LABELS.items())
    admin_ctx = build_admin_context(admin_type) if admin_type else ""

    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 행정 신청서 작성]
{_CATEGORY_GUIDANCE['operations']}

지원 행정서류 종류:
{type_labels}

{f'선택된 서류 유형: {admin_type}' if admin_type else '서류 유형을 먼저 확인하세요.'}
{admin_ctx}

[수행 순서]
1. get_sub_hubs() 호출
2. 완성된 행정 신청서 작성
3. write_document(doc_type="admin_application", title="<행정서류명>", content="<전체 내용>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)
```

`run_payroll_doc` — 이 핸들러는 Excel 생성 로직이 포함되어 있다. Excel 생성은 DeepAgent 내부에서 할 수 없으므로, 기존 Excel 생성 로직은 `_execute_write`에서 `doc_type="payroll_doc"` 처리 분기를 추가해 유지한다. 단, 이 Task에서는 일단 simple text 버전으로 전환하고 Excel 생성은 DONE_WITH_CONCERNS로 보고한다:

```python
@traceable(name="documents.run_payroll_doc")
async def run_payroll_doc(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    year_month: str | None = None,
    **_kwargs,
) -> str:
    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 급여명세서 작성]
{_CATEGORY_GUIDANCE['tax_hr']}

{f'대상 연월: {year_month}' if year_month else ''}

[수행 순서]
1. get_sub_hubs() 호출
2. 급여명세서 내용 작성 (직원별 급여 항목 표 포함)
3. write_document(doc_type="payroll_doc", title="급여명세서 {year_month or ''}", content="<전체 내용>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)
```

`run_tax_calendar`:
```python
@traceable(name="documents.run_tax_calendar")
async def run_tax_calendar(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    year: str | None = None,
    **_kwargs,
) -> str:
    system = f"""{SYSTEM_PROMPT}

[이번 요청 — 세무 캘린더 작성]
{_CATEGORY_GUIDANCE['tax_hr']}

{f'대상 연도: {year}' if year else '올해 기준'}

[수행 순서]
1. get_sub_hubs() 호출
2. 월별 세무 신고 일정 정리 (부가세, 종합소득세, 4대보험 등)
3. write_document(doc_type="tax_calendar", title="세무 캘린더 {year or ''}", content="<전체 내용>") 호출
"""
    return await _run_documents_agent(account_id, message, history, rag_context, long_term_context, system)
```

- [ ] **Step 2: StateGraph 관련 코드 제거**

`documents.py`에서 다음을 제거:
- `from langgraph.graph import StateGraph, END` import 줄
- `DocState` TypedDict
- `DocCategory`, `DocIntent` Literal 타입 (외부에서 사용하지 않으면)
- `_CATEGORY_GUIDANCE` dict (Task 3-4에서 이미 각 핸들러에 인라인으로 사용했으므로 유지)
- `_classify_node`, `_legal_node`, `_review_node`, `_write_review_node`, `_write_tax_hr_node`, `_write_operations_node`, `_ask_category_node` 함수 전부
- `_run_write()` 함수
- `_graph = ...` 컴파일 코드
- `run()` 함수 (기존 StateGraph entrypoint)

> **주의:** `_CATEGORY_GUIDANCE`는 Task 3-4 핸들러들이 f-string으로 참조하므로 **제거하지 않는다**.
> `VALID_TYPES`, `_TYPE_TO_SUBHUB` 도 `_execute_write`가 사용하므로 유지.

- [ ] **Step 3: import 검증**

```bash
cd backend
C:/Users/pc/anaconda3/envs/boss2/python.exe -c "
from app.agents.documents import describe, run_contract, run_estimate, run_review
from app.agents.documents import run_subsidy_recommend, run_admin_application, run_payroll_doc, run_tax_calendar
print('all handlers OK')
# StateGraph import가 없는지 확인
import inspect, app.agents.documents as m
src = inspect.getsource(m)
assert 'StateGraph' not in src, 'StateGraph still present!'
print('StateGraph removed OK')
"
```

Expected:
```
all handlers OK
StateGraph removed OK
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/agents/documents.py
git commit -m "feat: documents.py — 나머지 핸들러 DeepAgent 전환 + StateGraph 완전 제거"
```

---

## Task 6: 단위 테스트 — Documents Tools

**Files:**
- Create: `backend/tests/agents/test_documents_tools.py`

- [ ] **Step 1: 테스트 작성**

`backend/tests/agents/test_documents_tools.py`:

```python
"""Documents tool 단위 테스트 — mock 사용."""
import pytest
from unittest.mock import MagicMock, patch

from app.agents._agent_context import inject_agent_context
from app.agents._documents_tools import (
    write_document,
    analyze_document,
    get_sub_hubs,
    init_docs_result_store,
    get_docs_result_store,
)


@pytest.fixture(autouse=True)
def setup_context():
    inject_agent_context("test-account", "테스트", [])
    init_docs_result_store()


# ── result store ──────────────────────────────────────────────────────────

def test_result_store_initialized_empty():
    assert get_docs_result_store() == {}


def test_write_document_stores_result():
    write_document.invoke({
        "doc_type": "contract",
        "title": "근로계약서",
        "content": "계약서 본문",
        "subtype": "labor",
        "due_date": "2027-04-25",
        "due_label": "계약 만료",
    })
    store = get_docs_result_store()
    assert store["action"] == "write"
    assert store["doc_type"] == "contract"
    assert store["title"] == "근로계약서"
    assert store["subtype"] == "labor"
    assert store["due_date"] == "2027-04-25"


def test_analyze_document_stores_result():
    analyze_document.invoke({
        "user_role": "을",
        "doc_type": "계약서",
        "contract_subtype": "labor",
    })
    store = get_docs_result_store()
    assert store["action"] == "analyze"
    assert store["user_role"] == "을"
    assert store["contract_subtype"] == "labor"


def test_result_store_isolated_per_init():
    write_document.invoke({"doc_type": "estimate", "title": "견적서", "content": "..."})
    assert get_docs_result_store()["doc_type"] == "estimate"

    init_docs_result_store()
    assert get_docs_result_store() == {}


# ── get_sub_hubs ──────────────────────────────────────────────────────────

def test_get_sub_hubs_returns_list(monkeypatch):
    monkeypatch.setattr(
        "app.agents._documents_tools.list_sub_hub_titles",
        lambda account_id, domain: ["Review", "Tax&HR"],
        raising=False,
    )
    # list_sub_hub_titles is imported inside the tool; patch at source
    with patch("app.agents._artifact.list_sub_hub_titles", return_value=["Review", "Tax&HR"]):
        result = get_sub_hubs.invoke({})
    assert isinstance(result, list)
```

- [ ] **Step 2: 테스트 실행**

```bash
cd backend
C:/Users/pc/anaconda3/envs/boss2/python.exe -m pytest tests/agents/test_documents_tools.py -v --tb=short
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/agents/test_documents_tools.py
git commit -m "test: documents tool 단위 테스트 추가"
```

---

## Task 7: 스모크 테스트

서버가 실행 중인 상태에서 실시한다 (`uvicorn app.main:app --reload --port 8000`).

- [ ] **Step 1: 계약서 작성 확인**

```python
# backend/ 디렉토리에서 실행
import httpx, asyncio, sys

async def test():
    async with httpx.AsyncClient() as c:
        r = await c.post(
            "http://localhost:8000/api/chat",
            json={
                "message": "근로계약서 만들어줘. 갑은 김사장, 을은 이직원, 월급 230만원, 6개월 계약",
                "account_id": "3df785a3-42b8-4ca5-9fc7-39aabad9f0f9",
            },
            timeout=120,
        )
        d = r.json().get("data", r.json())
        reply = d.get("reply", "")
        sys.stdout.buffer.write(f"status={r.status_code}\n".encode())
        sys.stdout.buffer.write(f"reply_len={len(reply)}\n".encode())
        sys.stdout.buffer.write(f"has_artifact_marker={'[ARTIFACT]' in reply}\n".encode())
        sys.stdout.buffer.write(repr(reply[:200]).encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.buffer.flush()

asyncio.run(test())
```

Expected:
- `status=200`
- `reply_len > 100`
- `has_artifact_marker=False` (DeepAgent가 마커 없이 직접 저장)
- reply에 "계약서"/"작성" 관련 텍스트

- [ ] **Step 2: 법률 자문 확인**

```python
# message만 변경
"message": "상가 임대차 계약에서 임대인이 10년 이전에 계약을 해지할 수 있나요?"
```

Expected:
- `status=200`
- planner 내부 미노출
- 법률 관련 텍스트 응답 (artifact 저장 없음)

- [ ] **Step 3: 최종 Commit**

```bash
git add -A
git commit -m "feat: Phase 2 완료 — Documents DeepAgent 전환"
```

---

## 자체 검토 (Spec Coverage)

| 설계 요구사항 | 구현 Task |
|---|---|
| StateGraph → DeepAgent 교체 | Task 5 (StateGraph 제거) |
| `describe()` 인터페이스 유지 | 변경 없음 |
| get_uploaded_doc 비-터미널 툴 | Task 1 |
| get_recent_analysis 비-터미널 툴 | Task 1 |
| get_sub_hubs 비-터미널 툴 | Task 1 |
| write_document 터미널 툴 | Task 1 |
| analyze_document 터미널 툴 | Task 1 |
| artifact 직접 저장 (마커 파싱 제거) | Task 2 (_execute_write) |
| 계약서 작성 검증 게이트 | Task 7 |
| 법률 Q&A 검증 게이트 | Task 7 |
| 공정성 분석 검증 게이트 | Task 7 (업로드 문서 있을 때) |
| 2-attempt retry | Task 2 (_run_documents_agent) |
| orchestrator 호환 유지 | describe() + run_* 시그니처 유지 |
