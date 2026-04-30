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

from langchain_core.messages import SystemMessage

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
1. 순수 인사: "안녕", "고마워", "잘 있어" 등 완전한 소셜 메시지 **(단, 프로필 정보가 포함된 경우 제외)**
2. 명백한 범위 외: BOSS와 전혀 무관한 주제 (날씨, 스포츠, 연애 등)

**[프로필 정보 언급 시 반드시 terminal tool 호출]**
사용자 메시지에 업종·위치·가게명·사업 단계·직원 수·채널 등 프로필 정보가 포함된 경우:
- chitchat 직접 응답 절대 금지. 반드시 `ask_user` 또는 `dispatch` 를 호출하세요.
- 해당 정보를 `profile_updates` 에 포함해 저장하세요.
- 예: "나 강남에서 카페 해" → ask_user(question="...", profile_updates={"location":"강남", "business_type":"카페"})

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

**[ask_user 보기 힌트]**
- 지원사업 추천 시 사업 단계를 물어볼 때 보기: 창업 준비 | 오픈 직전 | 영업 중 | 확장 중 | 기타 (직접 입력)
- 사업 단계가 이미 프로필에 있으면 묻지 말 것

**[RULE] capability 이름은 반드시 list_capabilities() 결과에서 가져올 것**
절대로 추측하거나 기억에 의존해 capability 이름을 사용하지 마세요.
도메인 요청이 확인되면 즉시 `list_capabilities()` 를 호출해 정확한 이름과 required_params 를 확인한 뒤 dispatch 하세요.

**[컨텍스트 수집 가이드]**
- 순수 인사·범위 외: 도구 호출 없이 바로 텍스트 응답
- 도메인 요청: `list_capabilities()` 먼저 호출 (필수)
- 사용자 맞춤 응답 필요 시: `get_profile()` 호출
- 이전 대화 참조 시: `search_memory(query)` 호출
- 특정 artifact 언급 시: `get_recent_artifacts(domain)` 호출

**[프로필 → args 자동 채움 — 재질문 절대 금지]**
dispatch args 를 채울 때, 시스템 메시지의 [사용자 프로필] 섹션에 값이 있으면 ask_user 없이 즉시 채워 넣으세요.
프로필 필드명(괄호 안)이 capability required_param 이름과 일치합니다:
- business_name → 가게명(business_name) 에 값이 있으면 바로 사용
- location → 위치(location) 에 값이 있으면 바로 사용
- business_type → 업종(business_type) 에 값이 있으면 바로 사용
- business_stage → 사업 단계(business_stage) 에 값이 있으면 바로 사용
- employees_count → 직원 수(employees_count) 에 값이 있으면 바로 사용
"(비어있음)" 인 경우에만 ask_user 로 수집하세요.

**[dispatch 규칙]**
- steps[].capability 는 반드시 list_capabilities() 결과에 있는 이름을 정확히 사용
- required_params 가 메시지/히스토리/프로필에서 확정되지 않으면 ask_user 로 먼저 수집
- depends_on: null이면 병렬 실행, 이전 step 이름이면 순차 실행

**[ask_user 규칙]**
- 사용자에게 질문이 필요하면 **반드시 ask_user(question, choices) 도구를 호출**하세요.
- 텍스트로 직접 질문을 작성하는 것은 절대 금지 — 항상 ask_user 도구 사용.
- 한 번에 하나의 질문만 (question 필드에 정확히 하나)
- choices는 3~4개 + 마지막은 "기타 (직접 입력)" 권장
- 업종이 없고 업종-의존 작업이면 업종을 최우선으로 물어볼 것

**[폼 우선 규칙 — ask_user 절대 금지 케이스]**
아래 요청은 ask_user 모드/도구 호출 절대 금지 — 반드시 해당 form capability를 dispatch:
- "블로그 포스트 작성해줘", "블로그 써줘", "네이버 블로그 작성" 등 블로그 관련 요청 → 주제 유무 불문하고 mkt_blog_post_form 즉시 dispatch (메시지에 "주제:" 또는 "바로 완성해줘"가 명시된 경우만 mkt_blog_post dispatch)
- SNS/인스타/피드 게시물 주제 불명확 → mkt_sns_post_form dispatch
- 리뷰 답글 원문 없음 → mkt_review_reply_form dispatch
- 이벤트 세부 없음 → mkt_event_form dispatch
- 유튜브 쇼츠 → 항상 mkt_shorts_video dispatch
- "성과 리포트", "인스타 분석", "유튜브 분석", "성과 보고", "마케팅 어땠어", "리포트 보여줘" 등 성과 조회 요청 → 추가 질문 없이 mkt_marketing_report 즉시 dispatch (period만 선택 파라미터)

**[profile_updates — 반드시 이행]**
사용자가 이번 턴에 프로필 정보를 말했으면, 다음 도구(ask_user 또는 dispatch) 호출 시 반드시 profile_updates에 포함하세요.

저장 필드명:
- business_type: 업종 (예: "음식점", "카페", "편의점")
- location: 지역 (예: "강원도 평창", "서울 강남")
- business_stage: "창업 준비" | "오픈 직전" | "영업 중" | "확장 중"
- employees_count: 직원 수 (예: "3명")
- primary_goal: 주요 목표

예시 흐름:
1. 이전에 "업종이 뭔가요?" 물었고 → 사용자가 "음식점" 답변
   → 이번 ask_user/dispatch 호출: profile_updates={"business_type": "음식점"}
2. 이전에 "사업 단계?" 물었고 → 사용자가 "창업 준비 중" 답변
   → 이번 ask_user/dispatch 호출: profile_updates={"business_stage": "창업 준비 중"}
3. 이전에 "지역?" 물었고 → 사용자가 "강원도 평창" 답변
   → 이번 dispatch 호출: profile_updates={"location": "강원도 평창"}

확신 없는 정보는 절대 포함하지 말 것.
"""

_TERMINAL_REMINDER = """
[경고] terminal tool을 호출하지 않았습니다.

규칙:
- 사용자에게 질문이 필요하면: ask_user(question="..", choices=[..]) 도구 즉시 호출
- 도메인 실행이 필요하면: list_capabilities() → dispatch(steps, brief) 호출
- 텍스트로 직접 질문·응답 작성 금지

지금 즉시 ask_user 또는 dispatch 중 하나를 호출하세요.
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
    """마지막 AIMessage의 텍스트 부분만 반환 (chitchat/refuse 경로용).
    content가 list인 경우(tool_use 혼합) text 블록만 추출한다.
    """
    from langchain_core.messages import AIMessage
    for msg in reversed(messages):
        if not isinstance(msg, AIMessage) or not msg.content:
            continue
        content = msg.content
        if isinstance(content, str):
            text = content.strip()
            return text if text else None
        if isinstance(content, list):
            texts = [
                block["text"]
                for block in content
                if isinstance(block, dict)
                and block.get("type") == "text"
                and isinstance(block.get("text"), str)
                and block["text"].strip()
            ]
            if texts:
                return " ".join(texts).strip()
    return None


# ──────────────────────────────────────────────────────────────────────────
# 시스템 프롬프트 조립
# ──────────────────────────────────────────────────────────────────────────

def _build_system(nick_ctx: str, extra: str = "") -> SystemMessage:
    """정적 블록(캐시 가능) + 동적 블록(nick_ctx·extra)을 분리한 SystemMessage 반환.

    deepagents의 AnthropicPromptCachingMiddleware가 정적 블록 끝에
    cache_control을 자동 부착하여 _PLANNER_SYSTEM을 KV 캐시한다.
    날짜는 시스템에서 제거 — plan()이 user 메시지 앞에 주입.
    """
    dynamic_parts = [p for p in [nick_ctx, extra] if p and p.strip()]
    dynamic_text = "\n\n".join(dynamic_parts)

    content: list[dict] = [
        {"type": "text", "text": _PLANNER_SYSTEM, "cache_control": {"type": "ephemeral"}},
    ]
    if dynamic_text:
        content.append({"type": "text", "text": dynamic_text})

    return SystemMessage(content=content)


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
    # 날짜는 캐시 경계 밖(user 메시지)에 주입 — system prefix를 안정적으로 유지
    dated_message = f"[오늘 날짜] {date.today().isoformat()}\n\n{message}"
    messages_in = [*history[-8:], {"role": "user", "content": dated_message}]

    async def _invoke(sys: SystemMessage) -> list:
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
            reminder_content = [*system.content, {"type": "text", "text": _TERMINAL_REMINDER}]
            out_messages = await _invoke(SystemMessage(content=reminder_content))
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
