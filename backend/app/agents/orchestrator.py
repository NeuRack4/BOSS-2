import json
import logging
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from langsmith import traceable

from app.core.llm import chat_completion
from app.core.config import settings
from app.core.supabase import get_supabase

log = logging.getLogger("boss2.orchestrator")

DOMAINS = ("recruitment", "marketing", "sales", "documents")
INTENT_LABELS = (*DOMAINS, "chitchat", "refuse", "planning")

_SET_NICKNAME_RE = re.compile(r"\[SET_NICKNAME\](.*?)\[/SET_NICKNAME\]", re.DOTALL)
_SET_PROFILE_RE = re.compile(r"\[SET_PROFILE\](.*?)\[/SET_PROFILE\]", re.DOTALL)
_ARTIFACT_RE = re.compile(r"\[ARTIFACT\](.*?)\[/ARTIFACT\]", re.DOTALL)
_CHOICES_RE = re.compile(r"\[CHOICES\](.*?)\[/CHOICES\]", re.DOTALL)
# [[TAG]]...[[/TAG]] — 프론트 인라인 카드용 이중 브래킷 마커 (합성 시 passthrough 대상)
_DOUBLE_BRACKET_MARKER_RE = re.compile(r"\[\[[A-Z_]+\]\][\s\S]*?\[\[/[A-Z_]+\]\]", re.DOTALL)

CORE_PROFILE_KEYS = (
    "business_type",
    "business_name",
    "business_stage",
    "employees_count",
    "location",
    "channels",
    "primary_goal",
)
PROFILE_LABELS = {
    "business_type": "업종",
    "business_name": "가게명",
    "business_stage": "사업 단계",
    "employees_count": "직원 수",
    "location": "위치",
    "channels": "주 채널",
    "primary_goal": "핵심 목표",
}


def _strip_inline_blocks(text: str) -> str:
    text = _SET_NICKNAME_RE.sub("", text)
    text = _SET_PROFILE_RE.sub("", text)
    text = _ARTIFACT_RE.sub("", text)
    text = _CHOICES_RE.sub("", text)
    return text.strip()


def _extract_artifact_summaries(text: str) -> list[dict]:
    out: list[dict] = []
    for m in _ARTIFACT_RE.finditer(text):
        block = m.group(1)
        parsed: dict[str, str] = {}
        for line in block.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                parsed[k.strip()] = v.strip()
        if parsed:
            out.append(parsed)
    return out


def get_nickname(account_id: str) -> str | None:
    sb = get_supabase()
    rows = (
        sb.table("profiles")
        .select("display_name")
        .eq("id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    name = (rows[0].get("display_name") or "").strip()
    return name or None


def save_nickname(account_id: str, nickname: str) -> None:
    name = (nickname or "").strip()[:40]
    if not name:
        return
    sb = get_supabase()
    sb.table("profiles").upsert({"id": account_id, "display_name": name}).execute()


def _extract_and_save_nickname(account_id: str, reply: str) -> str:
    """응답에서 [SET_NICKNAME] + [SET_PROFILE] 블록을 뜯어내 저장하고, 본문에선 제거해 돌려준다.

    이름은 이전 호환을 위해 유지; 실제론 nickname + profile 둘 다 처리한다.
    """
    m = _SET_NICKNAME_RE.search(reply)
    if m:
        candidate = m.group(1).strip()
        if candidate:
            try:
                save_nickname(account_id, candidate)
            except Exception:
                pass
        reply = _SET_NICKNAME_RE.sub("", reply).strip()
    reply = _extract_and_save_profile(account_id, reply)
    return reply


NICKNAME_RULE = """
[닉네임 규칙]
- system 컨텍스트에 "사용자 닉네임"이 주어지면 응답 중 최소 1회 그 호칭(+존칭, 예: "OO 사장님")으로 자연스럽게 사용하세요. 과하게 반복하지 마세요.
- 아직 닉네임이 없는 상태에서 사용자가 자신의 이름/호칭/가게 이름을 알려주면(예: "나 홍길동이야", "OO카페 사장입니다"), 그 호칭을 저장해야 합니다. 응답 끝에 아래 블록을 **한 줄로** 추가하세요:

[SET_NICKNAME]닉네임문자열[/SET_NICKNAME]

- 닉네임이 이미 있는 상태에서 사용자가 새 이름으로 바꿔달라고 하면 동일하게 [SET_NICKNAME] 블록으로 갱신하세요.
- 그 외 대화에서는 블록을 넣지 마세요.
"""

PROFILE_RULE = """
[프로필 규칙]
- system 컨텍스트의 "사용자 프로필"을 참고해 답변을 맞춤화하세요. (예: 업종이 카페면 카페 톤, 채널이 offline이면 오프라인 중심 제안)
- 사용자가 대화 중 자기 사업 정보를 말하면 응답 끝에 [SET_PROFILE] 블록으로 저장하세요. **확실한 정보만**. 추측은 저장 금지.

형식 (한 줄당 key: value):

[SET_PROFILE]
business_type: 카페
location: 서울 마포
[/SET_PROFILE]

- 허용 core key: business_type, business_name, business_stage(창업 준비|오픈 직전|영업 중|확장 중), employees_count(0|1-3|4-9|10+), location, channels(offline|online|both), primary_goal.
- channels 가 online 또는 both 인 경우 SNS 채널을 알게 되면 `sns_channels: 인스타,네이버블로그,틱톡` 처럼 쉼표 구분 값으로 함께 저장.
- 그 외 자유 정보(영업시간, 고정 고객층 등)도 같은 블록 안에 key: value 로 저장하면 profile_meta 에 들어갑니다.
- 이미 저장된 값을 갱신하려면 같은 key 로 새 value 를 넣으세요.
- 저장할 정보가 없는 일반 대화 턴엔 블록을 넣지 마세요.
"""

CLARIFY_RULE = """
[명확화 질문 규칙]
사용자의 요청이 모호하거나 결과물을 만들기 위해 추가 정보가 필요하면, 바로 작업을 수행하지 말고 먼저 **객관식 질문 1개**를 던져 명확히 하세요.

- 질문은 짧고 명확하게 1개만
- 보기는 3~4개 제시하고, **항상 마지막 보기는 "기타 (직접 입력)"**
- 응답 본문 끝에 아래 형식 블록을 반드시 추가:

[CHOICES]
보기1
보기2
보기3
기타 (직접 입력)
[/CHOICES]

- 정보가 충분하면 질문 없이 바로 결과물을 작성하고 [CHOICES] 블록은 넣지 마세요.
- 동시에 여러 개의 [CHOICES] 블록을 넣지 마세요. (한 번에 하나의 질문)
- 도메인별 "필수 필드 매트릭스"가 주어진 경우, 매트릭스의 필드가 **모두** 채워질 때까지 [CHOICES] 질문을 반복하세요. 2~3턴에 끊지 말고 필요한 만큼 더 물어도 됩니다.
"""

ARTIFACT_RULE = """
[결과물 생성 규칙]
1) CLARIFY_RULE 에 따라 도메인별 "필수 필드 매트릭스"의 모든 필드가 확정되기 전엔 [ARTIFACT] 블록을 출력하지 마세요. 한 필드라도 비어 있으면 [CHOICES] 로 계속 물어보세요.
2) 필수 필드가 모두 확정되는 순간 즉시 결과물 본문을 **완성된 형태**로 작성하고, 응답 끝에 반드시 [ARTIFACT] 블록을 붙이세요. "필요한 부분을 말씀해 주세요", "추가로 궁금한 점이…" 같은 맺음말로 끝내지 마세요.
3) 완성된 결과물에 <TBD>, <예시>, "필요에 따라 조정" 같은 placeholder 를 넣지 마세요. 아직 결정되지 않은 값이 있으면 [ARTIFACT] 를 붙이지 말고 CLARIFY 로 돌아가 그 값을 먼저 물으세요.

블록 스키마 (type/title 필수, 나머지 선택):

[ARTIFACT]
type: <도메인별 허용 타입 중 하나>
title: <간결한 제목>
start_date: YYYY-MM-DD
end_date: YYYY-MM-DD
due_date: YYYY-MM-DD
due_label: <마감의 의미 라벨 — 예: 계약 만료 / 납품기한 / 견적 유효기간 / 공지 게시일 / 제안 회신 기한>
contract_subtype: <documents·contract 인 경우만 — labor|lease|service|supply|partnership|franchise|nda>
sub_domain: <서브허브 title — system 컨텍스트의 "이 계정의 서브허브" 목록에서만 선택>
[/ARTIFACT]

- 사용자가 기간을 자연어로 말했다면(예: "내일부터 1주일", "다음주 금요일까지") 오늘 날짜 기준으로 환산해 start_date/end_date 또는 due_date 에 YYYY-MM-DD 로 채우세요.
- 기간성(캠페인·프로젝트·계약·프로모션·공채)은 start_date+end_date 조합, 단일 마감은 due_date 한 줄로 표현합니다.
- 납품기한·제출기한 같은 특수 마감도 별도 키를 만들지 말고 **due_date + due_label** 조합으로 통일하세요 (스케쥴 D-7/3/1/0 리마인드가 하나의 경로로 작동).
- sub_domain 라인은 "이 계정의 서브허브" 목록에 있는 title 을 **대소문자 포함 정확히** 적어야 합니다. 적절한 후보가 없다고 판단되면 sub_domain 라인 자체를 넣지 마세요 (임의로 새 이름을 지어내지 말 것).
"""

SYSTEM_PROMPT = """당신은 소상공인을 돕는 AI 플랫폼 BOSS의 오케스트레이터입니다.
사용자의 요청을 분석하여 적절한 도메인 에이전트로 라우팅하고, 최종 응답을 조율합니다.

도메인:
- recruitment: 채용공고 작성, 면접 질문, 직원 관리 (채용 관리)
- marketing: SNS 포스트, 광고 카피, 이벤트 기획, 블로그 포스팅, 리뷰 답글 작성 (마케팅 관리)
- sales: 매출 입력/분석, 비용 입력/기록, 가격 전략, 고객 응대 스크립트 (매출·비용 관리)
- documents: 계약서, 견적서, 공지문, 행정 서류 작성 (서류 관리)

규칙:
1. 요청이 특정 도메인에 해당하면 해당 에이전트를 호출하세요.
2. 여러 도메인에 걸치면 순서대로 처리하세요.
3. 일상 대화나 도메인 무관 질문은 직접 답변하세요.
""" + CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE


INTENT_LABELS = (*DOMAINS, "chitchat", "refuse")


_DOMAIN_STICKY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "recruitment": (
        "채용", "공고", "알바", "아르바이트", "면접", "직원", "고용", "인력",
        "시급", "주휴", "근로", "근무시간", "바리스타", "홀서빙", "주방", "인건비",
    ),
    "marketing": (
        "인스타", "인스타그램", "블로그", "광고", "캠페인", "홍보", "sns",
        "포스트", "이벤트 기획", "콘텐츠", "피드", "릴스", "네이버 블로그",
    ),
    "sales": (
        "매출", "가격", "단가", "할인", "객단가", "pos", "매장 분석", "손익",
        "비용", "지출", "경비", "원가", "재료비", "인건비", "임대료", "공과금",
    ),
    "documents": (
        "계약서", "견적서", "공지문", "제안서", "체크리스트",
        "임대차", "근로계약", "nda", "비밀유지", "법령", "조례", "조항",
    ),
}

# 맥락 지시어 — "이걸로", "방금", "그거" 등이 오면 직전 도메인 답변의 후속일 확률 높음.
_CONTEXT_REFERENCE_KEYWORDS: tuple[str, ...] = (
    "이걸로", "이거로", "이거", "저거", "그거", "방금", "방금 거", "방금 것",
    "위에", "위 공고", "이 공고", "이 문서", "이 계약서", "조금 전",
    "예시처럼", "카드로", "이런 식으로", "저렇게", "그렇게",
    "업로드까지", "게시까지", "올려줘", "올려줘요",
)

# 도메인 에이전트가 직전 턴에 실제 액션을 취했다는 신호 (본문 노티스 / 마커 흔적).
_DOMAIN_ACTION_SIGNALS: tuple[str, ...] = (
    "저장되었어요", "저장했어요", "캔버스에", "artifact", "artifact:",
    "[ARTIFACT]", "[JOB_POSTINGS]", "세트 artifact", "이미지 생성 완료",
    "분석 artifact", "공정성 분석",
    "[[instagram_post]]", "인스타그램 피드", "게시물을 저장", "sns 게시물",
    "블로그 포스트", "업로드 완료", "포스팅 저장",
)


def _last_assistant_unresolved_choices(history: list[dict]) -> str | None:
    """직전 assistant 메시지에 [CHOICES] 가 살아있으면 그 메시지 원문을 반환. 없으면 None.

    최근 메시지가 user 가 아니어도 (예: system 메시지 등장) 역순 스캔으로 assistant 만 찾음.
    """
    for h in reversed(history):
        if h.get("role") == "assistant":
            c = (h.get("content") or "").strip()
            if "[CHOICES]" in c and "[/CHOICES]" in c:
                return c
            return None
    return None


def _last_assistant_did_domain_action(history: list[dict]) -> bool:
    """최근 assistant 턴 1~2개가 도메인 에이전트의 실제 액션 결과(아티팩트 저장·이미지 생성·분석) 였는지 감지.

    예: "(채용공고 3종이 캔버스에 저장되었어요 — 세트 artifact: ...)" 같은 노티스.
    """
    seen = 0
    for h in reversed(history):
        if h.get("role") != "assistant":
            continue
        seen += 1
        c = (h.get("content") or "").lower()
        if any(sig.lower() in c for sig in _DOMAIN_ACTION_SIGNALS):
            return True
        if seen >= 2:
            break
    return False


def _has_context_reference(message: str) -> bool:
    low = (message or "").casefold()
    return any(kw in low for kw in _CONTEXT_REFERENCE_KEYWORDS)


def _guess_domain_from_recent(message: str, history: list[dict]) -> str | None:
    """최근 대화에서 도메인 키워드 빈도로 추정 (LLM 비용 없는 fallback).

    message + 최근 8 turn 의 content 를 조인해 키워드 매칭. 가장 많이 맞는 도메인.
    동점이거나 매칭 0 이면 None.
    """
    joined = message + "\n" + "\n".join((h.get("content") or "") for h in history[-8:])
    low = joined.casefold()
    scores: dict[str, int] = {}
    for dom, kws in _DOMAIN_STICKY_KEYWORDS.items():
        n = sum(1 for kw in kws if kw in low)
        if n > 0:
            scores[dom] = n
    if not scores:
        return None
    best = max(scores.items(), key=lambda kv: kv[1])
    # 동점 다수면 보수적으로 None 반환
    top_n = best[1]
    tied = [d for d, n in scores.items() if n == top_n]
    return tied[0] if len(tied) == 1 else None


async def classify_intent(message: str, history: list[dict]) -> list[str]:
    """사용자 의도를 분류. 복수 도메인이면 쉼표로 연결된 라벨 리스트를 돌려준다.

    라벨: recruitment|marketing|sales|documents|chitchat|refuse|planning
    - planning: 여러 도메인 가로지르는 기간별 할 일/플랜/정리 요청
    - 복수 도메인: ex) "채용공고랑 인스타 같이" → [recruitment, marketing]

    CHOICES Sticky:
      직전 assistant 메시지에 [CHOICES] 블록이 살아있으면, 사용자의 짧은 단답/숫자/
      선택 답변이 chitchat 으로 오분류되지 않도록 classifier 에 힌트를 주고,
      결과가 chitchat 이더라도 최근 대화 키워드로 도메인을 복구한다.
    """
    last_choices = _last_assistant_unresolved_choices(history)
    recent_domain_action = _last_assistant_did_domain_action(history)
    has_ctx_ref = _has_context_reference(message)

    sticky_hint = ""
    if last_choices:
        # 토큰 절약: 직전 assistant 본문 앞쪽 300자만
        snippet = last_choices[:300].replace("\n", " ")
        sticky_hint = (
            "\n\n[직전 대화 상태]\n"
            "직전 어시스턴트가 사용자에게 [CHOICES] 객관식 질문을 남겼고, **지금 사용자 메시지는 그 질문의 답변일 가능성이 매우 높습니다**. "
            "짧은 단답(숫자·한두 단어)이라도 chitchat 으로 오분류하지 말고, 직전 어시스턴트가 속한 도메인을 그대로 유지하세요.\n"
            f"직전 어시스턴트 발화 앞부분: {snippet}"
        )
    elif recent_domain_action and has_ctx_ref:
        sticky_hint = (
            "\n\n[직전 대화 상태]\n"
            "직전 어시스턴트가 도메인 에이전트 결과(아티팩트 저장·이미지 생성·분석 등) 를 방금 보여줬고, "
            "지금 사용자 메시지는 그 결과를 가리키는 후속 지시('이걸로', '방금 거' 등) 입니다. "
            "**그 직전 도메인을 그대로 유지**하세요. refuse 로 내보내지 마세요."
        )

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": (
                "사용자 메시지의 처리 라벨을 출력하세요.\n"
                "가능한 라벨:\n"
                "- recruitment: 채용공고·면접·직원 관리 + **채용공고 이미지/포스터/썸네일 생성**\n"
                "- marketing: SNS·광고·이벤트 기획·블로그·리뷰 답글 작성 + **광고 이미지·썸네일·배너 생성** + **유튜브 쇼츠·영상·숏폼 제작**\n"
                "- sales: 매출 입력/분석·비용 입력/기록·가격·고객 응대 스크립트\n"
                "- documents: 세 가지 작업 모두 포함.\n"
                "    (1) 계약서·견적서·공지·행정 서류 **작성/검토**.\n"
                "    (2) **한국의 모든 법률·법령·조례·시행령·시행규칙에 대한 질문** — 조언 요청이든 단순 내용 문의든 "
                "전부 documents 로 분류. 분야 불문 (노동·임대차·공정거래·개인정보·세법·상법·프랜차이즈·전자상거래·식품위생·"
                "소방법·건축법·도로교통법·환경·저작권·의료법·형법 등). 예: '소방법 알려줘', '임대료 인상 거절할 수 있나요?', "
                "'음식점 영업허가 절차', '개인정보 유출 과태료', '근로자가 무단 퇴사하면?', '상표 출원 어떻게 해?'.\n"
                "    (3) **정부지원사업·보조금·창업지원 추천** — '지원사업 추천', '보조금 뭐가 있어', '정부지원 받고 싶어', "
                "'어떤 지원사업이 잘 맞을까' 등 → documents 로 분류.\n"
                "- planning: 여러 도메인에 걸친 기간 단위 할 일 정리/플랜 요청 (예: '이번 주 할 일', '오늘 뭐 해야 돼')\n"
                "- chitchat: 인사, 이름/호칭 설정, BOSS 사용법, 상태 질문, 감사 인사\n"
                "- refuse: 위 어디에도 속하지 않는 요청 (코딩, 날씨·뉴스, 철학·연애 상담, 일반 상식·역사·과학 QA 등). "
                "단, **법률·법령 관련 질문은 일반 상식 QA 로 보지 말고 documents 로 분류**. "
                "또한 **이미지/포스터/썸네일/배너 생성 요청은 refuse 가 아니라 그 이미지가 쓰일 도메인(recruitment 또는 marketing) 으로 분류**. "
                "**유튜브/쇼츠/숏폼/영상 만들기 요청도 marketing 으로 분류**.\n"
                "\n규칙:\n"
                "- 요청이 2개 이상의 도메인에 **동시에** 걸치면 쉼표로 연결. 예: 'recruitment,marketing'\n"
                "- 기간 단위로 여러 도메인을 아우르는 정리/플랜 요청은 'planning' 단독.\n"
                "- 맥락 지시어('이걸로', '방금 거', '이 공고' 등) 가 있고 직전에 어떤 도메인 작업이 있었으면 그 도메인으로 유지. refuse 금지.\n"
                "- 공백 없이, 소문자로, 한 줄로만 출력."
                + sticky_hint
            )},
            *history[-8:],
            {"role": "user", "content": message},
        ],
        model=settings.openai_compress_model,
        max_tokens=30,
        temperature=0,
    )
    raw = (resp.choices[0].message.content or "").strip().lower()
    labels = [l.strip() for l in raw.split(",") if l.strip()]
    valid = [l for l in labels if l in INTENT_LABELS]
    if not valid:
        valid = ["chitchat"]
    # planning 또는 refuse 는 단독이어야 함
    if "planning" in valid:
        return ["planning"]
    if "refuse" in valid and len(valid) == 1:
        return ["refuse"]
    # refuse 가 도메인과 섞이면 refuse 무시
    valid = [l for l in valid if l != "refuse"]
    # chitchat 이 도메인과 섞이면 chitchat 무시
    if len(valid) > 1 and "chitchat" in valid:
        valid = [l for l in valid if l != "chitchat"]
    result = valid or ["chitchat"]

    # Sticky override — LLM 오분류 복구.
    #  1) chitchat + 미해결 CHOICES: 답변 단답을 놓친 경우
    #  2) refuse + (미해결 CHOICES 또는 직전 도메인 액션 + 맥락 지시어): "이걸로 이미지" 같은 후속 지시를 거절하는 오류
    if result == ["chitchat"] and last_choices:
        guess = _guess_domain_from_recent(message, history)
        if guess:
            log.info("[classify] sticky override chitchat→%s (CHOICES unresolved)", guess)
            return [guess]

    if result == ["refuse"] and (last_choices or (recent_domain_action and has_ctx_ref)):
        guess = _guess_domain_from_recent(message, history)
        if guess:
            log.info(
                "[classify] sticky override refuse→%s (action=%s ref=%s)",
                guess, recent_domain_action, has_ctx_ref,
            )
            return [guess]

    return result


def _refusal_message(account_id: str) -> str:
    name = get_nickname(account_id)
    salut = f"{name} 사장님, " if name else ""
    return (
        f"{salut}죄송해요. 그 부분은 제가 도와드리기 어려워요.\n"
        "BOSS는 **채용 · 마케팅 · 매출 · 서류** 이 네 가지 업무만 담당합니다.\n"
        "이 중에 필요한 게 있으시면 편하게 말씀해 주세요."
    )


def get_profile(account_id: str) -> dict:
    sb = get_supabase()
    rows = (
        sb.table("profiles")
        .select(
            "id,display_name,business_type,business_name,business_stage,"
            "employees_count,location,channels,primary_goal,profile_meta"
        )
        .eq("id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else {}


def _save_profile_updates(account_id: str, core: dict, meta: dict) -> None:
    if not core and not meta:
        return
    sb = get_supabase()
    if core:
        sb.table("profiles").update(core).eq("id", account_id).execute()
    if meta:
        cur = (
            sb.table("profiles")
            .select("profile_meta")
            .eq("id", account_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        existing = (cur[0].get("profile_meta") or {}) if cur else {}
        if not isinstance(existing, dict):
            existing = {}
        existing.update(meta)
        sb.table("profiles").update({"profile_meta": existing}).eq("id", account_id).execute()


_PROFILE_STAGE_ALLOWED = {"창업 준비", "오픈 직전", "영업 중", "확장 중"}
_PROFILE_CHANNELS_ALLOWED = {"offline", "online", "both"}

# Planner/LLM이 유사 표현으로 저장할 때 정규 값으로 매핑
_STAGE_NORMALIZE: dict[str, str] = {
    "창업 준비": "창업 준비",
    "창업 준비 중": "창업 준비",
    "창업 준비중": "창업 준비",
    "오픈 직전": "오픈 직전",
    "창업 초기": "오픈 직전",
    "창업 초기 (1년 미만)": "오픈 직전",
    "영업 중": "영업 중",
    "영업중": "영업 중",
    "성장기": "영업 중",
    "성장기 (1~3년)": "영업 중",
    "확장 중": "확장 중",
    "확장중": "확장 중",
    "안정기": "확장 중",
    "안정기 (3년 이상)": "확장 중",
}


def _extract_and_save_profile(account_id: str, reply: str) -> str:
    """응답에서 [SET_PROFILE] 블록을 파싱해 저장, 본문에선 제거."""
    if not _SET_PROFILE_RE.search(reply):
        return reply
    core: dict[str, str] = {}
    meta: dict = {}
    for m in _SET_PROFILE_RE.finditer(reply):
        for line in m.group(1).strip().splitlines():
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            key = k.strip().lower()
            val = v.strip()
            if not key or not val:
                continue
            if key in CORE_PROFILE_KEYS:
                if key == "business_stage":
                    val = _STAGE_NORMALIZE.get(val, val)
                    if val not in _PROFILE_STAGE_ALLOWED:
                        continue
                if key == "channels" and val.lower() not in _PROFILE_CHANNELS_ALLOWED:
                    continue
                core[key] = val[:200]
            elif key == "sns_channels":
                items = [x.strip() for x in val.split(",") if x.strip()]
                if items:
                    meta["sns_channels"] = items[:10]
            else:
                meta[key] = val[:500]
    if core or meta:
        try:
            _save_profile_updates(account_id, core, meta)
        except Exception:
            pass
    return _SET_PROFILE_RE.sub("", reply).strip()


def _profile_context(account_id: str) -> str:
    """system prompt 주입용 프로필 요약. 빈 core 필드도 `(비어있음)` 으로 명시.

    Planner 가 "업종이 채워졌는지" 를 정확히 판단하려면 빈 필드의 존재를 알 수 있어야 한다.
    채워진 필드만 보여주면 planner 는 "업종이 비어있는지" 를 알 길이 없어 잘못된 choice 를 만들게 됨.
    """
    p = get_profile(account_id)
    if not p:
        p = {}
    lines: list[str] = []
    for k in CORE_PROFILE_KEYS:
        v = p.get(k)
        if isinstance(v, str) and v.strip():
            lines.append(f"- {PROFILE_LABELS[k]}: {v.strip()}")
        else:
            lines.append(f"- {PROFILE_LABELS[k]}: (비어있음)")
    meta = p.get("profile_meta") or {}
    if isinstance(meta, dict):
        for mk, mv in meta.items():
            if isinstance(mv, list):
                mv = ", ".join(str(x) for x in mv)
            if mv:
                lines.append(f"- {mk}: {mv}")
    return "\n\n[사용자 프로필]\n" + "\n".join(lines)


def _profile_sparseness(account_id: str) -> tuple[int, list[str]]:
    """(채워진 core 필드 수, 비어있는 core 필드 이름 리스트)."""
    p = get_profile(account_id)
    if not p:
        return 0, list(CORE_PROFILE_KEYS)
    filled: list[str] = []
    missing: list[str] = []
    for k in CORE_PROFILE_KEYS:
        v = p.get(k)
        if isinstance(v, str) and v.strip():
            filled.append(k)
        else:
            missing.append(k)
    return len(filled), missing


def _nickname_context(account_id: str) -> str:
    name = get_nickname(account_id)
    if name:
        return f"\n\n[사용자 닉네임]\n{name}"
    return "\n\n[사용자 닉네임]\n(아직 미설정 — 사용자가 이름/호칭/가게 이름을 알려주면 [SET_NICKNAME] 블록으로 저장할 것)"


PROFILE_NUDGE_THRESHOLD = 3


def _profile_nudge_context(account_id: str) -> str:
    """프로필 core 필드가 임계치 미만일 때 에이전트에게 주는 STRONG 넛지 지시.

    응답이 [CHOICES]/[ARTIFACT] 블록을 이미 출력하는 턴에는 중첩 금지를 위해 다음 턴으로 미루고,
    그 외 턴에는 본문 마지막 한 문장으로 빈 필드 중 하나를 직접 물어보도록 강제.
    """
    filled, missing = _profile_sparseness(account_id)
    if filled >= PROFILE_NUDGE_THRESHOLD or not missing:
        return ""
    labels = [PROFILE_LABELS[k] for k in missing[:3]]
    return (
        "\n\n[프로필 보강 지시 — STRONG]\n"
        f"이 계정 프로필은 현재 {filled}/{len(CORE_PROFILE_KEYS)} 만 채워져 있습니다. "
        f"비어있는 핵심 항목: {', '.join(labels)}.\n"
        "추천·자동 실행·맞춤화 품질이 직접 영향을 받으므로 프로필이 임계치에 찰 때까지 **매 턴 한 필드씩** 수집하세요. "
        "한 세션에 한 번이 아니라, 프로필이 충분해질 때까지 **매 턴 반복**입니다.\n"
        "- 이번 응답에 [CHOICES] 나 [ARTIFACT] 블록이 **없으면**: 응답 **마지막 문장**으로 위 비어있는 항목 중 **하나**를 특정해서 직접 질문하세요. "
        "'맞춤 조언을 위해 여쭤볼게요' 같이 이유를 짧게 덧붙이고, 두루뭉술한 '더 알려주실 수 있을까요?' 금지. 반드시 특정 필드명을 찍어서 묻기.\n"
        "- **사용자가 직전 턴의 프로필 질문에 이미 답했더라도 동일 원칙**: 이번 응답에서 [SET_PROFILE] 로 저장하고, "
        "여전히 비어있는 항목이 있으면 **같은 응답의 마지막 문장**에서 다음 빈 필드 하나를 바로 이어서 물으세요. "
        "'감사합니다, 언제든 말씀해 주세요' 같이 대화를 닫지 말 것. 프로필이 다 찰 때까지 한 턴도 멈추지 않습니다.\n"
        "- 이번 응답에 이미 [CHOICES] 또는 [ARTIFACT] 블록이 있으면: 프로필 질문은 다음 턴으로 미루세요 (블록 중첩 금지). "
        "단 이때도 [SET_PROFILE] 저장은 가능하면 수행하세요.\n"
        "- 사용자가 자연어로라도 정보를 말하면 응답 말미에 [SET_PROFILE] 블록으로 **반드시** 저장. "
        "한 메시지에 여러 필드(예: '관악구에서 음식점')가 들어오면 여러 key 를 한 블록에 담아 한꺼번에 저장하세요.\n"
        "- 사용자가 '나중에', '지금은 됐어' 처럼 **명시적으로 거부**한 경우에만 이번 세션엔 중단하세요."
    )


def _agent_map():
    from app.agents import recruitment, marketing, sales, documents
    return {
        "recruitment": recruitment.run,
        "marketing": marketing.run,
        "sales": sales.run,
        "documents": documents.run,
    }


def _memos_context(account_id: str, limit: int = 10) -> str:
    """Planner 에 주입할 최근 메모 요약. 없으면 빈 문자열.

    `memos` 테이블의 최신 N건 + artifact.title join. 본문은 120자까지 잘라 리스트로.
    """
    try:
        sb = get_supabase()
        rows = (
            sb.table("memos")
            .select("content,updated_at,artifact_id,artifacts(title)")
            .eq("account_id", account_id)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception:
        return ""
    if not rows:
        return ""
    lines: list[str] = ["[최근 메모]"]
    for r in rows:
        content = (r.get("content") or "").strip().replace("\n", " ")
        if not content:
            continue
        art = r.get("artifacts") or {}
        title = (art.get("title") if isinstance(art, dict) else None) or "(메모)"
        snippet = content if len(content) <= 120 else content[:120] + "…"
        lines.append(f"- {title}: {snippet}")
    if len(lines) == 1:
        return ""
    return "\n".join(lines)


# ──────────────────────────────────────────────────────────────────────────
# Planner 기반 dispatcher (v1.1+ — "오케스트레이터가 읽고 지시한다")
# ──────────────────────────────────────────────────────────────────────────
async def _dispatch_via_planner(
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    nick_ctx: str,
) -> str | None:
    """Planner 주 경로.

    반환:
      - str  : 최종 응답 (opening + tool reply 합성).
      - None : planner 호출/파싱 실패 → 상위 run() 이 legacy 폴백 수행.
    """
    import asyncio
    from app.agents import _planner
    from app.agents._capability import describe_all
    from app.agents._speaker_context import set_speaker

    tools, dispatch = describe_all(account_id)
    if not tools:
        log.info("[planner] account=%s no_tools → fallback", account_id)
        return None

    memos_ctx = _memos_context(account_id)

    # 미해결 CHOICES가 있으면 플래너에게 라우팅 힌트로 주입
    choices_ctx = _last_assistant_unresolved_choices(history)

    # 업로드 파일이 있으면 플래너에게 힌트 주입 (recruit_resume_parse 라우팅용)
    from app.agents._upload_context import get_pending_upload, get_pending_uploads
    _uploads = get_pending_uploads() or []
    if not _uploads:
        _single = get_pending_upload()
        if _single:
            _uploads = [_single]
    upload_hint: str | None = None
    if _uploads:
        names = ", ".join(u.get("original_name") or u.get("title") or "파일" for u in _uploads)
        upload_hint = (
            f"[첨부 파일 감지 — 라우팅 OVERRIDE]\n"
            f"이번 요청에 파일 {len(_uploads)}개가 첨부돼 있습니다: {names}\n"
            "⚠️ 파일이 첨부된 경우 사용자 메시지 내용과 무관하게 반드시 **recruit_resume_parse** 를 즉시 dispatch 하세요. "
            "'면접 질문' 등 다른 의도가 있어도 파싱 없이 바로 interview 를 생성하면 안 됩니다. "
            "recruit_resume_parse 는 required 파라미터 없음 — 파일 내용은 contextvar 로 이미 전달됩니다."
        )

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
    mode = result.get("mode")
    if mode == "error":
        log.info("[planner] account=%s error reason=%s → fallback", account_id, result.get("reason"))
        return None

    # 업로드가 있는데 planner 가 dispatch 하지 않았으면 강제 override
    # (LLM 이 chitchat/ask/refuse 로 잘못 분류해도 recruitment agent 가 처리하도록)
    if _uploads and mode != "dispatch":
        log.info(
            "[planner] account=%s upload_override mode=%s → force recruit_resume_parse",
            account_id, mode,
        )
        result = {
            "mode": "dispatch",
            "opening": result.get("opening") or "",
            "brief": result.get("brief") or "",
            "steps": [{"capability": "recruit_resume_parse", "args": {}, "depends_on": None}],
            "question": "",
            "choices": [],
            "profile_updates": result.get("profile_updates") or {},
        }
        mode = "dispatch"

    opening = (result.get("opening") or "").strip()
    brief = (result.get("brief") or "").strip()

    # profile_updates 즉시 저장 (ask/dispatch/chitchat 무관)
    updates = result.get("profile_updates") or {}
    if updates:
        core: dict[str, str] = {}
        meta: dict[str, str] = {}
        for k, v in updates.items():
            if not isinstance(v, str) or not v.strip():
                continue
            if k in CORE_PROFILE_KEYS:
                if k == "business_stage":
                    v = _STAGE_NORMALIZE.get(v, v)
                    if v not in _PROFILE_STAGE_ALLOWED:
                        continue
                if k == "channels" and v.lower() not in _PROFILE_CHANNELS_ALLOWED:
                    continue
                core[k] = v[:200]
            else:
                meta[k] = v[:500]
        if core or meta:
            try:
                _save_profile_updates(account_id, core, meta)
                log.info(
                    "[planner] account=%s profile_saved core=%s meta=%s",
                    account_id, list(core.keys()), list(meta.keys()),
                )
            except Exception:
                log.exception("[planner] profile save failed")

    if mode == "refuse":
        set_speaker(["orchestrator"])
        return opening or _refusal_message(account_id)

    if mode == "chitchat":
        if not opening:
            return None  # 비어있으면 폴백
        set_speaker(["orchestrator"])
        return _extract_and_save_nickname(account_id, opening)

    if mode == "planning":
        set_speaker(["orchestrator"])
        return await _handle_planning(message, account_id, history, long_term_context, nick_ctx)

    if mode == "ask":
        q = (result.get("question") or "").strip()
        choices = result.get("choices") or []
        body_parts: list[str] = []
        if opening:
            body_parts.append(opening)
        if q:
            body_parts.append(q)
        text = "\n\n".join(body_parts) if body_parts else "조금만 더 알려주실 수 있을까요?"
        if choices:
            text += "\n\n[CHOICES]\n" + "\n".join(choices) + "\n[/CHOICES]"
        set_speaker(["orchestrator"])
        return text

    # mode == "dispatch"
    steps = result.get("steps") or []
    if not steps:
        # dispatch 인데 step 이 없다 → 의미 없음. 폴백.
        log.info("[planner] account=%s dispatch without steps → fallback", account_id)
        return None

    # capability 유효성 확인
    for s in steps:
        if s["capability"] not in dispatch:
            log.info(
                "[planner] account=%s unknown capability=%s → fallback",
                account_id, s["capability"],
            )
            return None

    # 순차/병렬 실행 — depends_on 있으면 순차, 모두 null 이면 asyncio.gather
    all_independent = all(not s.get("depends_on") for s in steps)

    import inspect

    def _handler_accepts(fn, key: str) -> bool:
        """handler 가 주어진 keyword argument 를 받아주는지 확인.

        명시 파라미터에 `key` 가 있거나, **kwargs 를 받으면 True.
        """
        try:
            sig = inspect.signature(fn)
        except (TypeError, ValueError):
            return False
        for p in sig.parameters.values():
            if p.kind is inspect.Parameter.VAR_KEYWORD:
                return True
            if p.name == key:
                return True
        return False

    async def _run_step(step: dict, preceding: dict[str, str] | None = None) -> tuple[str, str]:
        name = step["capability"]
        args = dict(step.get("args") or {})
        entry = dispatch[name]
        handler = entry["handler"]

        # 관용 키는 handler 가 명시적으로 받을 때만 주입 (TypeError 낭비 방지)
        if brief and _handler_accepts(handler, "_orchestrator_brief"):
            args.setdefault("_orchestrator_brief", brief)
        if preceding and step.get("depends_on") and step["depends_on"] in preceding:
            if _handler_accepts(handler, "_preceding_reply"):
                args.setdefault("_preceding_reply", preceding[step["depends_on"]])

        try:
            # nick_ctx(닉네임 + 프로필 + 넛지) 를 long_term_context 에 이어붙여
            # 도메인 run() 의 system prompt 까지 전달. legacy _call_domain_with_shortcut 과 동일.
            reply = await handler(
                account_id=account_id,
                message=message,
                history=history,
                long_term_context=long_term_context + nick_ctx,
                rag_context=rag_context,
                **args,
            )
        except Exception as exc:
            log.exception("[planner] handler %s crashed", name)
            reply = f"_(도구 '{name}' 실행 중 오류: {str(exc)[:160]})_"
        return (name, reply)

    results_map: dict[str, str] = {}
    if all_independent and len(steps) > 1:
        log.info("[planner] account=%s parallel steps=%s", account_id, [s["capability"] for s in steps])
        pairs = await asyncio.gather(*[_run_step(s) for s in steps])
    else:
        log.info("[planner] account=%s sequential steps=%s", account_id, [s["capability"] for s in steps])
        pairs = []
        for s in steps:
            name, reply = await _run_step(s, preceding=results_map)
            results_map[name] = reply
            pairs.append((name, reply))

    # 합성
    if len(pairs) == 1:
        tool_reply = pairs[0][1]
    else:
        if any(_CHOICES_RE.search(r) for _, r in pairs):
            tool_reply = "\n\n".join(f"### {name}\n{r}" for name, r in pairs)
        else:
            per = {name: r for name, r in pairs}
            tool_reply = await _synthesize_cross_domain(message, per, nick_ctx, account_id)

    tool_reply = _extract_and_save_nickname(account_id, tool_reply)

    # speaker 계산 — 실행된 step 들의 도메인 중복 제거, 순서 유지
    speakers: list[str] = []
    for name, _r in pairs:
        dom = dispatch[name]["domain"]
        if dom not in speakers:
            speakers.append(dom)
    set_speaker(speakers or ["orchestrator"])

    if opening and tool_reply:
        return f"{opening}\n\n{tool_reply}"
    return tool_reply or opening or None




async def _try_choices_shortcut(
    user_msg: str,
    domain_reply: str,
    history: list[dict],
    long_term_context: str,
) -> str | None:
    """reply 에 [CHOICES] 가 있으면 history + 장기기억에서 답을 추정.

    가능하면 보기 중 하나(정확한 문자열)를 반환, 불가하면 None.
    "기타 (직접 입력)" 같은 open-ended 보기는 제외.
    """
    m = _CHOICES_RE.search(domain_reply)
    if not m:
        return None
    choices = [line.strip() for line in m.group(1).strip().splitlines() if line.strip()]
    real_choices = [
        c for c in choices
        if not (c.startswith("기타") or "직접 입력" in c)
    ]
    if not real_choices:
        return None

    context = (
        "아래 대화 히스토리와 장기 기억을 바탕으로, 에이전트가 물은 객관식 질문에 대한 "
        "사용자의 답을 **자신있게** 추정할 수 있는지 판단하라.\n\n"
        f"[사용자 최근 메시지]\n{user_msg}\n\n"
        f"[에이전트 질문 전문]\n{domain_reply}\n\n"
        "[보기 목록]\n" + "\n".join(f"- {c}" for c in real_choices)
    )
    if long_term_context.strip():
        context += f"\n\n[장기 기억]\n{long_term_context}"
    context += (
        "\n\n출력 규칙:\n"
        "- 히스토리·기억에 명확한 근거가 있으면 보기 중 하나를 **정확히 그대로 한 줄로** 출력.\n"
        "- 근거 없거나 애매하면 `UNKNOWN` 만 출력."
    )

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": "너는 히스토리 기반 사용자 의도 추론 모듈. 자신 없으면 UNKNOWN."},
            *history[-6:],
            {"role": "user", "content": context},
        ],
        model=settings.openai_compress_model,
        max_tokens=60,
        temperature=0,
    )
    guess = (resp.choices[0].message.content or "").strip()
    if not guess or guess.upper().startswith("UNKNOWN"):
        return None
    # 보기와 정확히 매칭
    for c in real_choices:
        if c == guess:
            return c
    # 부분 매칭 (LLM 이 부연 붙이는 경우)
    for c in real_choices:
        if guess.startswith(c) or c.startswith(guess):
            return c
    return None


async def _call_domain_with_shortcut(
    domain: str,
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    nick_ctx: str,
) -> str:
    """도메인 에이전트 1회 호출 + [CHOICES] 나오면 추정 시 재호출."""
    agent_fn = _agent_map()[domain]
    log.info("[agent] account=%s domain=%s call=1st", account_id, domain)
    reply = await agent_fn(
        message, account_id, history, rag_context, long_term_context + nick_ctx
    )
    reply = _extract_and_save_nickname(account_id, reply)

    guess = await _try_choices_shortcut(message, reply, history, long_term_context)
    if not guess:
        has_choices = bool(_CHOICES_RE.search(reply))
        log.info(
            "[agent] account=%s domain=%s done=1st choices=%s",
            account_id, domain, has_choices,
        )
        return reply

    # 추정 가능 → 에이전트를 guess 로 재호출하여 CHOICES 없는 최종 응답 받기
    log.info("[agent] account=%s domain=%s call=shortcut guess=%r", account_id, domain, guess)
    shortcut_history = history + [
        {"role": "user", "content": message},
        {"role": "assistant", "content": _CHOICES_RE.sub("", reply).strip()},
    ]
    final = await agent_fn(
        guess, account_id, shortcut_history, rag_context, long_term_context + nick_ctx
    )
    final = _extract_and_save_nickname(account_id, final)
    notice = f"_(대화 맥락으로 **{guess}** 쪽이라고 판단해서 그대로 진행했어요. 다르면 말씀 주세요.)_\n\n"
    return notice + final


async def _synthesize_cross_domain(
    user_msg: str,
    per_domain_replies: dict[str, str],
    nick_ctx: str,
    account_id: str,
) -> str:
    """여러 도메인 응답을 하나의 자연스러운 답변으로 재합성.

    각 응답에서 [ARTIFACT]/[SET_NICKNAME]/[CHOICES] 블록은 도메인 에이전트가 이미 파싱·저장한 상태라
    본문에선 제거한 뒤, 생성된 아티팩트 메타만 따로 요약해 합성 프롬프트에 같이 주입.
    """
    artifact_summaries: list[dict] = []
    clean_map: dict[str, str] = {}
    passthrough_markers: list[str] = []
    for dom, raw in per_domain_replies.items():
        for a in _extract_artifact_summaries(raw):
            artifact_summaries.append({"domain": dom, **a})
        stripped = _strip_inline_blocks(raw)
        # [[TAG]]...[[/TAG]] 마커 수집 후 제거 — LLM 합성 후 재첨부
        markers = _DOUBLE_BRACKET_MARKER_RE.findall(stripped)
        passthrough_markers.extend(markers)
        clean_map[dom] = _DOUBLE_BRACKET_MARKER_RE.sub("", stripped).strip()

    parts = [f"[{dom} 모듈 응답]\n{txt}" for dom, txt in clean_map.items()]
    if artifact_summaries:
        parts.append(
            "[이미 저장된 아티팩트 목록]\n"
            + "\n".join(
                f"- [{a.get('domain')}] {a.get('title') or '(제목 없음)'} ({a.get('type') or 'note'})"
                for a in artifact_summaries
            )
        )
    user_payload = f"사용자 메시지: {user_msg}\n\n" + "\n\n".join(parts)

    system = (
        "너는 BOSS 오케스트레이터. 여러 도메인 담당 모듈이 각자 응답을 내놨으니, "
        "사용자에겐 **하나의 자연스러운 답변**으로 합쳐서 전달한다.\n"
        "- 존댓말 유지, 과장 금지, 사실만.\n"
        "- 도메인별 헤더를 강제하지 말고 사용자 질문 흐름을 따라 묶어서 말한다.\n"
        "- 각 모듈이 만든 아티팩트는 이미 저장됐으니 전체 내용을 그대로 복사하지 말고, "
        "'채용공고 초안은 캔버스에 올려뒀어요' 식으로 짧게 지시.\n"
        "- 핵심 문장·수치는 유지. 없는 사실은 만들지 말 것.\n"
        "- [ARTIFACT]/[CHOICES]/[SET_NICKNAME] 같은 마커는 절대 출력하지 말 것."
    ) + nick_ctx

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_payload},
        ],
        temperature=0.3,
    )
    reply = resp.choices[0].message.content or ""
    if passthrough_markers:
        reply = reply.rstrip() + "\n\n" + "\n\n".join(passthrough_markers)
    return _extract_and_save_nickname(account_id, reply)


async def _extract_date_range(message: str) -> tuple[date, date]:
    """사용자 메시지에서 기간 추출. 실패/미언급이면 오늘±2일 (총 5일)."""
    today = datetime.now(timezone.utc).date()
    default_start = today - timedelta(days=2)
    default_end = today + timedelta(days=2)
    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": (
                    f"오늘은 {today.isoformat()} (UTC).\n"
                    "사용자 메시지에서 기간을 추출해 JSON 한 줄로만 출력.\n"
                    "형식: {\"start\": \"YYYY-MM-DD\", \"end\": \"YYYY-MM-DD\"}\n"
                    "기간이 명시되지 않았으면: {\"default\": true}\n"
                    "상대 표현도 해석 (예: '이번 주' → 오늘 기준 주 시작~끝, '내일까지' → 오늘~내일)."
                )},
                {"role": "user", "content": message},
            ],
            model=settings.openai_compress_model,
            max_tokens=60,
            temperature=0,
        )
        raw = (resp.choices[0].message.content or "").strip()
        # 코드펜스 제거
        raw = re.sub(r"^```(?:json)?|```$", "", raw, flags=re.MULTILINE).strip()
        obj = json.loads(raw)
        if obj.get("default"):
            return default_start, default_end
        s = date.fromisoformat(obj["start"])
        e = date.fromisoformat(obj["end"])
        if s > e:
            s, e = e, s
        return s, e
    except Exception:
        return default_start, default_end


def _gather_plan_facts(account_id: str, start: date, end: date) -> dict:
    """기간 내 activity_logs + 기한 artifact + 예정 schedule 수집."""
    sb = get_supabase()
    start_iso = start.isoformat()
    end_iso = end.isoformat()
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc).isoformat()
    end_dt = datetime.combine(end, datetime.max.time(), tzinfo=timezone.utc).isoformat()

    acts = (
        sb.table("activity_logs")
        .select("type,domain,title,description,metadata,created_at")
        .eq("account_id", account_id)
        .gte("created_at", start_dt)
        .lte("created_at", end_dt)
        .order("created_at", desc=False)
        .limit(300)
        .execute()
        .data
        or []
    )

    arts_raw = (
        sb.table("artifacts")
        .select("id,title,domains,kind,status,metadata")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .in_("status", ["active", "running", "draft"])
        .limit(300)
        .execute()
        .data
        or []
    )
    in_range_arts = []
    for a in arts_raw:
        meta = a.get("metadata") or {}
        for key in ("start_date", "due_date", "end_date"):
            d = meta.get(key)
            if d and start_iso <= d <= end_iso:
                in_range_arts.append({**a, "_which_date": key, "_date": d})
                break

    scheds_raw = (
        sb.table("artifacts")
        .select("id,title,domains,status,metadata")
        .eq("account_id", account_id)
        .eq("kind", "schedule")
        .eq("status", "active")
        .limit(300)
        .execute()
        .data
        or []
    )
    in_range_scheds = []
    for s in scheds_raw:
        meta = s.get("metadata") or {}
        nxt = meta.get("next_run")
        if not nxt:
            continue
        try:
            nxt_d = datetime.fromisoformat(nxt.replace("Z", "+00:00")).date()
        except Exception:
            continue
        if start <= nxt_d <= end:
            in_range_scheds.append({**s, "_next_run": nxt})

    return {"acts": acts, "arts": in_range_arts, "scheds": in_range_scheds}


def _format_plan_facts(facts: dict) -> str:
    lines: list[str] = []
    if facts["acts"]:
        lines.append(f"[기간 내 활동 로그 {len(facts['acts'])}건]")
        for a in facts["acts"][:40]:
            lines.append(
                f"- {a.get('created_at','')[:16]} [{a.get('domain','')}] "
                f"{a.get('type','')}: {a.get('title') or a.get('description') or ''}"
            )
    if facts["arts"]:
        lines.append(f"\n[기간 내 기한 artifact {len(facts['arts'])}건]")
        for a in facts["arts"][:40]:
            doms = ",".join(a.get("domains") or [])
            lines.append(f"- {a['_date']} [{doms}] {a.get('title','')} ({a['_which_date']})")
    if facts["scheds"]:
        lines.append(f"\n[기간 내 예정 schedule {len(facts['scheds'])}건]")
        for s in facts["scheds"][:40]:
            doms = ",".join(s.get("domains") or [])
            lines.append(f"- {s['_next_run'][:16]} [{doms}] {s.get('title','')}")
    if not lines:
        return "(해당 기간에 기록된 활동/일정 없음.)"
    return "\n".join(lines)


async def _handle_planning(
    message: str,
    account_id: str,
    history: list[dict],
    long_term_context: str,
    nick_ctx: str,
) -> str:
    start, end = await _extract_date_range(message)
    facts = _gather_plan_facts(account_id, start, end)

    # 추가: 각 도메인별 오늘 추천도 섞어 plan 에 반영
    from app.agents import recruitment, marketing, sales, documents
    suggest_fns = {
        "recruitment": recruitment.suggest_today,
        "marketing": marketing.suggest_today,
        "sales": sales.suggest_today,
        "documents": documents.suggest_today,
    }
    dom_suggestions: list[str] = []
    for dom, fn in suggest_fns.items():
        try:
            for s in fn(account_id):
                dom_suggestions.append(f"- [{dom}] {s.get('title','')} — {s.get('reason','')}")
        except Exception:
            continue

    body = f"기간: {start.isoformat()} ~ {end.isoformat()}\n\n" + _format_plan_facts(facts)
    if dom_suggestions:
        body += "\n\n[도메인별 오늘 추천 후보]\n" + "\n".join(dom_suggestions[:12])
    if long_term_context.strip():
        body += f"\n\n[사용자 장기 기억 발췌]\n{long_term_context}"

    system = (
        "너는 BOSS 오케스트레이터의 플래닝 모듈.\n"
        "주어진 기간 내 4개 도메인(채용·마케팅·매출·서류) 활동과 일정을 보고, "
        "사용자에게 **기간별 할 일/확인 포인트 플랜**을 자연스러운 한국어로 작성한다.\n"
        "- 정보량이 많으면 일자별 섹션(`### MM-DD (요일)`)으로, 적으면 도메인별로.\n"
        "- 실제 데이터에 없는 항목은 절대 만들어내지 말 것.\n"
        "- 맨 끝에 한 줄로 '가장 먼저 처리할 항목은 X 입니다' 식의 추천 우선순위 1개.\n"
        "- [ARTIFACT]/[CHOICES]/[SET_NICKNAME] 같은 마커는 출력 금지."
    ) + nick_ctx

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history[-6:],
            {"role": "user", "content": body},
        ],
        temperature=0.3,
    )
    reply = resp.choices[0].message.content or ""
    return _extract_and_save_nickname(account_id, reply)


@traceable(name="orchestrator.run", run_type="chain")
async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    nick_ctx = (
        _nickname_context(account_id)
        + _profile_context(account_id)
        + _profile_nudge_context(account_id)
    )

    # 1차 — Planner 주 경로
    try:
        planner_reply = await _dispatch_via_planner(
            account_id, message, history, rag_context, long_term_context, nick_ctx,
        )
    except Exception as exc:
        log.exception("[planner] unexpected crash, falling back: %s", exc)
        planner_reply = None

    if planner_reply is not None:
        return planner_reply

    # 2차 — Legacy 세이프티넷 (classify → domain shortcut)
    from app.agents._speaker_context import set_speaker
    log.info("[route] account=%s branch=legacy_fallback", account_id)
    intents = await classify_intent(message, history)
    log.info(
        "[route] account=%s legacy_intents=%s msg=%r",
        account_id, intents, message[:80],
    )

    if intents == ["refuse"]:
        set_speaker(["orchestrator"])
        return _refusal_message(account_id)

    if intents == ["planning"]:
        set_speaker(["orchestrator"])
        return await _handle_planning(
            message, account_id, history, long_term_context, nick_ctx
        )

    domain_intents = [i for i in intents if i in DOMAINS]

    if len(domain_intents) == 1:
        dom = domain_intents[0]
        log.info("[route] account=%s legacy=single_domain domain=%s", account_id, dom)
        set_speaker([dom])
        return await _call_domain_with_shortcut(
            dom, message, account_id, history, rag_context, long_term_context, nick_ctx,
        )

    if len(domain_intents) >= 2:
        log.info("[route] account=%s legacy=multi_domain domains=%s", account_id, domain_intents)
        per_domain: dict[str, str] = {}
        for dom in domain_intents:
            per_domain[dom] = await _call_domain_with_shortcut(
                dom, message, account_id, history, rag_context, long_term_context, nick_ctx
            )
        set_speaker(list(domain_intents))
        if any(_CHOICES_RE.search(r) for r in per_domain.values()):
            parts = [f"### {dom}\n{txt}" for dom, txt in per_domain.items()]
            return "\n\n".join(parts)
        return await _synthesize_cross_domain(message, per_domain, nick_ctx, account_id)

    # chitchat fallback
    log.info("[route] account=%s legacy=chitchat", account_id)
    set_speaker(["orchestrator"])
    system = SYSTEM_PROMPT + nick_ctx
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"

    resp = await chat_completion(
        messages=[{"role": "system", "content": system}, *history, {"role": "user", "content": message}],
    )
    reply = resp.choices[0].message.content or ""
    return _extract_and_save_nickname(account_id, reply)


BRIEFING_SYSTEM_PROMPT = """당신은 소상공인을 돕는 AI 플랫폼 BOSS의 오케스트레이터입니다.
사용자가 오랜만에 접속했을 때 자리 비운 사이의 활동을 정리하고, 오늘 할 일을 제안하는 **브리핑**을 생성합니다.

출력 규칙:
1. **헤드라인 3줄** — 핵심만. 각 줄은 80자 이내. 이모지 1~2개 허용.
2. 이어서 `---` 한 줄.
3. **상세 섹션** — 아래 3개 하위섹션을 순서대로 마크다운으로. 내용 없으면 섹션 자체 생략.
   - `### 자리 비운 사이` : 자동 실행/알림 요약 (집계 기반 사실만)
   - `### 최근 이어가기` : 장기 기억/최근 활동에서 뽑은 "이전 대화" 재개 포인트
   - `### 오늘 추천` : 도메인 에이전트가 올린 후보를 자연어로 다듬음. 각 항목 맨 앞에 `-` 불릿.
4. 마지막 줄에는 사용자에게 말을 거는 질문 1개 ("뭐부터 시작할까요?" 류).

억양은 편안한 존댓말. 과장·감탄사 자제. 없는 사실을 만들어내지 마세요.
사용자 닉네임이 주어지면 헤드라인 첫 줄에 자연스럽게 호칭(+존칭, 예: "OO 사장님")을 넣어 인사하세요.
닉네임이 없으면 호칭 없이 존댓말로만 시작하고, 본문 어딘가에 "편하게 부를 호칭을 알려주시겠어요?" 한 번 묻되 `[CHOICES]` 블록은 넣지 마세요.
"""


def _briefing_should_fire(
    last_seen_at: datetime | None, failed_count_since: int, now: datetime, threshold_hours: int = 8
) -> bool:
    if last_seen_at is None:
        return True
    if failed_count_since >= 1:
        return True
    return (now - last_seen_at) >= timedelta(hours=threshold_hours)


def _aggregate_activity(account_id: str, since_iso: str) -> dict:
    """지난 접속 이후 activity_logs / task_logs 템플릿 집계."""
    sb = get_supabase()
    acts = (
        sb.table("activity_logs")
        .select("type,domain,title,metadata,created_at")
        .eq("account_id", account_id)
        .gte("created_at", since_iso)
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
        or []
    )
    tasks = (
        sb.table("task_logs")
        .select("status,result,error,executed_at")
        .eq("account_id", account_id)
        .gte("executed_at", since_iso)
        .order("executed_at", desc=True)
        .limit(500)
        .execute()
        .data
        or []
    )

    by_type = Counter(a.get("type") for a in acts)
    by_domain = Counter(a.get("domain") for a in acts if a.get("domain"))
    task_success = sum(1 for t in tasks if t.get("status") == "success")
    task_failed = sum(1 for t in tasks if t.get("status") == "failed")
    failed_samples = [
        {"error": (t.get("error") or "")[:200], "result": t.get("result") or {}}
        for t in tasks
        if t.get("status") == "failed"
    ][:3]

    return {
        "acts": acts,
        "by_type": dict(by_type),
        "by_domain": dict(by_domain),
        "task_success": task_success,
        "task_failed": task_failed,
        "failed_samples": failed_samples,
    }


def _top_domains_last_week(account_id: str, limit: int = 2) -> list[str]:
    sb = get_supabase()
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = (
        sb.table("activity_logs")
        .select("domain,title")
        .eq("account_id", account_id)
        .gte("created_at", since)
        .limit(500)
        .execute()
        .data
        or []
    )
    counter: Counter = Counter()
    titles: dict[str, list[str]] = {}
    for r in rows:
        d = r.get("domain")
        if d not in DOMAINS:
            continue
        counter[d] += 1
        titles.setdefault(d, []).append(r.get("title") or "")
    ranked = [d for d, _ in counter.most_common(limit)]
    return ranked


async def build_briefing(account_id: str, last_seen_at: datetime | None) -> dict:
    """로그인 직후 호출. 조건 만족 시 briefing 페이로드 생성, 불만족이면 None data 반환.

    반환: {
        "should_fire": bool,
        "message": str,            # should_fire=True 일 때만
        "meta": {
            "last_seen_at": iso|None,
            "since_iso": iso,
            "aggregate": {...},
            "suggestions": [...],
            "top_domains": [...],
        }
    }
    """
    now = datetime.now(timezone.utc)
    since = last_seen_at or (now - timedelta(days=7))
    since_iso = since.isoformat()

    # 핵심 4개 필드 누락 시 온보딩 브리핑 즉시 발화 (8h 조건 무시)
    _onboarding_keys = ("display_name", "business_type", "location", "primary_goal")
    _p = get_profile(account_id)
    _missing_onboard = [k for k in _onboarding_keys if not (_p or {}).get(k)]
    if len(_missing_onboard) >= 2:
        _nick = (_p or {}).get("display_name") or "사장님"
        _label_map = {
            "display_name": "호칭(닉네임)",
            "business_type": "업종",
            "location": "지역",
            "primary_goal": "주요 목표",
        }
        _missing_labels = " / ".join(_label_map[k] for k in _missing_onboard)
        _onboard_msg = (
            f"안녕하세요, {_nick}! 저는 BOSS예요.\n\n"
            f"사장님의 회사/가게 운영을 도와드리는 AI 어시스턴트입니다.\n\n"
            f"맞춤 추천과 자동화 품질을 높이려면 간단한 정보가 필요해요.\n\n"
            f"아래 폼을 채워주시면 바로 시작할게요!\n\n"
            "[[ONBOARDING_FORM]]"
        )
        return {
            "should_fire": True,
            "message": _onboard_msg,
            "meta": {"onboarding": True},
        }

    agg = _aggregate_activity(account_id, since_iso)

    if not _briefing_should_fire(last_seen_at, agg["task_failed"], now):
        return {"should_fire": False}

    # 최근 7일 상위 도메인 → 에이전트별 추천 수집
    from app.agents import recruitment, marketing, sales, documents
    agent_suggest = {
        "recruitment": recruitment.suggest_today,
        "marketing": marketing.suggest_today,
        "sales": sales.suggest_today,
        "documents": documents.suggest_today,
    }
    suggestions: list[dict] = []
    for dom in DOMAINS:
        try:
            for s in agent_suggest[dom](account_id):
                suggestions.append({**s, "domain": dom})
        except Exception:
            continue
    # 상위 5개만
    suggestions = suggestions[:5]

    # 상위 도메인 1~2개 기반 장기기억 recall (hybrid_search 1회)
    top_doms = _top_domains_last_week(account_id, limit=2)
    recall_context = ""
    if top_doms:
        # 최근 제목 몇 개 뽑아 쿼리 문장 구성
        recent_titles = [
            a.get("title") or "" for a in agg["acts"]
            if a.get("domain") in top_doms
        ][:5]
        query = f"최근 {', '.join(top_doms)} 관련 진행 중 작업: {'; '.join(recent_titles)}"
        try:
            from app.rag.retriever import hybrid_search
            chunks = await hybrid_search(account_id, query, limit=3)
            if chunks:
                recall_context = "\n".join(f"- {c['content'][:200]}" for c in chunks)
        except Exception:
            pass

    # LLM 한 겹
    nickname = get_nickname(account_id)
    filled_count, missing_keys = _profile_sparseness(account_id)
    profile_ctx = _profile_context(account_id)
    SPARSE_THRESHOLD = 3

    facts_lines = [
        f"- 사용자 닉네임: {nickname if nickname else '(미설정)'}",
        f"- 프로필 채워진 core 필드: {filled_count}/{len(CORE_PROFILE_KEYS)}",
        f"- 지난 접속: {last_seen_at.isoformat() if last_seen_at else '기록 없음'}",
        f"- 지금: {now.isoformat()}",
        f"- 자동 실행 성공: {agg['task_success']}건 / 실패: {agg['task_failed']}건",
        f"- 활동 타입별: {agg['by_type']}",
        f"- 도메인별 활동: {agg['by_domain']}",
    ]
    if profile_ctx:
        facts_lines.append("- 현재 프로필:")
        facts_lines.append(profile_ctx.strip())
    if agg["failed_samples"]:
        facts_lines.append("- 실패 샘플:")
        for f in agg["failed_samples"]:
            facts_lines.append(f"  · {f['error'][:120]}")
    if suggestions:
        facts_lines.append("- 도메인 에이전트 추천:")
        for s in suggestions:
            facts_lines.append(f"  · [{s['domain']}] {s['title']} — {s['reason']}")
    if recall_context:
        facts_lines.append("- 장기 기억 관련 조각:")
        facts_lines.append(recall_context)

    nudge_instruction = ""
    if filled_count < SPARSE_THRESHOLD and missing_keys:
        labels = [PROFILE_LABELS[k] for k in missing_keys[:3]]
        label_a = labels[0]
        label_b = labels[1] if len(labels) > 1 else labels[0]
        nudge_instruction = (
            "\n\n[프로필 보강 넛지 — STRONG]\n"
            f"현재 프로필이 {filled_count}/{len(CORE_PROFILE_KEYS)} 만 채워져 있습니다. 비어있는 핵심 항목: {', '.join(labels)} 등.\n"
            "브리핑 본문 **마지막 블록**에 위 항목 중 **2개**를 한 문단으로 묶어 직접 물어보세요. "
            f"예: '{'(호칭) ' if nickname else ''}제안 정확도를 올리려면 '{label_a}'과 '{label_b}'만 알려주시면 됩니다. "
            f"{label_a}는 어떻게 되세요? 그리고 {label_b}도 알려주세요.' 형태로, 특정 필드명을 찍어서.\n"
            "왜 필요한지 1줄 덧붙이기 (자동 실행·추천 품질이 올라감).\n"
            "두루뭉술한 '조금 더 알려주실 수 있을까요?' 는 금지. 답을 받으면 [SET_PROFILE] 블록으로 저장. "
            "사용자가 '나중에' 처럼 명시적으로 거부하지 않는 한, 매 접속마다 상기시켜도 됩니다."
        )

    user_prompt = (
        "아래 사실만 사용해 브리핑을 작성해주세요.\n\n"
        + "\n".join(facts_lines)
        + nudge_instruction
    )

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": BRIEFING_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
    )
    message = resp.choices[0].message.content or ""
    message = _extract_and_save_nickname(account_id, message)

    return {
        "should_fire": True,
        "message": message,
        "meta": {
            "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
            "since_iso": since_iso,
            "aggregate": {
                "task_success": agg["task_success"],
                "task_failed": agg["task_failed"],
                "by_type": agg["by_type"],
                "by_domain": agg["by_domain"],
            },
            "suggestions": suggestions,
            "top_domains": top_doms,
        },
    }


async def run_scheduled(artifact: dict, account_id: str) -> str:
    """스케줄에 의해 저장된 artifact를 실행. 도메인이 이미 결정돼 있으므로 의도 재분류를 생략.

    cross-domain이면 listed된 모든 도메인 에이전트를 순차 호출해 결과를 병합.
    """
    from app.agents import recruitment, marketing, sales, documents

    agent_map = {
        "recruitment": recruitment.run,
        "marketing": marketing.run,
        "sales": sales.run,
        "documents": documents.run,
    }
    domains = [d for d in (artifact.get("domains") or []) if d in agent_map]
    message = (artifact.get("content") or artifact.get("title") or "").strip()
    if not message:
        return ""

    if not domains:
        return await run(message=message, account_id=account_id, history=[])

    if len(domains) == 1:
        return await agent_map[domains[0]](message, account_id, [], "", "")

    results: list[str] = []
    for d in domains:
        reply = await agent_map[d](message, account_id, [], "", "")
        results.append(f"[{d}]\n{reply}")
    return "\n\n".join(results)
