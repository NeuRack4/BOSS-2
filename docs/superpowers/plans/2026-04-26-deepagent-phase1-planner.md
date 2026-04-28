# Phase 1: Planner DeepAgent 전환 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 단일 LLM 호출 방식의 Planner를 deepagents SDK 기반 DeepAgent로 교체해, 프로필/장기기억/artifact를 능동적으로 tool call로 수집한 뒤 도메인 에이전트를 dispatching한다.

**Architecture:** Planner DeepAgent는 `get_profile`, `search_memory`, `get_recent_artifacts`, `get_memos`, `list_capabilities` tool로 컨텍스트를 수집하고, `ask_user` 또는 `dispatch` terminal tool 중 하나를 반드시 호출해 종료한다. Terminal tool 결과는 contextvar에 저장하고, orchestrator가 읽어 기존 dispatch 로직에 그대로 연결한다.

**Tech Stack:** `deepagents` SDK, `langchain-openai` / `langchain-anthropic`, `langchain-core @tool`, Python ContextVar, pytest + pytest-asyncio

---

## 변경 파일 목록

| 역할 | 파일 |
|------|------|
| **생성** | `backend/app/agents/_agent_context.py` |
| **생성** | `backend/app/agents/_planner_tools.py` |
| **전면 교체** | `backend/app/agents/_planner.py` |
| **수정** | `backend/app/agents/orchestrator.py` (줄 622–862 — `_dispatch_via_planner` 함수) |
| **수정** | `backend/requirements.txt` |
| **생성** | `backend/tests/agents/__init__.py` |
| **생성** | `backend/tests/agents/test_planner_tools.py` |
| **생성** | `backend/tests/agents/test_planner_agent.py` |

---

## Task 1: 패키지 설치 및 임포트 검증

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: requirements.txt에 패키지 추가**

`backend/requirements.txt`에서 `langgraph>=0.2` 아래에 추가:

```
deepagents
langchain-openai>=0.2
langchain-anthropic>=0.3
langchain-core>=0.3
```

- [ ] **Step 2: 패키지 설치**

```bash
cd backend
uv pip install deepagents langchain-openai langchain-anthropic langchain-core
```

Expected: 오류 없이 설치 완료

- [ ] **Step 3: 임포트 검증**

```bash
python -c "from deepagents import create_deep_agent; from langchain_openai import ChatOpenAI; from langchain_core.tools import tool; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: deepagents, langchain-openai, langchain-anthropic 패키지 추가"
```

---

## Task 2: `_agent_context.py` — 요청별 컨텍스트 ContextVar

**Files:**
- Create: `backend/app/agents/_agent_context.py`

이 파일은 per-request 상태(account_id, message, history 등)를 asyncio-safe하게 tool에 전달한다. Tool 함수는 인자 없이 이 모듈에서 읽는다.

- [ ] **Step 1: 파일 생성**

`backend/app/agents/_agent_context.py`:

```python
"""Per-request agent context via ContextVar — asyncio-safe."""
from __future__ import annotations

from contextvars import ContextVar

_account_id: ContextVar[str] = ContextVar("agent_account_id", default="")
_message: ContextVar[str] = ContextVar("agent_message", default="")
_history: ContextVar[list] = ContextVar("agent_history", default=[])
_rag_context: ContextVar[str] = ContextVar("agent_rag_context", default="")
_long_term_context: ContextVar[str] = ContextVar("agent_long_term_context", default="")


def inject_agent_context(
    account_id: str,
    message: str,
    history: list,
    rag_context: str = "",
    long_term_context: str = "",
) -> None:
    _account_id.set(account_id)
    _message.set(message)
    _history.set(history)
    _rag_context.set(rag_context)
    _long_term_context.set(long_term_context)


def get_account_id() -> str:
    return _account_id.get()


def get_message() -> str:
    return _message.get()


def get_history() -> list:
    return _history.get()


def get_rag_context() -> str:
    return _rag_context.get()


def get_long_term_context() -> str:
    return _long_term_context.get()
```

- [ ] **Step 2: 동작 검증**

```bash
python -c "
from app.agents._agent_context import inject_agent_context, get_account_id
inject_agent_context('test-id', 'hi', [])
assert get_account_id() == 'test-id'
print('OK')
"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/_agent_context.py
git commit -m "feat: _agent_context.py — per-request ContextVar 헬퍼 추가"
```

---

## Task 3: `_planner_tools.py` — Non-Terminal Tools

**Files:**
- Create: `backend/app/agents/_planner_tools.py` (이번 Task는 non-terminal tool 5개)

- [ ] **Step 1: 파일 생성 (non-terminal tools)**

`backend/app/agents/_planner_tools.py`:

```python
"""Planner DeepAgent 도구 모음.

Non-terminal tools (get_profile, search_memory, get_recent_artifacts, get_memos, list_capabilities)
+ Terminal tools (ask_user, dispatch, trigger_planning) + ContextVar result store.
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from typing import Any

from langchain_core.tools import tool

from app.agents._agent_context import get_account_id
from app.core.supabase import get_supabase

log = logging.getLogger("boss2.planner_tools")

# ──────────────────────────────────────────────────────────────────────────
# Per-request result store (terminal tool이 여기에 결과를 기록한다)
# ──────────────────────────────────────────────────────────────────────────
_planner_result: ContextVar[dict | None] = ContextVar("planner_result", default=None)


def init_result_store() -> dict:
    """요청 시작 시 호출 — 빈 dict를 store로 설정하고 반환."""
    store: dict = {}
    _planner_result.set(store)
    return store


def get_result_store() -> dict | None:
    """현재 결과 store 반환 (terminal tool이 쓰기 전이면 None)."""
    return _planner_result.get(None)


# ──────────────────────────────────────────────────────────────────────────
# Non-terminal tools
# ──────────────────────────────────────────────────────────────────────────

@tool
def get_profile() -> dict:
    """사용자의 비즈니스 프로필을 반환합니다.
    업종(business_type), 지역(location), 사업 단계(business_stage),
    직원 수(employees_count), 주 목표(primary_goal), 닉네임(display_name) 등을 포함합니다.
    프로필이 없으면 빈 dict를 반환합니다.
    """
    account_id = get_account_id()
    sb = get_supabase()
    rows = (
        sb.table("profiles")
        .select(
            "display_name,business_type,business_name,business_stage,"
            "employees_count,location,channels,primary_goal,profile_meta"
        )
        .eq("id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return {}
    p = rows[0]
    # profile_meta 압축 (최대 5개 키만 노출)
    meta = p.pop("profile_meta", None) or {}
    if isinstance(meta, dict):
        p["extra"] = dict(list(meta.items())[:5])
    return {k: v for k, v in p.items() if v is not None}


@tool
async def search_memory(query: str) -> list[dict]:
    """사용자의 장기기억(pgvector)에서 query와 관련된 내용을 검색합니다.
    최대 4개의 관련 청크를 반환합니다. 사용자의 이전 대화, 선호도, 사업 맥락을 파악할 때 사용하세요.
    """
    account_id = get_account_id()
    try:
        from app.rag.retriever import hybrid_search
        chunks = await hybrid_search(account_id, query, limit=4)
        return [{"content": c.get("content", "")[:300]} for c in chunks]
    except Exception as e:
        log.warning("search_memory failed: %s", e)
        return []


@tool
def get_recent_artifacts(domain: str = "", limit: int = 5) -> list[dict]:
    """최근 저장된 artifact 목록을 반환합니다.
    domain 파라미터로 특정 도메인(recruitment|marketing|sales|documents)만 필터 가능.
    각 artifact의 id, title, type, 생성일을 반환합니다.
    """
    account_id = get_account_id()
    sb = get_supabase()
    q = (
        sb.table("artifacts")
        .select("id,title,type,domains,created_at")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .order("created_at", desc=True)
        .limit(min(limit, 20))
    )
    if domain:
        q = q.contains("domains", [domain])
    rows = q.execute().data or []
    return [
        {
            "id": r["id"],
            "title": r.get("title") or "",
            "type": r.get("type") or "",
            "created_at": (r.get("created_at") or "")[:10],
        }
        for r in rows
    ]


@tool
def get_memos(limit: int = 10) -> list[dict]:
    """사용자가 저장한 최근 메모 목록을 반환합니다. 각 메모의 내용(최대 200자)과 날짜를 반환합니다."""
    account_id = get_account_id()
    sb = get_supabase()
    rows = (
        sb.table("memos")
        .select("content,updated_at")
        .eq("account_id", account_id)
        .order("updated_at", desc=True)
        .limit(min(limit, 20))
        .execute()
        .data
        or []
    )
    return [
        {
            "content": (r.get("content") or "")[:200],
            "updated_at": (r.get("updated_at") or "")[:10],
        }
        for r in rows
    ]


@tool
def list_capabilities() -> list[dict]:
    """4개 도메인(recruitment, marketing, sales, documents)의 모든 capability 카탈로그를 반환합니다.
    각 capability의 name, description, required_params, optional_params를 포함합니다.
    dispatch() 호출 전 이 도구로 capability 이름과 필수 파라미터를 확인하세요.
    """
    account_id = get_account_id()
    from app.agents._capability import describe_all
    tools_spec, _ = describe_all(account_id)
    result = []
    for t in tools_spec:
        f = t.get("function") or {}
        params = f.get("parameters") or {}
        props = params.get("properties") or {}
        required = set(params.get("required") or [])
        result.append({
            "name": f.get("name", ""),
            "description": (f.get("description") or "")[:120],
            "required_params": [k for k in props if k in required],
            "optional_params": [k for k in props if k not in required],
        })
    return result
```

- [ ] **Step 2: Syntax 검증**

```bash
cd backend
python -c "from app.agents._planner_tools import get_profile, search_memory, get_recent_artifacts, get_memos, list_capabilities, init_result_store; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/_planner_tools.py
git commit -m "feat: _planner_tools.py — non-terminal tools 5개 구현"
```

---

## Task 4: `_planner_tools.py` — Terminal Tools 추가

**Files:**
- Modify: `backend/app/agents/_planner_tools.py` (파일 끝에 추가)

- [ ] **Step 1: terminal tools 추가 (파일 끝에 append)**

`backend/app/agents/_planner_tools.py` 파일 끝에 추가:

```python
# ──────────────────────────────────────────────────────────────────────────
# Terminal tools — 반드시 둘 중 하나를 호출해야 planner가 올바르게 종료됨
# ──────────────────────────────────────────────────────────────────────────

@tool
def ask_user(
    question: str,
    choices: list[str] | None = None,
    profile_updates: dict[str, str] | None = None,
) -> str:
    """[TERMINAL] 사용자에게 명확화 질문을 합니다.
    required 파라미터가 부족하거나 의도가 불명확할 때 호출하세요.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    question: 사용자에게 물을 한 문장.
    choices: 객관식 보기 (3~4개 권장, 마지막은 '기타 (직접 입력)'). 자유 응답이면 빈 리스트 또는 None.
    profile_updates: 이번 턴에서 확인된 프로필 정보 (확신 없으면 넣지 말 것).
    """
    store = _planner_result.get(None)
    if store is not None:
        store["mode"] = "ask"
        store["question"] = question
        store["choices"] = choices or []
        store["profile_updates"] = profile_updates or {}
    return "질문이 전송됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def dispatch(
    steps: list[dict[str, Any]],
    brief: str,
    opening: str = "",
    profile_updates: dict[str, str] | None = None,
) -> str:
    """[TERMINAL] 도메인 에이전트를 실행합니다.
    필요한 정보가 모두 확인되었을 때 호출하세요.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    steps: 실행할 capability 목록. 각 step은 아래 형식:
      { "capability": <list_capabilities()에서 확인한 이름>,
        "args": { <required_params를 모두 채운 dict> },
        "depends_on": <이전 step capability 이름 또는 null> }
    brief: domain agent에 전달할 내부 지시 (사용자에게 노출 안 됨).
    opening: 사용자에게 먼저 보여줄 한두 줄 안내 (선택).
    profile_updates: 이번 턴에서 확인된 프로필 정보.
    """
    store = _planner_result.get(None)
    if store is not None:
        store["mode"] = "dispatch"
        store["steps"] = steps
        store["brief"] = brief
        store["opening"] = opening
        store["profile_updates"] = profile_updates or {}
    return "도메인 에이전트가 실행됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def trigger_planning(opening: str = "") -> str:
    """[TERMINAL] 기간별 할 일 정리/플랜 모드를 요청합니다.
    '이번 주 할 일', '오늘 뭐 해야 돼' 같이 여러 도메인을 가로지르는 기간 단위 정리 요청에 사용하세요.
    이 도구를 호출하면 대화가 종료됩니다.
    """
    store = _planner_result.get(None)
    if store is not None:
        store["mode"] = "planning"
        store["opening"] = opening
    return "플래닝 모드로 전환됩니다. 추가 도구 호출 없이 종료하세요."


# 편의 export
PLANNER_TOOLS = [
    get_profile,
    search_memory,
    get_recent_artifacts,
    get_memos,
    list_capabilities,
    ask_user,
    dispatch,
    trigger_planning,
]

TERMINAL_TOOL_NAMES = {"ask_user", "dispatch", "trigger_planning"}
```

- [ ] **Step 2: 임포트 검증**

```bash
python -c "from app.agents._planner_tools import PLANNER_TOOLS, TERMINAL_TOOL_NAMES; print(len(PLANNER_TOOLS), 'tools,', TERMINAL_TOOL_NAMES)"
```

Expected: `8 tools, {'ask_user', 'dispatch', 'trigger_planning'}`

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/_planner_tools.py
git commit -m "feat: _planner_tools.py — terminal tools (ask_user, dispatch, trigger_planning) 추가"
```

---

## Task 5: `_planner.py` — DeepAgent 기반 전면 교체

**Files:**
- Modify (전면 교체): `backend/app/agents/_planner.py`

기존 파일을 완전히 교체한다. `PlanResult` TypedDict는 orchestrator 호환을 위해 유지.

- [ ] **Step 1: `_planner.py` 전면 교체**

`backend/app/agents/_planner.py`:

```python
"""Planner DeepAgent — deepagents SDK 기반 (Phase 1).

사용자 메시지를 받아:
1. get_profile / search_memory / get_recent_artifacts / get_memos / list_capabilities 로 컨텍스트 수집
2. ask_user(질문, 보기) 또는 dispatch(steps, brief) terminal tool 호출로 종료
3. 어느 terminal tool도 호출하지 않으면 → 직접 텍스트 응답(chitchat/refuse) 으로 간주

반환: PlanResult TypedDict (orchestrator 하위 호환 유지)
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, TypedDict

from langsmith import traceable

from app.core.config import settings

log = logging.getLogger("boss2.planner")

# ──────────────────────────────────────────────────────────────────────────
# Public types (orchestrator 호환)
# ──────────────────────────────────────────────────────────────────────────

class PlanStep(TypedDict, total=False):
    capability: str
    args: dict[str, Any]
    depends_on: str | None


class PlanResult(TypedDict, total=False):
    mode: str          # dispatch | ask | chitchat | refuse | planning | error
    opening: str
    brief: str
    steps: list[PlanStep]
    question: str
    choices: list[str]
    profile_updates: dict[str, str]
    reason: str


# ──────────────────────────────────────────────────────────────────────────
# 시스템 프롬프트
# ──────────────────────────────────────────────────────────────────────────

_PLANNER_SYSTEM = """\
당신은 소상공인 지원 AI 플랫폼 **BOSS** 의 Planner 에이전트입니다.
사용자의 메시지를 분석하고 아래 도구들을 활용해 필요한 컨텍스트를 수집한 뒤,
반드시 다음 세 terminal tool 중 하나를 호출해 대화를 종료하세요:

- `dispatch(steps, brief, opening)` — 도메인 에이전트 실행 (정보 충분 시)
- `ask_user(question, choices)` — 사용자에게 되묻기 (정보 부족 시)
- `trigger_planning(opening)` — 기간별 할 일 정리 요청 시

**[CRITICAL] Terminal tool 미호출 = 오류**
terminal tool을 호출하지 않으면 시스템이 오류로 처리합니다.
chitchat(인사, BOSS 사용법 안내)이나 refuse(범위 외 요청)는 opening에 응답을 담아 dispatch([]) 또는 ask_user로 우회하지 말고, 텍스트 응답만 작성하세요 (terminal tool 미사용).

**[컨텍스트 수집 가이드]**
- 간단한 인사·거절: 도구 호출 없이 바로 텍스트 응답
- 도메인 요청: `list_capabilities()`로 capability 이름·required 파라미터 확인 필수
- 사용자 맞춤 응답 필요 시: `get_profile()` 호출
- 이전 대화 참조 시: `search_memory(query)` 호출
- 특정 artifact 언급 시: `get_recent_artifacts(domain)` 호출

**[dispatch 규칙]**
- steps[].capability 는 반드시 list_capabilities() 결과에 있는 이름을 정확히 사용
- required_params 가 메시지/히스토리/프로필에서 확정되지 않으면 ask_user 로 먼저 수집
- depends_on: null이면 병렬 실행, 이전 step 이름이면 순차 실행

**[ask_user 규칙]**
- 한 번에 하나의 질문만 (question 필드에 정확히 하나)
- choices는 3~4개 + 마지막은 "기타 (직접 입력)" 권장
- 업종이 없고 업종-의존 작업이면 업종을 최우선으로 물어볼 것

**[폼 우선 규칙 — ask_user 금지 케이스]**
아래 요청은 ask_user 금지 — 해당 form capability를 즉시 dispatch:
- SNS/인스타/피드 게시물 주제 불명확 → mkt_sns_post_form dispatch
- 블로그 포스트 주제 불명확 → mkt_blog_post_form dispatch
- 리뷰 답글 원문 없음 → mkt_review_reply_form dispatch
- 이벤트 세부 없음 → mkt_event_form dispatch
- 유튜브 쇼츠 → 항상 mkt_shorts_video dispatch

**[profile_updates]**
dispatch 또는 ask_user의 profile_updates 파라미터에 이번 턴에서 확인된 프로필 정보를 담으세요.
확신 없는 정보는 절대 포함하지 말 것.
"""

_TERMINAL_REMINDER = """
[경고] terminal tool을 호출하지 않았습니다.
반드시 다음 중 하나를 즉시 호출하세요:
- dispatch(steps, brief) — 도메인 실행
- ask_user(question, choices) — 되묻기
- trigger_planning() — 플래닝 모드

텍스트 응답만 작성하는 것은 chitchat/refuse에서만 허용됩니다.
"""


# ──────────────────────────────────────────────────────────────────────────
# LLM 팩토리
# ──────────────────────────────────────────────────────────────────────────

def _make_model():
    provider = settings.planner_provider
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=settings.planner_claude_model,
            temperature=0.2,
            api_key=settings.anthropic_api_key,
        )
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=settings.planner_openai_model,
        temperature=0.2,
        api_key=settings.openai_api_key,
    )


# ──────────────────────────────────────────────────────────────────────────
# Terminal tool 결과 추출
# ──────────────────────────────────────────────────────────────────────────

def _extract_direct_reply(messages: list) -> str | None:
    """마지막 AIMessage 텍스트 반환 (chitchat/refuse 경로용)."""
    from langchain_core.messages import AIMessage
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.content:
            return str(msg.content).strip()
    return None


# ──────────────────────────────────────────────────────────────────────────
# 시스템 프롬프트 조립
# ──────────────────────────────────────────────────────────────────────────

def _build_system(nick_ctx: str, extra: str = "") -> str:
    parts = [
        _PLANNER_SYSTEM,
        f"[오늘 날짜] {date.today().isoformat()}",
        nick_ctx,
    ]
    if extra:
        parts.append(extra)
    return "\n\n".join(p for p in parts if p.strip())


# ──────────────────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────────────────

@traceable(name="planner.plan", run_type="chain")
async def plan(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    nick_ctx: str,
    choices_context: str | None = None,
    upload_hint: str | None = None,
    **_kwargs,  # memos_context, tools_catalog 등 기존 호출부 호환용
) -> PlanResult:
    """Planner DeepAgent 실행. 실패 시 {'mode': 'error', ...} 반환."""
    from deepagents import create_deep_agent
    from app.agents._planner_tools import (
        PLANNER_TOOLS,
        TERMINAL_TOOL_NAMES,
        init_result_store,
        get_result_store,
    )
    from app.agents._agent_context import inject_agent_context

    # contextvar 주입 (tool들이 여기서 account_id 등을 읽음)
    inject_agent_context(account_id, message, history, rag_context, long_term_context)
    store = init_result_store()

    # 시스템 프롬프트 추가 컨텍스트
    extra_parts: list[str] = []
    if choices_context:
        extra_parts.append(
            "[직전 CHOICES 컨텍스트 — 최우선 라우팅 힌트]\n"
            "직전 assistant가 아래 선택지를 제시했고 현재 사용자 메시지는 그 답변입니다. "
            "반드시 해당 도메인/capability로 라우팅하세요.\n\n" + choices_context
        )
    if upload_hint:
        extra_parts.append(upload_hint)

    system = _build_system(nick_ctx, "\n\n".join(extra_parts))
    model = _make_model()
    messages_in = [*history[-8:], {"role": "user", "content": message}]

    async def _invoke(sys: str) -> list:
        agent = create_deep_agent(model=model, tools=PLANNER_TOOLS, system_prompt=sys)
        result = await agent.ainvoke({"messages": messages_in})
        return result.get("messages", [])

    # 1차 실행
    try:
        out_messages = await _invoke(system)
    except Exception as exc:
        log.exception("[planner] deepagent invoke failed")
        return {"mode": "error", "reason": f"agent invoke: {exc}"}

    # terminal tool 미호출 시 재시도
    result_data = get_result_store()
    if not result_data:
        log.info("[planner] account=%s no terminal tool called — retry with reminder", account_id)
        try:
            out_messages = await _invoke(system + "\n\n" + _TERMINAL_REMINDER)
        except Exception as exc:
            log.exception("[planner] retry invoke failed")
            return {"mode": "error", "reason": f"retry invoke: {exc}"}
        result_data = get_result_store()

    # 여전히 없으면 → chitchat (텍스트 직접 응답)
    if not result_data:
        direct = _extract_direct_reply(out_messages)
        if direct:
            log.info("[planner] account=%s → chitchat (direct reply)", account_id)
            return {"mode": "chitchat", "opening": direct}
        return {"mode": "error", "reason": "no terminal tool and no text reply"}

    mode = result_data.get("mode", "error")
    log.info(
        "[planner] account=%s mode=%s steps=%s",
        account_id,
        mode,
        [s.get("capability") for s in result_data.get("steps", [])],
    )

    if mode == "ask":
        return {
            "mode": "ask",
            "opening": "",
            "question": result_data.get("question", ""),
            "choices": result_data.get("choices") or [],
            "profile_updates": result_data.get("profile_updates") or {},
        }

    if mode == "planning":
        return {
            "mode": "planning",
            "opening": result_data.get("opening", ""),
            "profile_updates": result_data.get("profile_updates") or {},
        }

    if mode == "dispatch":
        raw_steps = result_data.get("steps") or []
        steps: list[PlanStep] = []
        for s in raw_steps:
            if not isinstance(s, dict):
                continue
            cap = s.get("capability")
            if not isinstance(cap, str) or not cap:
                continue
            args = s.get("args") or {}
            dep = s.get("depends_on")
            if dep is not None and not isinstance(dep, str):
                dep = None
            steps.append({"capability": cap, "args": args if isinstance(args, dict) else {}, "depends_on": dep})

        raw_updates = result_data.get("profile_updates") or {}
        profile_updates: dict[str, str] = {}
        if isinstance(raw_updates, dict):
            for k, v in raw_updates.items():
                if isinstance(k, str) and k.strip() and isinstance(v, (str, int, float)):
                    profile_updates[k.strip().lower()] = str(v).strip()[:200]

        return {
            "mode": "dispatch",
            "opening": str(result_data.get("opening") or "").strip(),
            "brief": str(result_data.get("brief") or "").strip(),
            "steps": steps,
            "question": "",
            "choices": [],
            "profile_updates": profile_updates,
        }

    return {"mode": "error", "reason": f"unknown mode: {mode}"}
```

- [ ] **Step 2: syntax 검증**

```bash
python -c "from app.agents._planner import plan, PlanResult; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/agents/_planner.py
git commit -m "feat: _planner.py — deepagents SDK 기반 Planner DeepAgent로 전면 교체"
```

---

## Task 6: 단위 테스트 — Planner Tools

**Files:**
- Create: `backend/tests/agents/__init__.py`
- Create: `backend/tests/agents/test_planner_tools.py`

- [ ] **Step 1: `__init__.py` 생성**

```bash
touch backend/tests/agents/__init__.py
```

- [ ] **Step 2: tool 단위 테스트 작성**

`backend/tests/agents/test_planner_tools.py`:

```python
"""Planner tool 단위 테스트 — Supabase mock 사용."""
import pytest
from unittest.mock import MagicMock, patch

from app.agents._agent_context import inject_agent_context
from app.agents._planner_tools import (
    get_profile,
    get_recent_artifacts,
    get_memos,
    list_capabilities,
    ask_user,
    dispatch,
    trigger_planning,
    init_result_store,
    get_result_store,
)


@pytest.fixture(autouse=True)
def setup_context():
    inject_agent_context("test-account", "테스트 메시지", [])
    init_result_store()


# ── get_profile ───────────────────────────────────────────────────────────

def test_get_profile_returns_profile(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"display_name": "김사장", "business_type": "카페", "location": "서울"}
    ]
    monkeypatch.setattr("app.agents._planner_tools.get_supabase", lambda: mock_sb)
    result = get_profile.invoke({})
    assert result["display_name"] == "김사장"
    assert result["business_type"] == "카페"


def test_get_profile_returns_empty_when_no_row(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr("app.agents._planner_tools.get_supabase", lambda: mock_sb)
    result = get_profile.invoke({})
    assert result == {}


# ── get_recent_artifacts ──────────────────────────────────────────────────

def test_get_recent_artifacts_returns_list(monkeypatch):
    mock_sb = MagicMock()
    mock_chain = MagicMock()
    mock_chain.execute.return_value.data = [
        {"id": "abc", "title": "채용공고", "type": "job_posting", "domains": ["recruitment"], "created_at": "2026-04-26T10:00:00"}
    ]
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value = mock_chain
    monkeypatch.setattr("app.agents._planner_tools.get_supabase", lambda: mock_sb)
    result = get_recent_artifacts.invoke({"limit": 5})
    assert len(result) == 1
    assert result[0]["title"] == "채용공고"
    assert result[0]["created_at"] == "2026-04-26"


# ── Terminal tools ─────────────────────────────────────────────────────────

def test_ask_user_stores_result():
    ask_user.invoke({"question": "업종이 무엇인가요?", "choices": ["카페", "음식점", "기타 (직접 입력)"]})
    store = get_result_store()
    assert store["mode"] == "ask"
    assert store["question"] == "업종이 무엇인가요?"
    assert store["choices"] == ["카페", "음식점", "기타 (직접 입력)"]


def test_dispatch_stores_result():
    steps = [{"capability": "mkt_sns_post", "args": {"topic": "신메뉴"}, "depends_on": None}]
    dispatch.invoke({"steps": steps, "brief": "SNS 게시물 작성", "opening": "작성할게요."})
    store = get_result_store()
    assert store["mode"] == "dispatch"
    assert store["steps"][0]["capability"] == "mkt_sns_post"
    assert store["opening"] == "작성할게요."


def test_trigger_planning_stores_result():
    trigger_planning.invoke({"opening": "이번 주 할 일을 정리해 드릴게요."})
    store = get_result_store()
    assert store["mode"] == "planning"
    assert "이번 주" in store["opening"]


def test_result_store_isolated_per_init():
    init_result_store()
    ask_user.invoke({"question": "첫 번째 질문"})
    assert get_result_store()["question"] == "첫 번째 질문"

    init_result_store()  # 새 요청 시뮬레이션
    assert get_result_store() == {}  # 초기화됨
```

- [ ] **Step 3: 테스트 실행**

```bash
cd backend
python -m pytest tests/agents/test_planner_tools.py -v
```

Expected:
```
tests/agents/test_planner_tools.py::test_get_profile_returns_profile PASSED
tests/agents/test_planner_tools.py::test_get_profile_returns_empty_when_no_row PASSED
tests/agents/test_planner_tools.py::test_get_recent_artifacts_returns_list PASSED
tests/agents/test_planner_tools.py::test_ask_user_stores_result PASSED
tests/agents/test_planner_tools.py::test_dispatch_stores_result PASSED
tests/agents/test_planner_tools.py::test_trigger_planning_stores_result PASSED
tests/agents/test_planner_tools.py::test_result_store_isolated_per_init PASSED
7 passed
```

- [ ] **Step 4: Commit**

```bash
git add backend/tests/agents/__init__.py backend/tests/agents/test_planner_tools.py
git commit -m "test: planner tool 단위 테스트 7개 추가"
```

---

## Task 7: 통합 테스트 — Planner Agent

**Files:**
- Create: `backend/tests/agents/test_planner_agent.py`

LLM mock을 사용해 deepagent 전체 흐름을 검증한다. 실제 API 호출 없음.

- [ ] **Step 1: 통합 테스트 작성**

`backend/tests/agents/test_planner_agent.py`:

```python
"""Planner DeepAgent 통합 테스트 — LLM mock 사용."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents._planner import plan


@pytest.fixture
def base_kwargs():
    return {
        "account_id": "test-account",
        "message": "SNS 게시물 만들어줘",
        "history": [],
        "rag_context": "",
        "long_term_context": "",
        "nick_ctx": "",
    }


def _make_agent_result(tool_name: str, tool_args: dict):
    """deepagent ainvoke 반환값 mock — terminal tool 호출 포함."""
    from langchain_core.messages import AIMessage, ToolMessage
    ai_msg = AIMessage(
        content="",
        tool_calls=[{"name": tool_name, "args": tool_args, "id": "call_1"}],
    )
    tool_msg = ToolMessage(content="완료", tool_call_id="call_1")
    return {"messages": [ai_msg, tool_msg]}


@pytest.mark.asyncio
async def test_plan_dispatch_mode(base_kwargs, monkeypatch):
    """dispatch terminal tool 호출 시 mode=dispatch PlanResult 반환."""
    dispatch_steps = [{"capability": "mkt_sns_post_form", "args": {}, "depends_on": None}]
    agent_result = _make_agent_result("dispatch", {
        "steps": dispatch_steps,
        "brief": "SNS 폼 열기",
        "opening": "게시물 폼을 열어드릴게요.",
    })

    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(return_value=agent_result)

    with patch("app.agents._planner.create_deep_agent", return_value=mock_agent), \
         patch("app.agents._planner._make_model", return_value=MagicMock()):
        # terminal tool 결과를 result_store에 직접 세팅 (deepagent 내부 tool 실행 시뮬레이션)
        with patch("app.agents._planner_tools._planner_result") as mock_var:
            store = {}
            mock_var.get = MagicMock(return_value=store)
            mock_var.set = MagicMock()

            from app.agents._planner_tools import dispatch as dispatch_tool
            dispatch_tool.invoke({
                "steps": dispatch_steps,
                "brief": "SNS 폼 열기",
                "opening": "게시물 폼을 열어드릴게요.",
            })

            result = await plan(**base_kwargs)

    assert result["mode"] == "dispatch"
    assert result["steps"][0]["capability"] == "mkt_sns_post_form"
    assert "폼" in result["opening"]


@pytest.mark.asyncio
async def test_plan_ask_mode(monkeypatch):
    """ask_user terminal tool 호출 시 mode=ask PlanResult 반환."""
    from app.agents._agent_context import inject_agent_context
    from app.agents._planner_tools import init_result_store, ask_user

    inject_agent_context("test-account", "채용공고 올려줘", [])
    init_result_store()
    ask_user.invoke({
        "question": "업종이 어떻게 되세요?",
        "choices": ["카페·베이커리", "음식점", "기타 (직접 입력)"],
    })

    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(return_value={"messages": []})

    with patch("app.agents._planner.create_deep_agent", return_value=mock_agent), \
         patch("app.agents._planner._make_model", return_value=MagicMock()):
        result = await plan(
            account_id="test-account",
            message="채용공고 올려줘",
            history=[],
            rag_context="",
            long_term_context="",
            nick_ctx="",
        )

    assert result["mode"] == "ask"
    assert "업종" in result["question"]
    assert len(result["choices"]) == 3


@pytest.mark.asyncio
async def test_plan_returns_error_on_exception(monkeypatch):
    """deepagent invoke 예외 시 mode=error 반환."""
    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(side_effect=RuntimeError("LLM timeout"))

    with patch("app.agents._planner.create_deep_agent", return_value=mock_agent), \
         patch("app.agents._planner._make_model", return_value=MagicMock()):
        result = await plan(
            account_id="test-account",
            message="테스트",
            history=[],
            rag_context="",
            long_term_context="",
            nick_ctx="",
        )

    assert result["mode"] == "error"
    assert "invoke" in result["reason"]
```

- [ ] **Step 2: 테스트 실행**

```bash
python -m pytest tests/agents/test_planner_agent.py -v
```

Expected:
```
tests/agents/test_planner_agent.py::test_plan_dispatch_mode PASSED
tests/agents/test_planner_agent.py::test_plan_ask_mode PASSED
tests/agents/test_planner_agent.py::test_plan_returns_error_on_exception PASSED
3 passed
```

- [ ] **Step 3: Commit**

```bash
git add backend/tests/agents/test_planner_agent.py
git commit -m "test: planner DeepAgent 통합 테스트 3개 추가"
```

---

## Task 8: Orchestrator 통합 — `_dispatch_via_planner` 업데이트

**Files:**
- Modify: `backend/app/agents/orchestrator.py` (함수 `_dispatch_via_planner`, 줄 622–862)

기존 `_planner.plan()` 호출 시그니처가 바뀌었으므로 호출부를 업데이트한다. 나머지 로직은 그대로 유지.

- [ ] **Step 1: `_dispatch_via_planner` 내 planner 호출부 수정**

`orchestrator.py`의 `_dispatch_via_planner` 함수에서 `_planner.plan()` 호출 부분을 찾아 아래와 같이 수정한다.

기존 (줄 669~680):
```python
result = await _planner.plan(
    account_id=account_id,
    message=message,
    history=history,
    rag_context=rag_context,
    long_term_context=long_term_context,
    nick_ctx=nick_ctx,
    memos_context=memos_ctx,
    tools_catalog=tools,
    choices_context=choices_ctx,
    upload_hint=upload_hint,
)
```

신규:
```python
result = await _planner.plan(
    account_id=account_id,
    message=message,
    history=history,
    rag_context=rag_context,
    long_term_context=long_term_context,
    nick_ctx=nick_ctx,
    choices_context=choices_ctx,
    upload_hint=upload_hint,
    # 하위 호환: 기존 파라미터는 **_kwargs로 흡수됨
    memos_context=memos_ctx,
    tools_catalog=tools,
)
```

> 참고: 새 `_planner.plan()`은 `**_kwargs`로 기존 파라미터를 무시하므로 기존 호출부를 그대로 두어도 동작한다. 명시적으로 정리하는 것이 권장.

- [ ] **Step 2: `tools, dispatch` 관련 코드 확인**

`_dispatch_via_planner` 내 `describe_all(account_id)` 호출 결과 `tools, dispatch`를 사용하는 부분은 그대로 유지한다. 새 Planner는 `list_capabilities()` tool로 내부에서 직접 조회하지만, dispatch 핸들러 실행은 기존 `dispatch[name]["handler"]` 경로를 그대로 사용한다.

- [ ] **Step 3: 서버 기동 확인**

```bash
uvicorn app.main:app --reload --port 8000
```

Expected: 오류 없이 `Application startup complete.` 출력

- [ ] **Step 4: Commit**

```bash
git add backend/app/agents/orchestrator.py
git commit -m "feat: orchestrator — 새 planner DeepAgent 호출 시그니처 적용"
```

---

## Task 9: 스모크 테스트

실제 API 키가 있는 환경에서 E2E 동작 확인. 서버를 띄운 상태에서 실행.

- [ ] **Step 1: 인사 (chitchat) 확인**

```bash
curl -s -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <토큰>" \
  -d '{"message": "안녕하세요", "session_id": "test-smoke"}' | python -m json.tool
```

Expected:
- `reply`에 인사 텍스트
- `choices`는 빈 배열
- planner 내부 tool call 텍스트가 `reply`에 **포함되지 않을 것**

- [ ] **Step 2: dispatch (SNS 게시물) 확인**

```bash
curl -s -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <토큰>" \
  -d '{"message": "인스타 게시물 만들어줘", "session_id": "test-smoke"}' | python -m json.tool
```

Expected:
- SNS 폼 카드 또는 게시물이 reply에 포함
- Supabase artifacts 테이블에 새 행 생성 확인

- [ ] **Step 3: ask (되묻기) 확인**

```bash
curl -s -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <토큰>" \
  -d '{"message": "채용공고 올려줘", "session_id": "test-smoke"}' | python -m json.tool
```

Expected (프로필 업종 없는 계정):
- `choices` 배열에 업종 선택지
- `reply`에 질문 텍스트

- [ ] **Step 4: 최종 Commit**

```bash
git add -A
git commit -m "feat: Phase 1 완료 — Planner DeepAgent 전환"
```

---

## 자체 검토 (Spec Coverage)

| 설계 요구사항 | 구현 Task |
|---|---|
| Planner가 tool로 컨텍스트 능동 수집 | Task 3, Task 5 |
| ask_user / dispatch terminal tool | Task 4 |
| profile_updates 저장 | Task 5 (dispatch/ask_user args) + orchestrator 기존 로직 |
| 2-attempt retry | Task 5 (_planner.py retry 로직) |
| chitchat/refuse 직접 텍스트 응답 | Task 5 (_extract_direct_reply) |
| planning 모드 | Task 4 (trigger_planning tool) |
| orchestrator 하위 호환 | Task 8 |
| API 응답 형식 유지 { reply, choices, speaker } | Task 8 (orchestrator 기존 로직 유지) |
| deepagents 패키지 설치 | Task 1 |
