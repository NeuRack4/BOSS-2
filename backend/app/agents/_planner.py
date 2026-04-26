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

**[chitchat / refuse 판단 기준 — 매우 엄격하게 적용]**
텍스트 직접 응답(terminal tool 미사용)은 오직 아래 두 경우에만 허용됩니다:
1. 순수 인사: "안녕", "고마워", "잘 있어" 등 완전한 소셜 메시지
2. 명백한 범위 외: BOSS와 전혀 무관한 주제 (날씨, 스포츠, 연애 등)

아래는 **반드시 dispatch 해야 하는** 도메인 요청입니다. chitchat·refuse 절대 금지:
- 법률·법령·노동·임대차·계약 관련 질문 → doc_legal_advice
- 지원사업·보조금·정부지원 추천 → doc_subsidy_recommend
- 행정 신청서 (사업자등록·통신판매업·구매안전서비스) → doc_admin_application
- 계약서 작성·검토·공정성 분석 → doc_contract 또는 doc_review
- 견적서·제안서·안내문·체크리스트 작성 → doc_estimate / doc_proposal / doc_notice / doc_checklist_guide
- 급여명세서·원천징수·4대보험 서류 → doc_payroll_doc
- 세무 일정·부가세·소득세 일정 캘린더 → doc_tax_calendar
- 세법·세무 규정 자문 → doc_tax_advice
- 채용공고·이력서·급여계산 등 채용 업무 → recruit_* 계열
- SNS·블로그·이벤트·리뷰 마케팅 → mkt_* 계열
- 매출·비용·POS·세금계산서 등 영업 데이터 → sales_* 계열

**[RULE] capability 이름은 반드시 list_capabilities() 결과에서 가져올 것**
절대로 추측하거나 기억에 의존해 capability 이름을 사용하지 마세요.
도메인 요청이 확인되면 즉시 `list_capabilities()` 를 호출해 정확한 이름과 required_params 를 확인한 뒤 dispatch 하세요.

**[컨텍스트 수집 가이드]**
- 순수 인사·범위 외: 도구 호출 없이 바로 텍스트 응답
- 도메인 요청: `list_capabilities()` 먼저 호출 (필수)
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
이 요청은 도메인 처리가 필요합니다 — 텍스트 응답은 허용되지 않습니다.

즉시 다음을 수행하세요:
1. list_capabilities() 를 호출해 정확한 capability 이름 확인
2. dispatch(steps, brief) 또는 ask_user(question, choices) 호출로 종료

capability 이름을 절대 추측하지 마세요. list_capabilities() 결과만 사용하세요.
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
        init_result_store,
        get_result_store,
    )
    from app.agents._agent_context import inject_agent_context

    # contextvar 주입 (tool들이 여기서 account_id 등을 읽음)
    inject_agent_context(account_id, message, history, rag_context, long_term_context)
    init_result_store()

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
