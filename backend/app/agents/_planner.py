"""오케스트레이터 Planner — C 아키텍처 (v1.1+).

사용자 메시지를 읽고 다음 중 하나의 `mode` 와 함께 구조화된 JSON 플랜을 돌려준다:

- `dispatch`   — 도메인 capability 를 1개 이상 실행
- `ask`        — 도메인/파라미터 명확화가 먼저 필요해 되묻기
- `chitchat`   — 인사·호칭·BOSS 사용법·감사 인사 등
- `refuse`     — 4개 도메인과 무관한 요청
- `planning`   — 기간 단위 플랜/정리 요청 (`_handle_planning` 으로 위임)

출력은 OpenAI `response_format=json_schema` 로 강제하므로 호출부는 항상 확정된 key set 을 받는다.
실패(네트워크/JSON 파싱/예외) 시 `plan()` 은 `{"mode": "error", ...}` 를 돌려주고, 상위 dispatcher 가 legacy
경로(`_call_domain_with_shortcut`) 로 폴백한다.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any, TypedDict

from langsmith import traceable

from app.core.config import settings
from app.core.llm import planner_completion

log = logging.getLogger("boss2.orchestrator")


class PlanStep(TypedDict, total=False):
    capability: str
    args: dict[str, Any]
    depends_on: str | None   # 이전 step 의 capability 이름 (순차 실행 트리거)


class PlanResult(TypedDict, total=False):
    mode: str                # dispatch | ask | chitchat | refuse | planning | error
    opening: str             # 사용자에게 먼저 건네는 자연어 (오케스트레이터 목소리)
    brief: str               # domain agent 에게 전달할 내부 지시문 (UX 노출 안 함)
    steps: list[PlanStep]
    question: str            # mode=ask
    choices: list[str]       # mode=ask (빈 리스트면 자유 응답)
    profile_updates: dict[str, str]   # 매 턴 감지된 프로필 정보 (dispatcher 가 즉시 저장)
    reason: str              # mode=error 디버깅용


# ──────────────────────────────────────────────────────────────────────────
# JSON Schema — response_format 으로 강제
# ──────────────────────────────────────────────────────────────────────────
_PLAN_JSON_SCHEMA: dict[str, Any] = {
    "name": "orchestrator_plan",
    "strict": False,
    "schema": {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "enum": ["dispatch", "ask", "chitchat", "refuse", "planning"],
                "description": "라우팅 모드.",
            },
            "opening": {
                "type": "string",
                "description": (
                    "사용자에게 먼저 건네는 한두 줄. 장기기억/메모/프로필에서 관찰한 맥락을 "
                    "자연스럽게 참조하며 '지금 이 요청을 어떻게 받아들였는지' 를 드러낸다. "
                    "과장·감탄 금지. 닉네임이 주어지면 1회 호칭 사용. "
                    "mode=chitchat 이면 이 필드가 곧 최종 사용자 응답이 되어야 한다."
                ),
            },
            "brief": {
                "type": "string",
                "description": (
                    "domain agent 에게 전달할 내부 지시문. 사용자에겐 안 보임. "
                    "무엇을 왜 만들어야 하는지, 어떤 맥락을 반영할지, 주의할 점이 무엇인지 짧게."
                ),
            },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "capability": {"type": "string", "description": "호출할 capability name (카탈로그에서 선택)."},
                        "args":       {"type": "object", "description": "capability parameters 스펙에 맞는 인자 딕셔너리."},
                        "depends_on": {
                            "type": ["string", "null"],
                            "description": "이전 step 의 capability 이름. null 이면 병렬 실행 가능.",
                        },
                    },
                    "required": ["capability"],
                },
                "description": "mode=dispatch 일 때만 채움. 1개 이상.",
            },
            "question": {
                "type": "string",
                "description": "mode=ask 일 때 사용자에게 물을 한 문장. 다른 mode 에서는 빈 문자열.",
            },
            "choices": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "mode=ask 일 때 보기. 3~4개 + 마지막 보기는 '기타 (직접 입력)'. "
                    "자유 응답을 원하면 빈 리스트."
                ),
            },
            "profile_updates": {
                "type": "object",
                "description": (
                    "이번 턴의 사용자 메시지(+ 직전 ask CHOICES 답변) 에서 명확히 확인된 프로필 정보. "
                    "key 는 core (business_type | business_name | business_stage | employees_count | location | channels | primary_goal) "
                    "또는 자유 필드. 확신 없는 정보는 절대 넣지 말 것. 관찰된 게 없으면 빈 객체 {}."
                ),
                "additionalProperties": {"type": "string"},
            },
        },
        "required": ["mode", "opening"],
    },
}


# ──────────────────────────────────────────────────────────────────────────
# System prompt
# ──────────────────────────────────────────────────────────────────────────
_PLANNER_SYSTEM = """당신은 소상공인 지원 AI 플랫폼 **BOSS** 의 오케스트레이터 플래너입니다.
사용자의 한 턴 메시지를 읽고 아래 다섯 모드 중 **정확히 하나**를 선택해 구조화된 플랜(JSON)을 돌려주세요.

[CRITICAL — 모든 규칙보다 우선]
시스템 컨텍스트의 `[사용자 프로필]` 에서 **`업종: (비어있음)`** 상태이고, 사용자의 요청이
채용/공고/면접/광고/SNS/블로그/포스터/포스트/이미지/공지·견적·제안서 작성 등
**업종-의존 작업** 이면:

→ 절대 dispatch 로 가지 마세요.
→ `mode=ask` 로 `question` = 업종만 묻기 (다른 모든 질문 금지).
→ `choices` = ["카페·베이커리", "음식점", "뷰티·미용", "학원·교습소", "편의점·리테일", "기타 (직접 입력)"]
→ `opening` 은 "맞춤 결과를 위해 업종을 먼저 확인할게요." 수준으로 짧게. 질문 넣지 말 것.
→ 이 한 가지만 물은 뒤 다음 턴에서 사용자 답을 반영해 진짜 domain dispatch.

이 규칙을 무시하고 바로 position·주제·광고채널 등을 물으면 품질이 크게 떨어집니다. 반드시 지키세요.

[모드 정의]
1. `dispatch`  — 4개 도메인(채용·마케팅·매출·서류) 의 capability 를 1개 이상 실행.
2. `ask`       — 도메인/파라미터가 명확하지 않아 되묻기. 한 번에 한 질문만.
3. `chitchat`  — 인사·호칭 설정·BOSS 사용법·감사 인사·상태 질문 등 도구 불필요.
4. `refuse`    — 4개 도메인과 완전히 무관한 요청(일반 상식 QA·코딩·날씨 등).
5. `planning`  — 여러 도메인을 가로지르는 기간 단위 할 일/정리 요청("이번 주 할 일", "오늘 뭐 해야 돼").

[도메인 가이드]
- recruitment  : 채용공고·면접·직원 관리 + 채용 포스터/이미지 생성
- marketing    : SNS·광고·캠페인·블로그·리뷰 답글·유튜브 쇼츠/숏폼 영상 + 광고 이미지/배너
- sales        : 매출 입력/분석·비용 기록·가격 전략·고객 응대 스크립트 + 영수증 파싱
- documents    : 계약서·견적서·공지문 작성/검토 + **한국 법률·법령 전분야 Q&A** (노동·임대차·공정·개인정보·세법·상법·식품위생·저작권 등 포함)
  → 법령 질문은 일반 상식 QA 가 아니라 documents 로 분류.
- 이미지/포스터/썸네일/배너 생성 요청은 refuse 가 아니라 쓰임 도메인(recruitment 또는 marketing).
- 유튜브/쇼츠/숏폼/영상 만들기 → marketing.

[출력 규칙 — 필수]
- 반드시 JSON schema 에 맞는 단일 객체로만 출력. 마크다운/코드펜스/설명 금지.
- `opening` 은 비워두지 마세요. chitchat 이면 이 필드가 곧 사용자 응답입니다.
- 닉네임이 주어지면 opening 에 **딱 한 번** 자연스럽게 호칭(+ 존칭 '사장님') 사용.
- 장기기억/메모/프로필에서 **관찰한 사실**만 opening/brief 에 반영. 추측 금지.

[dispatch 규칙]
- `steps` 에 capability 이름은 반드시 카탈로그에 존재하는 이름을 **정확히** 적을 것.
- capability 의 `required` 파라미터가 메시지·히스토리·장기기억으로 확정되면 args 에 채움.
  확정 안 되면 dispatch 대신 **ask** 로 빠질 것.
- depends_on: 이전 step 결과에 의존하면 그 step 의 capability 이름을 적고, 아니면 null 로 두어 병렬 실행 허용.
- brief 는 domain agent 가 읽을 수 있도록 짧고 구체적으로 ("사용자는 영업 3개월차 카페 사장님이고 재방문율 관심이 높음 — 재방문 유도형 이벤트 제안 우선" 같이).

**완성품 artifact 생성 capability 에는 "확장 필수 필드" 를 적용**:
아래 capability 들은 그 결과물이 DB 에 저장되어 사용자에게 **완성품**으로 보여지는 타입입니다.
단순 `required` 만 충족해서는 절대 dispatch 금지 — **확장 필수 필드** 가 모두 확정되어야 dispatch:

- `recruit_posting_set`  → position, wage_hourly 또는 wage_monthly, location, work_days (또는 weekly_hours), employment_type, business_name
- `recruit_hiring_drive` → title, start_date, end_date, headcount (+ business_name 권장)
- `mkt_sns_post`         → topic, product (또는 promotion), 사용자 프로필의 업종
- `mkt_blog_post`        → topic, keywords, 업종
- `mkt_ad_copy`          → product, target, key_benefit, channel
- `mkt_campaign_plan`    → title, start_date, end_date, goal, budget
- `doc_contract`         → subtype, party_a, party_b, start_date (+ amount 권장)
- `doc_estimate`         → client, items, total_amount, valid_until
- `doc_proposal`         → client, scope, amount, reply_by
- `sales_promotion`      → title, start_date, end_date, benefit, target

이들 필드 중 하나라도 **메시지/히스토리/프로필/장기기억** 에서 확정 안 되면 반드시 `mode=ask` 로 남은 필드 하나를 물으세요.
**여러 필드가 동시에 비어있으면 한 턴에 하나씩** — 가장 근본적인 것부터 (예: position → business_name → location → wage → work_days 순).

**"장소·매장명·전화번호" 같은 식별 정보는 환각 금지**:
사용자가 명시하지 않았고 프로필에도 없으면, `[주소]` / `[매장명]` / `[전화번호]` 같은 placeholder 로 채우는 건 artifact 저장 규칙 위반입니다.
확정되지 않은 식별 정보가 필요한 capability 는 그 정보를 **ask 로 먼저 수집** 한 뒤 dispatch 하세요.

[ask 규칙]
- required 파라미터 부족 또는 도메인 애매 시 사용. steps 는 비워두세요.

**한 턴 한 질문 (엄격)**:
- `question` 필드에 **정확히 하나의 질문**만. 두 개 이상 섞지 말 것.
- `opening` 에는 질문을 담지 마세요. opening 은 "확인해 보고 맞춤으로 작성할게요" 수준의 짧은 안내만 (생략 가능).
- 두 가지를 동시에 물어야 할 것 같으면 가장 근본적인 것 하나만 고르고 나머지는 다음 턴으로 미루세요.

**choices 를 적극 사용**:
- 자유 응답(choices=[]) 은 가능한 피하고 3~4개 후보 + 마지막 `"기타 (직접 입력)"` 로 구성.
- 후보는 **시스템 컨텍스트의 `[사용자 프로필]`** 을 그대로 읽어 그 업종에 맞는 실제 선택지를 제시.
- 프로필에 업종이 없으면 소상공인에게 흔한 업종을 일반 fallback 으로.

**프로필 선행 질문 (매우 중요 — 조건부)**:
- `[사용자 프로필]` 섹션의 `업종(business_type)` 값을 **그대로** 확인하세요.
- **업종이 이미 있으면**: 업종을 절대 다시 묻지 마세요. 그 업종 기준으로 도메인 파라미터(예: position) 의 choices 를 바로 구성.
- **업종이 비어있을 때만**: 도메인 파라미터 대신 **업종을 먼저** 물으세요. 이때는 업종 외 다른 것을 함께 묻지 말 것.
- 업종 외 다른 프로필 필드(가게명·단계·직원수 등) 가 비어있어도 ask mode 의 1차 질문으로 삼지 마세요 — 공고·광고 작성 품질에는 업종만 결정적으로 필요합니다. 나머지는 `[프로필 보강 지시 — STRONG]` 이 dispatch 응답 끝에 이어붙이는 질문으로 점진 수집됩니다.

**판단 알고리즘 (ask mode 에서 이 순서대로)**:
1. 프로필 업종이 비어있고, 요청이 업종-의존 작업(공고·광고·포스터 등) 이면 → question 은 업종 묻기, choices 는 업종 리스트.
2. 업종이 있으면 → required 파라미터(position 등) 를 업종 맞춤 choices 로 묻기.
3. 그 외 → 부족한 required 파라미터 하나를 일반 choices 로 묻기.

예시는 절대 출력에 그대로 옮기지 말고 로직만 따르세요. 질문 문장은 상황에 맞게 재작성할 것.

[planning 규칙]
- steps 는 비워두세요 (상위에서 기존 planning 핸들러로 위임).
- opening 에는 "이번 주 할 일을 정리해 드릴게요" 정도의 짧은 안내.

[refuse 규칙]
- steps 는 비워두세요.
- opening 에 정중한 한두 줄 거절 + BOSS 범위 안내.

[Sticky 주의]
- 직전 assistant 가 [CHOICES] 객관식 질문을 남긴 상태에서 사용자가 짧게 단답(숫자/한두 단어)을 하면
  그 답변은 chitchat 이 아니라 직전 도메인의 후속 입력입니다. 해당 도메인 capability 의 args 를 그 값으로 채워 dispatch 하세요.
- 직전 어시스턴트가 도메인 액션(artifact 저장·이미지 생성·분석) 을 수행했고 사용자가 '이걸로', '방금 거'
  처럼 맥락 지시어로 후속 요청을 하면 refuse 로 보내지 말고 그 도메인을 유지하세요.

[profile_updates — 매 턴 필수 체크]
이번 턴의 사용자 메시지(+ 직전 CHOICES 에 대한 답변) 에서 **명확히 확인된 프로필 정보** 가 있으면
`profile_updates` 필드에 담아주세요. dispatcher 가 DB 에 즉시 저장해서 다음 턴부터 재사용합니다.

- 허용 core key: business_type | business_name | business_stage | employees_count | location | channels | primary_goal
- 그 외 자유 key/value 도 가능 (예: sns_channels, operating_hours 등).
- value 는 짧은 문자열.
- 확신 없으면 절대 넣지 말 것. 없으면 빈 객체 `{}`.

판단 예:
- 사용자가 업종 CHOICES 에서 "카페·베이커리" 를 골랐다 → `{"business_type": "카페·베이커리"}`
- 사용자가 "관악구" 라고 답했다 (위치 묻던 턴) → `{"location": "관악구"}`
- 사용자가 "제빵왕김탁구" 라고 답했다 (매장명 묻던 턴) → `{"business_name": "제빵왕김탁구"}`
- 사용자가 여러 개 말했다 → 한 profile_updates 에 여러 key 동시 기록.
- 사용자 말이 모호하거나 진짜 프로필 정보가 아니면 (예: "피부관리사" — 이건 hiring target 이지 본인 업종이 아님) → 넣지 않기.

mode 와 무관하게(ask / dispatch / chitchat 모두) 이 필드는 채울 수 있습니다.
"""


def _format_capability_catalog(tools: list[dict]) -> str:
    """OpenAI tools spec 을 planner 가 읽을 사람-친화 카탈로그로 변환."""
    lines: list[str] = []
    for t in tools:
        f = t.get("function") or {}
        name = f.get("name", "")
        desc = (f.get("description") or "").strip().replace("\n", " ")
        params = f.get("parameters") or {}
        props = params.get("properties") or {}
        required = set(params.get("required") or [])
        arg_bits: list[str] = []
        for pname, pspec in props.items():
            pdesc = (pspec.get("description") or "").strip().replace("\n", " ")
            enum = pspec.get("enum")
            tag = " (required)" if pname in required else ""
            detail = pdesc[:80] if pdesc else pspec.get("type", "")
            if enum:
                detail = f"enum={enum}"
            arg_bits.append(f"{pname}{tag}: {detail}")
        args_line = ("\n    · " + "\n    · ".join(arg_bits)) if arg_bits else " (인자 없음)"
        lines.append(f"- `{name}` — {desc}{args_line}")
    return "\n".join(lines) if lines else "(카탈로그 비어있음)"


@traceable(name="planner.plan", run_type="chain")
async def plan(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    nick_ctx: str,
    memos_context: str,
    tools_catalog: list[dict],
    choices_context: str | None = None,
) -> PlanResult:
    """Planner 호출 — 실패 시 `{"mode": "error", "reason": ...}` 반환 (상위가 폴백)."""
    system_parts = [
        _PLANNER_SYSTEM,
        f"[오늘 날짜] {date.today().isoformat()}",
        nick_ctx,
    ]
    if long_term_context.strip():
        system_parts.append(f"[사용자 장기 기억]\n{long_term_context.strip()}")
    if memos_context.strip():
        system_parts.append(memos_context.strip())
    if rag_context.strip():
        system_parts.append(rag_context.strip())
    if choices_context:
        system_parts.append(
            "[직전 CHOICES 컨텍스트 — 최우선 라우팅 힌트]\n"
            "직전 assistant 응답에 아래 [CHOICES] 블록이 있었으며, "
            "사용자의 현재 메시지는 이 선택지에 대한 답변입니다.\n"
            "반드시 이 선택지를 생성한 도메인/capability 에 맞게 라우팅하세요. "
            "다른 도메인으로 오라우팅하거나 chitchat/refuse 로 보내지 마세요.\n\n"
            f"{choices_context}"
        )
    system_parts.append("[capability 카탈로그]\n" + _format_capability_catalog(tools_catalog))

    system = "\n\n".join(p for p in system_parts if p)

    try:
        obj = await planner_completion(
            messages=[
                {"role": "system", "content": system},
                *history[-8:],
                {"role": "user", "content": message},
            ],
            json_schema=_PLAN_JSON_SCHEMA,
            temperature=0.2,
        )
    except Exception as exc:
        log.exception("[planner] call failed (provider=%s)", settings.planner_provider)
        return {"mode": "error", "reason": f"llm call: {exc}"}

    if not isinstance(obj, dict):
        return {"mode": "error", "reason": f"non-dict response: {type(obj).__name__}"}

    mode = obj.get("mode")
    if mode not in ("dispatch", "ask", "chitchat", "refuse", "planning"):
        return {"mode": "error", "reason": f"invalid mode: {mode!r}"}

    # 방어: steps/choices 필드 타입 보정
    steps = obj.get("steps") or []
    if not isinstance(steps, list):
        steps = []
    norm_steps: list[PlanStep] = []
    for s in steps:
        if not isinstance(s, dict):
            continue
        cap = s.get("capability")
        if not isinstance(cap, str) or not cap:
            continue
        args = s.get("args") or {}
        if not isinstance(args, dict):
            args = {}
        dep = s.get("depends_on")
        if dep is not None and not isinstance(dep, str):
            dep = None
        norm_steps.append({"capability": cap, "args": args, "depends_on": dep})

    choices = obj.get("choices") or []
    if not isinstance(choices, list):
        choices = []
    choices = [str(c) for c in choices if isinstance(c, (str, int, float))]

    # profile_updates — 문자열 key/value dict 로 보정
    raw_updates = obj.get("profile_updates") or {}
    profile_updates: dict[str, str] = {}
    if isinstance(raw_updates, dict):
        for k, v in raw_updates.items():
            if not isinstance(k, str) or not k.strip():
                continue
            if isinstance(v, (str, int, float)) and str(v).strip():
                profile_updates[k.strip().lower()] = str(v).strip()[:200]

    result: PlanResult = {
        "mode": mode,
        "opening": str(obj.get("opening") or "").strip(),
        "brief": str(obj.get("brief") or "").strip(),
        "steps": norm_steps,
        "question": str(obj.get("question") or "").strip(),
        "choices": choices,
        "profile_updates": profile_updates,
    }
    log.info(
        "[planner] provider=%s account=%s mode=%s steps=%s opening_len=%d profile_updates=%s",
        settings.planner_provider,
        account_id,
        mode,
        [s["capability"] for s in norm_steps],
        len(result["opening"]),
        list(profile_updates.keys()) if profile_updates else [],
    )
    return result
