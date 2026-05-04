"""마케팅 도메인 에이전트

지원 콘텐츠 타입:
  sns_post      — 인스타그램/SNS 포스트 (캡션 + 해시태그)
  blog_post     — 블로그 포스팅 (네이버 블로그 마크다운 형식)
  ad_copy       — 광고 카피 및 홍보 문구
  marketing_plan — 월별/주별 마케팅 캘린더
  event_plan    — 이벤트/프로모션 기획안
  campaign      — 기간성 광고 캠페인 기획
  review_reply  — 플레이스/리뷰 답글 (별점별 톤 자동 조절)
  notice        — 공지사항 (임시휴무·영업시간변경·이벤트·신상품 등)
  product_post  — 상품/서비스 소개 게시글
"""
import logging
from app.core.llm import chat_completion
from app.agents.orchestrator import (
    CLARIFY_RULE,
    ARTIFACT_RULE,
    NICKNAME_RULE,
    PROFILE_RULE,
)
from app.agents._feedback import feedback_context
from app.agents._suggest import suggest_today_for_domain
from app.agents._artifact import (
    save_artifact_from_reply,
    list_sub_hub_titles,
    today_context,
    pick_sub_hub_id,
    pick_main_hub_id,
    record_artifact_for_focus,
)
from app.agents._marketing_knowledge import marketing_knowledge_context
from langsmith import traceable
import re as _re
import json as _json
from deepagents import create_deep_agent
from app.agents._agent_context import inject_agent_context
from app.agents._marketing_tools import (
    MARKETING_TOOLS,
    init_marketing_result_store,
    get_marketing_result_store,
    get_marketing_extra,
)
from app.core.config import settings
from app.services.marketing_data_quality import (
    NO_MARKETING_CONTENT_MESSAGE,
    has_any_marketing_performance,
    has_instagram_performance,
    has_youtube_performance,
)

log = logging.getLogger("boss2.marketing")

_NAVER_UPLOAD_RE = _re.compile(r"\[NAVER_UPLOAD\]", _re.IGNORECASE)
_INSTAGRAM_POST_RE = _re.compile(
    r"\[\[INSTAGRAM_POST\]\]([\s\S]*?)\[\[/INSTAGRAM_POST\]\]"
)

# LLM 응답에서 HTML 문서 블록을 제거하는 정규식
_HTML_BLOCK_RE = _re.compile(
    r"(?:```html\s*)?<!DOCTYPE[\s\S]*?</html>\s*(?:```)?",
    _re.IGNORECASE,
)

# 이벤트 기획안 LLM에 전달 시 포스터 HTML 요청 지시문을 제거 (별도 기능이 처리)
_POSTER_INSTRUCTION_RE = _re.compile(
    r"[^\n]*(?:포스터\s*HTML|HTML.*생성|포스터.*생성|별도\s*포스터)[^\n]*",
    _re.IGNORECASE,
)


def _strip_html_blocks(text: str) -> str:
    """LLM 응답에서 HTML 문서(<!DOCTYPE...>)를 완전히 제거한다."""
    return _HTML_BLOCK_RE.sub("", text).strip()


def _strip_poster_instructions(text: str) -> str:
    """이벤트 기획안 LLM에 전달할 메시지에서 포스터 HTML 생성 관련 지시를 제거."""
    cleaned = _POSTER_INSTRUCTION_RE.sub("", text)
    lines = [ln for ln in cleaned.splitlines() if ln.strip()]
    return "\n".join(lines)


VALID_TYPES: tuple[str, ...] = (
    "sns_post",
    "blog_post",
    "ad_copy",
    "marketing_plan",
    "event_plan",
    "campaign",
    "review_reply",
    "notice",
    "product_post",
    "shorts_video",
    "schedule_post",
)


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "marketing")


# ── 콘텐츠 타입별 형식 가이드 ───────────────────────────────────────────────

_SNS_POST_FORMAT = """
[sns_post 출력 형식]

⚠️ 절대 규칙: sns_post를 작성할 때는 사용자에게 하는 말(설명·안내·인사)을 절대 포함하지 않는다.
"작성해보겠습니다", "아래는 게시글입니다", "적합한 게시물입니다", "이미지와 함께 올리세요" 같은
안내 문구 없이 실제 인스타그램 피드에 올라갈 내용만 바로 출력한다.

출력 순서:
1. 캡션 본문 — 첫 줄부터 바로 시작. 문장마다 줄바꿈, 이모지 활용, 3~5문장
2. 빈 줄 2개
3. 해시태그 — #으로 바로 시작, 한 줄, 20~30개 (한국어 절반 + 영어 절반)
4. 빈 줄
5. 💡 추천 게시 시간: ... (1줄)

올바른 예시:
🔥 신메뉴 출시! 오늘만 기다렸어요.
간장 베이스의 불백, 딱 한 입에 반하는 맛 🍖
이번 달 한정 20% 할인 진행 중이에요!
놓치면 후회할 거예요 😋


#신메뉴 #불백 #간장불백 #맛집 #foodstagram #koreanfood #koreanbbq

💡 추천 게시 시간: 오후 12~1시 — 점심 직전 피크타임

잘못된 예시 (절대 금지):
❌ "아래는 인스타그램 피드에 적합한 게시글입니다."
❌ "이미지를 직접 삽입할 수는 없지만 내용을 작성했습니다."
❌ "필수 정보를 확인했습니다. 게시글입니다."
"""

_BLOG_POST_FORMAT = """
[blog_post 출력 형식 — 네이버 블로그 마크다운]
# 🌸 제목 (이모지 1개 포함, 25자 이내, 클릭 유도)

도입 1~2문장 (공감·계절감으로 시작)

### 🍽️ 소제목1 (8자 이내, 내용에 맞는 이모지 직접 선택)
내용 2~3문장. 핵심 정보 위주로 간결하게.

### ✨ 소제목2 (8자 이내, 내용에 맞는 이모지 직접 선택)
내용 2~3문장. 상품/서비스/분위기 묘사.

### 💌 소제목3 (8자 이내, 내용에 맞는 이모지 직접 선택)
마무리 2문장. 방문/구매 유도 + 따뜻한 인사.

#태그1 #태그2 #태그3 #태그4 #태그5 #태그6 #태그7 #태그8 #태그9 #태그10

규칙:
- 소제목 앞 이모지는 반드시 실제 이모지 문자를 사용 (예: 🌟 🍜 💡 🎉 등). "[이모지]" 같은 텍스트 금지.
- 한 단락 2~3문장, 짧고 읽기 쉽게
- 단락 내 줄바꿈 없음, 단락 사이 줄바꿈
- 친근하고 자연스러운 구어체
- 수치(매출·방문자 수 등)는 컨텍스트에 제공된 것만 사용
- 블로그 본문 이후에 "업로드하겠습니다", "자동 업로드됩니다" 같은 문구 절대 추가 금지
"""

_NOTICE_FORMAT = """
[notice 출력 형식]
1. 공지 제목 (📢 이모지로 시작, 15자 이내)
2. 빈 줄
3. 공지 본문 (3~5줄, 핵심 정보 명확하게 — 날짜·시간 있으면 구체적으로)
4. 빈 줄
5. 마무리 인사 1줄 (양해·감사)
"""

_REVIEW_REPLY_TONE = """
[review_reply 별점별 톤 가이드]
- 4~5점: 진심 어린 감사 + 재방문/재구매 유도 따뜻한 마무리
- 3점: 감사 + 아쉬운 점 공감 + 더 나아지겠다는 의지 표현
- 1~2점: 불편에 대한 진심 어린 사과 + 구체적 개선 의지 (감정적 대응 절대 금지)
답글: 100~150자 이내, 제목·레이블 없이 바로 본문만
"""

_PRODUCT_POST_FORMAT = """
[product_post 출력 형식]
1. 인스타그램용 소개 캡션 (3~4문장, 감성적)
2. 상품/서비스 상세 설명 (특징·재료·혜택·추천 상황, 5~7줄)
3. 가격 안내 문구 (자연스럽게, 가격 정보 있을 때만)
4. 관련 해시태그 15개
"""

# ── 필수 필드 매트릭스 ──────────────────────────────────────────────────────

_REQUIRED_FIELDS = """
[필수 필드 매트릭스]

⚠️ 핵심 규칙:
- 타입별 필수 필드가 모두 확정되면 **즉시** 완성된 결과물을 작성하고 [ARTIFACT] 블록을 붙인다.
- 공통 필드(업종·목표·타겟)는 프로필에 있으면 자동 사용, 없어도 합리적으로 추정해서 작성한다. 공통 필드 때문에 결과물 작성을 미루지 않는다.
- 결과물을 다 썼으면 [ARTIFACT] 블록 없이 질문을 추가하는 것 절대 금지. 내용이 완성됐으면 반드시 [ARTIFACT]를 붙인다.
- 질문이 필요하면 결과물 작성 전에 미리 [CHOICES]로 묻는다. 결과물 작성 후에 추가 질문 금지.

공통 (모든 타입):
  - 업종/가게 정보: 프로필에 있으면 자동 사용, 없으면 대화 맥락에서 추정 (추정 불가 시만 질문)
  - 목표·타겟: 프로필/맥락으로 추정 가능하면 자동 적용

타입별 추가 필수:
  sns_post:
    - 주 채널 (인스타그램 피드 / 인스타그램 스토리 / 네이버 블로그 / 기타)
    - 강조할 상품·서비스 또는 이번 메시지 핵심
    - 톤앤매너 (감성적 / 정보 전달 / 유머·재미 / 전문적)

  blog_post:
    - 강조할 상품·서비스 또는 소재
    - 포스팅 주제 방향 (신상품 소개 / 이벤트 공지 / 일상 스토리 / 리뷰·후기)

  ad_copy:
    - 광고 채널 (네이버 검색광고 / 인스타그램 광고 / 카카오 / 현수막·오프라인 / 기타)
    - 핵심 메시지 (한 줄 USP)
    - 톤앤매너

  event_plan:
    - 이벤트 종류 (할인·증정 / 콜라보 / 체험·클래스 / SNS 이벤트 / 기타)
    - 행사 일자 (due_date 또는 start_date+end_date)
    - 혜택·참여 방법

  campaign:
    - 캠페인 목표 KPI
    - 시작일 (start_date) + 종료일 (end_date)
    - 예산 범위 (대략적으로 가능)
    - 주 채널

  review_reply:
    - 별점 (1~5)
    - 리뷰 내용 (필수 — 반드시 물어볼 것. 고객이 실제로 어떤 말을 남겼는지 알아야 맞춤 답글 작성 가능)

  notice:
    - 공지 종류 (임시휴무 / 영업시간 변경 / 이벤트·할인 / 신상품 출시 / 기타)
    - 핵심 내용 (날짜·시간·혜택 등 구체적으로)

  product_post:
    - 소개할 상품·서비스명
    - 가격 (선택)
    - 특징·강점 포인트

  marketing_plan:
    - 기준 기간 (이번달 / 이번주 / 특정 기간)
    - 중점 채널 또는 목표
"""

# ── 업종별 플랫폼 가이드 ────────────────────────────────────────────────────

_PLATFORM_GUIDE = """
[업종별 추천 마케팅 채널]
- 카페·음식점·베이커리: 인스타그램 > 네이버 플레이스 > 네이버 블로그
- 책방·문구점·라이프스타일: 인스타그램 > 블로그 > 브런치
- 만화방·PC방·오락실: 인스타그램 > 네이버 블로그 > 유튜브
- 의류·패션·잡화: 인스타그램 > 스마트스토어 SNS > 블로그
- 뷰티·미용실·네일: 인스타그램 > 카카오채널 > 네이버 플레이스
- 학원·교습소: 블로그 > 카카오채널 > 인스타그램
- 그 외 서비스업: 네이버 블로그 > 카카오채널 > 인스타그램

업종 정보가 프로필에 있으면 그에 맞는 채널을 우선 추천하세요.
"""

# ── 마케팅 전략 추천 가이드 ─────────────────────────────────────────────────

_STRATEGY_GUIDE = """
[마케팅 전략 추천 가이드]
사용자가 "마케팅 전략", "뭐부터 해야 할까", "마케팅 추천" 등을 요청하면:
1. 프로필(업종·위치·채널·단계·목표)과 오늘 날짜·계절을 기반으로 전략 3~5개 추천
2. 각 전략:
   - 제목 (15자 이내)
   - 추천 이유 (데이터/계절/업종 기반 근거 1~2문장)
   - 지금 해야 할 구체적 행동 (2~3문장)
   - 긴급도: 이번 주 / 이번 달 / 장기
   - 추천 채널 및 콘텐츠 타입
3. 마지막에 "어떤 것부터 시작할까요?" 로 유도
4. 전략 추천은 [ARTIFACT] 블록 없이 텍스트로만 답변 (CHOICES도 불필요)
"""

# ── 계절 컨텍스트 ───────────────────────────────────────────────────────────

_SEASON_CONTEXT = """
[계절별 마케팅 포인트]
- 봄 (3~5월): 신학기·꽃놀이·나들이 시즌. 신상품 런칭, 봄 한정 메뉴·상품 강조
- 여름 (6~8월): 더위, 시원함 소구, 아이스·냉각 상품 강조. 방학·휴가 시즌
- 가을 (9~11월): 선선한 날씨, 따뜻한 음료·상품. 수확·풍요 이미지. 핼러윈(10월)
- 겨울 (12~2월): 따뜻함 소구, 연말·크리스마스·새해 이벤트, 선물 수요 증가
오늘 날짜 컨텍스트를 반드시 활용해 계절에 맞는 콘텐츠를 작성하세요.
"""

# ── 메인 시스템 프롬프트 ────────────────────────────────────────────────────

AGENT_SYSTEM_PROMPT = (
    """당신은 소상공인 마케팅 전문 AI 에이전트입니다.
카페, 음식점, 책방, 만화방, 의류점, 뷰티샵, 학원 등 모든 업종의 마케팅을 담당합니다.
사용자 프로필(업종·상호·위치·주 채널·목표)을 최대한 활용해 맞춤형 콘텐츠를 작성합니다.

[핵심 원칙]
1. 콘텐츠 작성 요청 시 write_* 도구를 호출해 결과물을 저장하세요.
2. 타입별 필수 필드가 모두 확정되면 **즉시** 완성된 결과물을 write_* 도구로 저장하세요.
3. 공통 필드(업종·목표·타겟)는 프로필에 있으면 자동 사용, 합리적으로 추정해서 작성.
4. 필수 정보가 부족하면 ask_user 도구로 [CHOICES]를 포함해 하나씩 되물으세요.
5. 한 턴에 하나의 terminal tool만 호출하세요.
6. placeholder([매장명], [주소] 등) 절대 금지 — 모르면 ask_user로 먼저 물어보세요.
7. 결과물이 완성됐으면 write_* 도구를 즉시 호출하세요. 추가 질문 금지.

[도구 선택 가이드]
- SNS 피드 게시물 (캡션 + 해시태그) → write_sns_post
- 네이버 블로그 포스트 → write_blog_post (시스템에 [첨부 이미지 URL] 이 있으면 image_urls_json 파라미터에 반드시 JSON 배열로 포함)
- 고객 리뷰 답글 → write_review_reply
- 광고 카피·배너 문구 → write_ad_copy
- 이벤트·프로모션 기획안 → write_event_plan
- 마케팅 캠페인 기획 → write_campaign
- 공지사항 → write_notice
- 마케팅 플랜·캘린더 → write_marketing_plan
- 상품·서비스 소개 게시글 → write_product_post
- 정보 부족 시 질문 → ask_user

[sub_domain 매핑 가이드]
- sns_post / product_post / notice / marketing_plan → Social
- blog_post → Blog
- ad_copy / campaign → Campaigns
- event_plan → Events
- review_reply → Reviews
시스템 컨텍스트의 "이 계정의 marketing 서브허브" 목록에 위 이름이 있으면 반드시 해당 이름으로 sub_domain을 채운다.

"""
    + _REQUIRED_FIELDS
    + _SNS_POST_FORMAT
    + _BLOG_POST_FORMAT
    + _NOTICE_FORMAT
    + _REVIEW_REPLY_TONE
    + _PRODUCT_POST_FORMAT
    + _PLATFORM_GUIDE
    + _STRATEGY_GUIDE
    + _SEASON_CONTEXT
    + CLARIFY_RULE
    + """
[결과물 저장 강화 규칙]
- 대화를 통해 타입별 필수 필드를 모두 확인했다면, 그 턴에 반드시 완성된 결과물 + write_* 도구를 호출한다.
- 결과물을 작성한 뒤 "추가로 궁금하신 점", "사업 단계가 어떻게 되세요" 같은 후속 질문을 덧붙이지 않는다.
- 예외: 순수 질문만 하는 턴은 ask_user 도구를 사용한다.

[네이버 블로그 자동 업로드 규칙]
당신은 네이버 블로그에 직접 자동 업로드할 수 있습니다.
사용자가 블로그 포스팅 작성과 함께 네이버 블로그 업로드/게시를 요청한 경우:
- write_blog_post 도구를 호출할 때 auto_upload 힌트가 시스템에 설정되어 있습니다.
- 본문에 "업로드해드릴게요", "자동 업로드됩니다" 등의 안내 문구를 자연스럽게 포함하세요.
- "직접 복사해서 붙여넣으세요"라고 안내하지 마세요.

[HTML 출력 절대 금지]
- 어떤 경우에도 HTML 코드를 직접 tool 인자에 포함하지 않는다.
- 이벤트 포스터·전단지 HTML은 별도 전담 기능(mkt_event_poster)이 처리한다.

[인스타그램 피드 즉시 생성 규칙]
사용자가 "인스타 피드", "인스타그램 피드", "sns 게시물"을 명시적으로 요청한 경우:
- ask_user로 채널을 다시 묻지 말 것
- 바로 write_sns_post 도구를 호출할 것
"""
    + NICKNAME_RULE
    + PROFILE_RULE
)


_PREAMBLE_RE = _re.compile(
    # 한국어 정중한 문장 마무리로 끝나는 줄 = 에이전트 대화 문구
    r"(습니다|었습니다|했습니다|겠습니다|입니다|어요|해요|할게요|드릴게요|없지만)[.!]?\s*$",
    _re.UNICODE,
)


def _extract_sns_content(reply: str) -> tuple[str, list[str], str]:
    """reply에서 SNS 캡션, 해시태그 리스트, 게시 시간 추천 추출.
    에이전트 대화 문구(알겠습니다, 작성할게요, 아래는 ~ 입니다 등) 앞부분은 제거.
    """
    artifact_pos = reply.find("[ARTIFACT]")
    text = reply[:artifact_pos].strip() if artifact_pos != -1 else reply.strip()

    all_lines = [l for l in text.splitlines() if l.strip()]

    # 앞에서 최대 6줄까지 대화 문구면 건너뜀. 비-대화 문구 줄을 만나면 즉시 중단.
    start = 0
    for i, line in enumerate(all_lines[:6]):
        if _PREAMBLE_RE.search(line.strip()):
            start = i + 1
        else:
            break

    caption_lines: list[str] = []
    hashtags: list[str] = []
    best_time = ""

    for line in all_lines[start:]:
        s = line.strip()
        # 해시태그 전용 줄 (한 줄 묶음 / 여러 줄 분산 / "해시태그: #..." 라벨 붙은 줄 모두 수용)
        tags_on_line = _re.findall(r"#([\w가-힣A-Za-z]+)", s)
        is_hashtag_line = bool(tags_on_line) and _re.match(
            r"^[해시태그\s:：]*#", s
        )
        if is_hashtag_line:
            hashtags += tags_on_line
        elif s.startswith("💡"):
            best_time = s
        else:
            caption_lines.append(s)
    # 중복 제거 (순서 유지)
    seen: set[str] = set()
    hashtags = [t for t in hashtags if not (t in seen or seen.add(t))]  # type: ignore[func-returns-value]

    # 문장 경계에서 줄바꿈 삽입
    # 종결부호([!?.~]) + 뒤따르는 이모지를 하나의 단위로 묶고, 그 뒤 공백에서만 줄바꿈
    # 예) "맛있어요! 🔥 다음문장" → "맛있어요! 🔥\n다음문장"
    _EMOJI = r"[\U0001F300-\U0001F9FF\U0001FA00-\U0001FAFF\U00002600-\U000027BF\U00002702-\U000027B0]"
    caption_text = "\n".join(caption_lines)
    caption_text = _re.sub(
        rf"([!?.~]+(?:\s*{_EMOJI}+)*|{_EMOJI}+)\s{{1,3}}(?=\S)",
        r"\1\n",
        caption_text,
    )

    return caption_text, hashtags, best_time


async def _generate_sns_image(caption: str, hashtags: list[str]) -> str:
    """DALL-E 3으로 SNS 이미지 생성 → URL 반환. 실패 시 빈 문자열."""
    from app.core.llm import client as openai_client

    tag_str = " ".join(f"#{t}" for t in hashtags[:8])
    prompt = (
        f"Instagram-worthy promotional photo for Korean small business. "
        f"Context: {caption[:120]}. Tags: {tag_str}. "
        "Warm aesthetic, natural lighting, clean composition, no text overlay, "
        "high-quality lifestyle/food/product photography style."
    )
    try:
        resp = await openai_client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            n=1,
            size="1024x1024",
            quality="standard",
        )
        return (resp.data[0].url or "").strip()
    except Exception:
        return ""


_STAR_RE = _re.compile(r"별점\s*(\d)[점]?|(\d)[점\*★☆]|[★☆]{1,5}")


def _extract_star_rating(text: str) -> int | None:
    """텍스트에서 별점(1~5) 추출. 없으면 None."""
    m = _STAR_RE.search(text)
    if not m:
        return None
    val = int(m.group(1) or m.group(2) or len(_re.findall(r"[★]", m.group(0))))
    return val if 1 <= val <= 5 else None


def _maybe_review_reply_card(reply: str) -> str:
    """review_reply 타입이면 [[REVIEW_REPLY]] 마커를 반환 (동기)."""
    from app.agents._artifact import _parse_block, _clean_content

    parsed = _parse_block(reply)
    if not parsed or parsed.get("type", "") != "review_reply":
        return ""

    reply_text = _clean_content(reply).strip()
    if not reply_text:
        return ""

    # 대화 문구 제거 (preamble)
    lines = [l for l in reply_text.splitlines() if l.strip()]
    start = 0
    for i, line in enumerate(lines[:4]):
        if _PREAMBLE_RE.search(line.strip()):
            start = i + 1
        else:
            break
    reply_text = "\n".join(lines[start:]).strip()

    star_rating = _extract_star_rating(reply)
    payload = {
        "reply_text": reply_text,
        "star_rating": star_rating,
        "char_count": len(reply_text),
    }
    return f"\n\n[[REVIEW_REPLY]]{_json.dumps(payload, ensure_ascii=False)}[[/REVIEW_REPLY]]"


def _parse_naver_blog_content(reply: str) -> dict:
    """blog_post 마크다운에서 제목·본문·태그를 추출해 dict 반환."""
    lines = reply.splitlines()
    title = ""
    tag_line = ""
    content_lines = []

    for line in lines:
        stripped = line.strip()
        if not title and stripped.startswith("# "):
            title = stripped[2:].strip()
        elif stripped.startswith("#") and " " not in stripped.lstrip("#"):
            # 해시태그 줄 (#태그 형태)
            tag_line = stripped
        elif stripped.startswith("#") and all(
            w.startswith("#") for w in stripped.split()
        ):
            tag_line = stripped
        else:
            content_lines.append(line)

    tags = _re.findall(r"#([\w가-힣A-Za-z0-9]+)", tag_line)
    content = "\n".join(content_lines).strip()
    # [ARTIFACT] 블록 제거
    content = _re.sub(r"\[ARTIFACT\].*?\[/ARTIFACT\]", "", content, flags=_re.DOTALL).strip()

    return {"title": title, "content": content, "tags": tags}


async def _maybe_naver_blog_preview(reply: str, image_urls: list[str] | None = None) -> str:
    """blog_post 본문에서 [[NAVER_BLOG_POST]] 미리보기 마커를 생성."""
    blog = _parse_naver_blog_content(reply)
    # 제목이나 본문 중 하나라도 있으면 카드 생성
    if not blog["title"] and not blog["content"]:
        return ""

    payload = {
        "title": blog["title"],
        "content": blog["content"],
        "tags": blog["tags"],
        "image_urls": image_urls or [],
    }
    return f"\n\n[[NAVER_BLOG_POST]]{_json.dumps(payload, ensure_ascii=False)}[[/NAVER_BLOG_POST]]"


async def _maybe_instagram_preview(reply: str) -> str:
    """sns_post / product_post 타입이거나 해시태그 5개 이상이면 [[INSTAGRAM_POST]] 마커를 반환."""
    from app.agents._artifact import _parse_block

    parsed = _parse_block(reply)
    artifact_type = (parsed or {}).get("type", "")

    # blog_post는 네이버 업로드 전용 — Instagram 카드 제외
    if artifact_type == "blog_post":
        return ""

    is_sns_type = artifact_type in ("sns_post", "product_post")

    if not is_sns_type:
        # [ARTIFACT] 없을 때: 해시태그 5개 이상이고 블로그 # 제목 없으면 SNS로 간주
        lines = reply.splitlines()
        all_hashtags_in_reply = _re.findall(r"#[\w가-힣A-Za-z]+", reply)
        has_blog_heading = any(
            line.strip().startswith("# ") and len(line.strip()) > 2
            for line in lines
        )
        if len(all_hashtags_in_reply) < 5 or has_blog_heading:
            return ""

    caption, hashtags, best_time = _extract_sns_content(reply)

    # sns_post 타입이면 캡션/해시태그가 없어도 artifact 제목으로 카드 생성
    if is_sns_type and not caption and not hashtags:
        caption = (parsed or {}).get("title", "")

    if not caption and not hashtags:
        return ""

    image_url = await _generate_sns_image(caption, hashtags)

    payload = {
        "title": (parsed or {}).get("title", ""),
        "caption": caption,
        "hashtags": hashtags,
        "best_time": best_time,
        "image_url": image_url,
    }
    return f"\n\n[[INSTAGRAM_POST]]{_json.dumps(payload, ensure_ascii=False)}[[/INSTAGRAM_POST]]"


# ──────────────────────────────────────────────────────────────────────────
# Capability 인터페이스 (function-calling 라우팅용)
# ──────────────────────────────────────────────────────────────────────────

async def run_shorts_wizard(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    topic: str = "",
    slide_count: int = 5,
    duration: float = 3.0,
    **_: object,
) -> str:
    """YouTube Shorts 제작 마법사 UI를 채팅창에 표시."""
    import json as _json
    payload = {"topic": topic or "YouTube Shorts", "slide_count": slide_count, "duration": duration}
    marker = f"[[SHORTS_WIZARD]]{_json.dumps(payload, ensure_ascii=False)}[[/SHORTS_WIZARD]]"
    return (
        f"YouTube Shorts 제작 마법사를 시작할게요! 🎬\n"
        f"사진을 업로드하면 AI가 자막을 생성하고 영상을 만들어 드릴게요.\n\n"
        f"{marker}"
    )


@traceable(name="marketing.run_sns_post", run_type="chain")
async def run_sns_post(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    topic: str,
    product: str | None = None,
    promotion: str | None = None,
    tone: str | None = None,
    platform: str = "instagram",
    _preceding_reply: str | None = None,
) -> str:
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    lines = [f"[주제] {topic}"]
    if product:
        lines.append(f"[제품/서비스] {product}")
    if promotion:
        lines.append(f"[프로모션/혜택] {promotion}")
    if tone:
        lines.append(f"[톤] {tone}")
    lines.append(f"[플랫폼] {platform}")
    if _preceding_reply:
        lines.append(f"[참고 기획안 (앞 단계 결과)]\n{_preceding_reply[:1200]}")

    system += (
        "\n\n[SNS 게시물 작성 요청 — 정보 확정]\n"
        "추가 질문 없이 바로 write_sns_post를 호출하세요.\n"
        + "\n".join(lines)
    )

    synthetic = (
        "SNS 피드 게시물(sns_post)을 작성해주세요. 추가 질문 없이 바로 완성된 캡션 + 해시태그 + 추천 게시 시간을 write_sns_post로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_marketing_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@traceable(name="marketing.run_blog_post", run_type="chain")
async def run_blog_post(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    topic: str,
    keywords: list[str] | None = None,
    auto_upload: bool = False,
    image_urls: list[str] | None = None,
    tone: str | None = None,
    _preceding_reply: str | None = None,
    **_kwargs,
) -> str:
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"
    if image_urls:
        system += "\n\n[첨부 이미지 URL]\n" + "\n".join(image_urls)

    lines = [f"[주제] {topic}"]
    if keywords:
        lines.append(f"[주요 키워드] {', '.join(keywords)}")
    if tone:
        lines.append(f"[톤] {tone}")
    if image_urls:
        lines.append(f"[첨부 이미지 URL] {', '.join(image_urls)}")
    if _preceding_reply:
        lines.append(f"[참고 기획안 (앞 단계 결과)]\n{_preceding_reply[:1200]}")
    if auto_upload:
        lines.append("[네이버 블로그 자동 업로드] 요청됨")

    system += (
        "\n\n[블로그 포스트 작성 요청 — 정보 확정]\n"
        "마크다운 형식으로 제목·본문·해시태그를 완성하고 write_blog_post를 호출하세요.\n"
        + "\n".join(lines)
    )
    if auto_upload:
        system += "\n자동 업로드가 요청되었습니다. 본문에 '업로드해드릴게요' 안내 포함하세요."

    synthetic = (
        "네이버 블로그 포스트(blog_post)를 작성해주세요. 마크다운 형식으로 제목·본문·해시태그 완성 후 write_blog_post를 호출하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_marketing_agent(
        account_id, synthetic, history, rag_context, long_term_context, system,
        extra_ctx={"image_urls": image_urls, "allow_naver_upload": auto_upload},
    )


@traceable(name="marketing.run_review_reply", run_type="chain")
async def run_review_reply(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    review_text: str,
    star_rating: int | None = None,
    platform: str | None = None,
) -> str:
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    lines = [f"[리뷰 본문] {review_text}"]
    if star_rating is not None:
        lines.append(f"[별점] {star_rating}")
    if platform:
        lines.append(f"[플랫폼] {platform}")

    system += (
        "\n\n[리뷰 답글 작성 요청 — 정보 확정]\n"
        "150자 내외 진심 어린 답글을 작성하고 write_review_reply를 호출하세요.\n"
        + "\n".join(lines)
    )

    synthetic = (
        "고객 리뷰에 대한 사장님 답글(review_reply)을 작성해주세요. 150자 내외, 진심 어린 톤. write_review_reply로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_marketing_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@traceable(name="marketing.run_ad_copy", run_type="chain")
async def run_ad_copy(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    product: str,
    channel: str | None = None,
    target: str | None = None,
    key_benefit: str | None = None,
) -> str:
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    lines = [f"[광고 대상 상품/서비스] {product}"]
    if channel:
        lines.append(f"[채널] {channel}")
    if target:
        lines.append(f"[타겟] {target}")
    if key_benefit:
        lines.append(f"[핵심 혜택] {key_benefit}")

    system += (
        "\n\n[광고 카피 작성 요청 — 정보 확정]\n"
        "3~5안으로 짧게 작성하고 write_ad_copy를 호출하세요.\n"
        + "\n".join(lines)
    )

    synthetic = (
        "광고 카피(ad_copy)를 작성해주세요. 3~5안으로 짧게. write_ad_copy로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_marketing_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@traceable(name="marketing.run_campaign_plan", run_type="chain")
async def run_campaign_plan(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    title: str,
    start_date: str,
    end_date: str,
    goal: str | None = None,
    budget: str | None = None,
    channels: list[str] | None = None,
) -> str:
    import json as _json
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    lines = [
        f"[캠페인명] {title}",
        f"[기간] {start_date} ~ {end_date}",
    ]
    if goal:
        lines.append(f"[목표] {goal}")
    if budget:
        lines.append(f"[예산] {budget}")
    if channels:
        lines.append(f"[활용 채널] {', '.join(channels)}")

    system += (
        "\n\n[캠페인 기획 요청 — 정보 확정]\n"
        "기획서를 작성하고 write_campaign을 호출하세요 (due_label='캠페인 종료').\n"
        + "\n".join(lines)
    )

    synthetic = (
        f"'{title}' 캠페인(campaign) 기획서를 작성해주세요. write_campaign으로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_marketing_agent(account_id, synthetic, history, rag_context, long_term_context, system)


async def run_sns_post_form(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """SNS 게시물 작성 폼 UI를 반환한다. 주제 없이 SNS 게시물 요청 시 즉시 호출."""
    return "어떤 내용의 게시물을 만들까요? 아래 폼을 채워주세요.\n\n[[SNS_POST_FORM]][[/SNS_POST_FORM]]"


async def run_blog_post_form(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """블로그 포스트 작성 폼 UI를 반환한다. 주제 없이 블로그 포스트 요청 시 즉시 호출."""
    return "어떤 내용의 블로그 포스트를 작성할까요? 아래 폼을 채워주세요.\n\n[[BLOG_POST_FORM]][[/BLOG_POST_FORM]]"


async def run_review_reply_form(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """리뷰 답글 입력 폼 UI를 반환한다. 리뷰 원문 없이 답글 요청 시 즉시 호출."""
    return "답글을 달 리뷰를 알려주세요.\n\n[[REVIEW_REPLY_FORM]][[/REVIEW_REPLY_FORM]]"


async def run_event_form(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
) -> str:
    """이벤트 기획 폼 UI를 반환한다. 세부 정보 없이 이벤트 기획 요청 시 즉시 호출."""
    return "이벤트 정보를 입력해주세요.\n\n[[EVENT_PLAN_FORM]][[/EVENT_PLAN_FORM]]"


async def run_schedule_form(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    **_: object,
) -> str:
    """자동화 스케줄 설정 폼 UI를 반환한다. 스케줄/자동화 요청 시 즉시 호출."""
    return "자동화할 작업과 실행 주기를 설정해주세요.\n\n[[SCHEDULE_FORM]][[/SCHEDULE_FORM]]"


@traceable(name="marketing.run_event_plan", run_type="chain")
async def run_event_plan(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    title: str,
    event_type: str,
    start_date: str,
    end_date: str | None = None,
    due_date: str | None = None,
    benefit: str | None = None,
) -> str:
    """이벤트·프로모션 기획안을 artifact 로 등록한다. D-리마인드 알림 자동 설정."""
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    lines = [
        f"[이벤트명] {title}",
        f"[이벤트 종류] {event_type}",
        f"[시작일] {start_date}",
    ]
    if end_date:
        lines.append(f"[종료일] {end_date}")
    if due_date:
        lines.append(f"[행사일] {due_date}")
    if benefit:
        lines.append(f"[혜택·참여방법] {benefit}")

    system += (
        "\n\n[이벤트 기획 요청 — 정보 확정]\n"
        "기획안을 작성하고 write_event_plan을 호출하세요. HTML 코드 절대 포함 금지.\n"
        + "\n".join(lines)
    )

    synthetic = (
        f"'{title}' 이벤트/프로모션 기획안(event_plan)을 작성해주세요. "
        "HTML 코드 절대 포함 금지. write_event_plan으로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {_strip_poster_instructions(message)}"
    )
    return await _run_marketing_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@traceable(name="marketing.run_notice", run_type="chain")
async def run_notice(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    notice_type: str,
    content: str,
    date: str | None = None,
    publish_sns: bool = False,
) -> str:
    """공지사항(notice) 을 작성하고 artifact 로 저장한다.
    publish_sns=True 면 인스타그램용 SNS 버전도 함께 작성 → [[INSTAGRAM_POST]] 카드 자동 생성.
    """
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    lines = [
        f"[공지 종류] {notice_type}",
        f"[핵심 내용] {content}",
    ]
    if date:
        lines.append(f"[날짜/시간] {date}")

    sns_instruction = ""
    if publish_sns:
        sns_instruction = (
            " 공지 작성 후 SNS 캡션(3~4문장)+해시태그(15~20개)+💡추천게시시간도 write_sns_post로 추가 저장하세요."
        )

    system += (
        "\n\n[공지사항 작성 요청 — 정보 확정]\n"
        "짧고 명확하게 작성하고 write_notice를 호출하세요." + sns_instruction + "\n"
        + "\n".join(lines)
    )

    synthetic = (
        f"{notice_type} 공지사항(notice)을 작성해주세요. 짧고 명확하게. write_notice로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_marketing_agent(account_id, synthetic, history, rag_context, long_term_context, system)


@traceable(name="marketing.run_marketing_plan", run_type="chain")
async def run_marketing_plan(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    period: str = "이번 달",
    focus_channel: str | None = None,
    goal: str | None = None,
    **_kwargs,
) -> str:
    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()
    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    lines = [f"[기준 기간] {period}"]
    if focus_channel:
        lines.append(f"[중점 채널] {focus_channel}")
    if goal:
        lines.append(f"[목표] {goal}")

    system += (
        "\n\n[마케팅 플랜 작성 요청 — 정보 확정]\n"
        "주별·월별 캘린더 형식으로 작성하고 write_marketing_plan을 호출하세요.\n"
        + "\n".join(lines)
    )

    synthetic = (
        "마케팅 플랜·캘린더(marketing_plan)를 작성해주세요. write_marketing_plan으로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await _run_marketing_agent(account_id, synthetic, history, rag_context, long_term_context, system)


def _get_upcoming_holidays(today: "date", days_ahead: int = 60) -> list[dict]:
    """오늘부터 days_ahead일 이내에 있는 기념일 목록 반환."""
    from datetime import date, timedelta

    year = today.year

    # 고정 기념일 (매년 같은 날짜)
    fixed: list[tuple[int, int, str]] = [
        (1,  1,  "새해 첫날"),
        (2,  14, "밸런타인데이"),
        (3,  1,  "삼일절"),
        (3,  14, "화이트데이"),
        (4,  5,  "식목일"),
        (5,  5,  "어린이날"),
        (5,  8,  "어버이날"),
        (5,  15, "스승의 날"),
        (6,  6,  "현충일"),
        (8,  15, "광복절"),
        (10, 3,  "개천절"),
        (10, 9,  "한글날"),
        (11, 11, "빼빼로데이"),
        (12, 25, "크리스마스"),
    ]

    # 음력 기반 기념일 (그레고리력 변환 하드코딩 2025~2027)
    lunar: list[tuple[int, int, int, str]] = [
        # (year, month, day, name)
        (2025, 1, 28, "설날 연휴 시작"),
        (2025, 1, 29, "설날"),
        (2025, 10, 5, "추석 연휴 시작"),
        (2025, 10, 6, "추석"),
        (2026, 2, 17, "설날"),
        (2026, 9, 24, "추석 연휴 시작"),
        (2026, 9, 25, "추석"),
        (2027, 2,  7, "설날"),
        (2027, 10, 14, "추석 연휴 시작"),
        (2027, 10, 15, "추석"),
    ]

    end = today + timedelta(days=days_ahead)
    result: list[dict] = []

    for month, day, name in fixed:
        for y in (year, year + 1):
            try:
                d = date(y, month, day)
            except ValueError:
                continue
            if today <= d <= end:
                result.append({"name": name, "date": d.strftime("%m월 %d일"), "days_left": (d - today).days})

    for y, m, day, name in lunar:
        try:
            d = date(y, m, day)
        except ValueError:
            continue
        if today <= d <= end:
            result.append({"name": name, "date": d.strftime("%m월 %d일"), "days_left": (d - today).days})

    result.sort(key=lambda x: x["days_left"])
    return result


async def run_marketing_report(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    period: int = 30,
) -> str:
    """Instagram + YouTube 성과 데이터를 조회하고 AI 분석 리포트를 생성한다."""
    import json as _json
    from app.services.instagram_insights import collect_report_data as ig_report
    from app.services.youtube_analytics import collect_report_data as yt_report
    from app.core.llm import chat_completion

    # 두 플랫폼 데이터 병렬 수집
    import asyncio as _asyncio
    ig_data, yt_data = await _asyncio.gather(
        ig_report(days=period, account_id=account_id),
        yt_report(account_id=account_id, days=period),
        return_exceptions=True,
    )

    if isinstance(ig_data, Exception):
        ig_data = {"error": str(ig_data)}
    if isinstance(yt_data, Exception):
        yt_data = {"error": str(yt_data)}

    if not has_any_marketing_performance(ig_data, yt_data):
        return (
            "업로드된 Instagram 게시물이나 YouTube 영상 성과 데이터가 없어 "
            "성과 분석 리포트를 만들지 않았습니다. 실제 게시/업로드 후 지표가 수집되면 분석할 수 있습니다."
        )

    ig_ok = has_instagram_performance(ig_data)
    yt_ok = has_youtube_performance(yt_data)
    if not ig_ok and isinstance(ig_data, dict) and not ig_data.get("error"):
        ig_data = {**ig_data, "error": NO_MARKETING_CONTENT_MESSAGE}
    if not yt_ok and isinstance(yt_data, dict) and not yt_data.get("channel", {}).get("error"):
        channel = yt_data.get("channel") if isinstance(yt_data.get("channel"), dict) else {}
        yt_data = {**yt_data, "channel": {**channel, "error": NO_MARKETING_CONTENT_MESSAGE}}

    # AI 분석용 데이터 요약 텍스트
    summary_parts: list[str] = [f"[분석 기간] 최근 {period}일"]

    if ig_ok:
        acc = ig_data.get("account", {})
        top = ig_data.get("top_posts", [])
        summary_parts.append(
            f"[Instagram]\n"
            f"- 팔로워: {acc.get('followers_count', 0):,}명\n"
            f"- 기간 도달수: {acc.get('reach', 0):,}회\n"
            f"- 기간 인상수: {acc.get('impressions', 0):,}회\n"
            f"- 프로필 방문: {acc.get('profile_views', 0):,}회\n"
            f"- 평균 engagement: {ig_data.get('avg_engagement', 0):.1f}\n"
            f"- 최고 게시물 TOP3: {[p.get('caption', '') for p in top]}"
        )
    else:
        summary_parts.append(f"[Instagram] 데이터 없음: {ig_data.get('error', '')}")

    if yt_ok:
        ch = yt_data.get("channel", {})
        top_v = yt_data.get("top_videos", [])
        summary_parts.append(
            f"[YouTube]\n"
            f"- 조회수: {ch.get('views', 0):,}회\n"
            f"- 시청시간: {ch.get('watch_minutes', 0):,}분\n"
            f"- 구독자 증감: +{ch.get('subscribers_gained', 0)} / -{ch.get('subscribers_lost', 0)} "
            f"(순증 {ch.get('net_subscribers', 0):+d}명)\n"
            f"- 좋아요: {ch.get('likes', 0):,} / 댓글: {ch.get('comments', 0):,}\n"
            f"- 상위 영상: {[v.get('url', '') for v in top_v[:3]]}"
        )
    else:
        err = yt_data.get("channel", {}).get("error", "데이터 없음")
        summary_parts.append(f"[YouTube] 데이터 없음: {err}")

    data_summary = "\n\n".join(summary_parts)

    # GPT-4o로 인사이트 분석 + 액션 아이템 병렬 생성
    analysis_prompt = (
        f"소상공인 마케팅 성과 데이터를 분석해서 실질적인 인사이트를 제공해주세요.\n\n"
        f"{data_summary}\n\n"
        "다음 3가지를 간결하게 작성해주세요:\n"
        "1. 이번 기간 성과 요약 (2~3줄)\n"
        "2. 잘된 점 + 개선 포인트 (각 1~2가지)\n"
        "3. 다음 기간 핵심 방향 (1~2줄)\n\n"
        "소상공인 입장에서 쉽게 이해할 수 있는 언어로 작성하세요."
    )

    from datetime import date as _date
    _today = _date.today()
    today_str = _today.strftime("%Y년 %m월 %d일")

    # 다가오는 기념일 계산
    upcoming_holidays = _get_upcoming_holidays(_today, days_ahead=60)
    if upcoming_holidays:
        holiday_lines = "\n".join(
            f"  - {h['name']} ({h['date']}, {h['days_left']}일 후)"
            for h in upcoming_holidays
        )
        holiday_section = f"\n[다가오는 기념일 (60일 이내)]\n{holiday_lines}\n"
    else:
        holiday_section = ""

    # 플랫폼 연결 상태에 따라 가능한 카테고리 안내
    available_categories: list[str] = ["content", "general"]
    if ig_ok:
        available_categories.insert(0, "instagram")
    if yt_ok:
        available_categories.insert(0, "youtube")
    available_str = ", ".join(f'"{c}"' for c in available_categories)

    actions_prompt = (
        f"오늘은 {today_str}입니다. 소상공인의 마케팅 성과 데이터를 바탕으로 "
        f"지금 당장 실행 가능한 구체적인 마케팅 할 일 3~5개를 기획해주세요.\n\n"
        f"{data_summary}"
        f"{holiday_section}\n"
        "각 할 일은 '팔로워 늘리기' 같은 막연한 목표가 아니라, 실제로 실행에 옮길 수 있는 "
        "구체적인 아이디어여야 합니다. 연결된 플랫폼 데이터가 없더라도 콘텐츠 전략·이벤트 기획 등 "
        "일반 마케팅 액션을 반드시 3개 이상 생성하세요.\n"
        "다가오는 기념일이 있다면 해당 날짜에 맞춘 이벤트·콘텐츠를 우선적으로 제안하고, "
        "기념일 이름과 날짜를 title 또는 idea에 자연스럽게 반영하세요.\n\n"
        "아래 JSON 배열 형식으로만 응답하세요 (설명 텍스트 없이, 배열만):\n"
        '[\n'
        '  {\n'
        f'    "priority": "high",\n'
        f'    "category": {available_categories[0]!r},\n'
        '    "title": "액션 제목 (20자 이내)",\n'
        '    "target": "타겟층 (예: 20~30대 여성, 뷰티 관심층)",\n'
        '    "period": "실행 기간 (예: 5월 3일 ~ 5월 10일)",\n'
        '    "idea": "구체적인 이벤트·콘텐츠 아이디어 (2~3문장, 형식·소재·메시지 포함)",\n'
        '    "steps": ["실행 단계 1", "실행 단계 2", "실행 단계 3"],\n'
        '    "expected": "기대 효과 (예: 팔로워 +50~100명, 도달수 1.5배)",\n'
        '    "why": "이 액션이 필요한 이유 (수치 근거 포함, 1문장)"\n'
        '  }\n'
        ']\n\n'
        f'priority: "high"(이번 주), "medium"(이번 달), "low"(여유 있을 때)\n'
        f'category 허용값: {available_str}\n'
        'steps는 2~4개 배열. JSON 외 텍스트 절대 포함하지 마세요.'
    )

    try:
        analysis_resp, actions_resp = await _asyncio.gather(
            chat_completion(
                messages=[{"role": "user", "content": analysis_prompt}],
                model="gpt-4o",
                temperature=0.4,
            ),
            chat_completion(
                messages=[{"role": "user", "content": actions_prompt}],
                model="gpt-4o",
                temperature=0.3,
            ),
            return_exceptions=True,
        )

        if isinstance(analysis_resp, Exception):
            analysis = "분석 중 오류가 발생했습니다."
        else:
            analysis = analysis_resp.choices[0].message.content or "분석 데이터를 불러올 수 없습니다."

        actions: list[dict] = []
        if isinstance(actions_resp, Exception):
            log.warning("run_marketing_report: actions LLM call failed: %s", actions_resp)
        else:
            import re as _re
            raw_actions = actions_resp.choices[0].message.content or "[]"
            log.debug("run_marketing_report: raw actions response: %s", raw_actions[:300])
            # ```json ... ``` 또는 ``` ... ``` 블록 추출, 없으면 전체 텍스트 사용
            code_block = _re.search(r"```(?:json)?\s*([\s\S]*?)```", raw_actions)
            if code_block:
                raw_actions = code_block.group(1).strip()
            else:
                # JSON 배열 직접 추출 시도
                arr_match = _re.search(r"\[[\s\S]*\]", raw_actions)
                if arr_match:
                    raw_actions = arr_match.group(0)
            try:
                parsed = _json.loads(raw_actions.strip())
                if isinstance(parsed, list):
                    actions = parsed
                    log.info("run_marketing_report: generated %d action items", len(actions))
                else:
                    log.warning("run_marketing_report: actions parsed but not a list: %s", type(parsed))
            except Exception as e:
                log.warning("run_marketing_report: actions JSON parse failed: %s | raw: %s", e, raw_actions[:200])
    except Exception as e:
        log.exception("run_marketing_report: unexpected error: %s", e)
        analysis = "분석 중 오류가 발생했습니다."
        actions = []

    # [[MARKETING_REPORT]] 마커 생성
    report_payload = {
        "period_days": period,
        "instagram": ig_data if ig_ok else {"error": ig_data.get("error") or NO_MARKETING_CONTENT_MESSAGE},
        "youtube": yt_data if yt_ok else {"error": yt_data.get("channel", {}).get("error") or NO_MARKETING_CONTENT_MESSAGE},
        "analysis": analysis,
        "actions": actions,
    }
    marker = f"\n\n[[MARKETING_REPORT]]{_json.dumps(report_payload, ensure_ascii=False)}[[/MARKETING_REPORT]]"

    # analysis는 카드(marker) 안에만 포함 — 본문 중복 노출 방지
    reply = (
        f"[ARTIFACT]\ntitle: 마케팅 성과 리포트 ({period}일)\ntype: marketing_report\ndomains: [marketing]\n[/ARTIFACT]"
        + marker
    )

    return reply


def _cron_to_korean(cron: str) -> str:
    """cron 5-field 표현식 → 한국어 요약."""
    parts = cron.strip().split()
    if len(parts) != 5:
        return cron
    minute, hour, dom, month, dow = parts
    _DOW = {"0": "일", "1": "월", "2": "화", "3": "수", "4": "목", "5": "금", "6": "토", "7": "일"}
    try:
        time_str = f"오전 {int(hour)}시 {int(minute)}분" if hour != "*" and minute != "*" else ""
    except ValueError:
        time_str = ""
    if dow != "*" and dom == "*":
        days = "/".join(_DOW.get(d, d) for d in dow.replace("-", ",").split(","))
        return f"매주 {days}요일 {time_str}".strip()
    if dom != "*" and dow == "*":
        return f"매월 {dom}일 {time_str}".strip()
    if dow == "*" and dom == "*" and month == "*":
        return f"매일 {time_str}".strip()
    return cron


async def run_schedule_post(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    task: str,
    cron: str,
    label: str | None = None,
) -> str:
    """정기 마케팅 작업 스케줄을 artifact 로 등록한다.

    Celery Beat 이 next_run 시각에 artifact.content(= task) 를 marketing.run() 에 전달해
    SNS 게시물 작성·블로그 포스팅 등 지정한 작업을 자동 실행한다.
    """
    import uuid as _uuid
    from croniter import croniter as _croniter
    from datetime import datetime as _dt, timezone as _tz
    from app.core.supabase import get_supabase

    # cron 유효성 검사 + next_run 계산
    try:
        _now = _dt.now(_tz.utc)
        next_run = _croniter(cron, _now).get_next(_dt).isoformat()
    except Exception:
        return (
            f"cron 표현식이 올바르지 않습니다: `{cron}`\n"
            "예시: `0 9 * * 1` (매주 월요일 오전 9시), `0 10 * * *` (매일 오전 10시)"
        )

    title = label or f"자동: {task}"
    cron_desc = _cron_to_korean(cron)

    # Artifact 직접 생성 (schedule 메타데이터 포함)
    sb = get_supabase()
    artifact_id = str(_uuid.uuid4())
    hub_id = (
        pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=("campaign", "캠페인"))
        or pick_main_hub_id(sb, account_id, "marketing")
    )

    result = sb.table("artifacts").insert({
        "id": artifact_id,
        "account_id": account_id,
        "kind": "artifact",
        "type": "schedule_post",
        "title": title,
        "content": task,
        "domains": ["marketing"],
        "status": "active",
        "metadata": {
            "schedule_enabled": True,
            "schedule_status": "active",
            "cron": cron,
            "next_run": next_run,
        },
    }).execute()

    created_id = ((result.data or [{}])[0]).get("id", artifact_id)
    record_artifact_for_focus(created_id)

    if hub_id:
        try:
            sb.table("artifact_edges").insert({
                "account_id": account_id,
                "from_id": hub_id,
                "to_id": created_id,
                "relation": "contains",
            }).execute()
        except Exception:
            pass

    try:
        sb.table("activity_logs").insert({
            "account_id": account_id,
            "type": "artifact_created",
            "domain": "marketing",
            "title": title,
            "description": f"마케팅 자동화 스케줄 등록 — {cron_desc}",
            "metadata": {"artifact_id": created_id},
        }).execute()
    except Exception:
        pass

    # 사용자 안내 문구 (LLM 없이 직접 생성 — 형식 일관성 보장)
    next_local = next_run[:16].replace("T", " ")
    return (
        f"마케팅 자동화 스케줄이 등록됐습니다.\n\n"
        f"**{title}**\n"
        f"- 실행 주기: {cron_desc}\n"
        f"- 다음 실행: {next_local} UTC\n"
        f"- 실행 작업: {task}\n\n"
        f"Celery 스케줄러가 설정한 주기마다 자동으로 위 작업을 실행하고 결과를 로그로 저장합니다. "
        f"스케줄 관리는 상단 캘린더 아이콘(Schedule Manager)에서 일시정지/재개할 수 있습니다."
    )


async def run_event_poster(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    event_title: str,
    event_content: str = "",
    style: str = "",
    source_artifact_id: str | None = None,
    _preceding_reply: str = "",
    **_: object,
) -> str:
    """이벤트 포스터 HTML을 GPT-4o로 생성하고 [[EVENT_POSTER]] 마커를 반환한다."""
    import json as _json
    from app.core.event_poster_gen import generate_event_poster

    # event_content 우선순위: 명시값 > 이전 스텝(기획안 텍스트) > 원본 메시지
    effective_content = (
        event_content.strip()
        or _preceding_reply.strip()
        or message.strip()
    )

    try:
        result = await generate_event_poster(
            account_id=account_id,
            event_title=event_title,
            event_content=effective_content,
            style_prompt=style,
            source_artifact_id=source_artifact_id or None,
        )
    except Exception as exc:
        log.exception("run_event_poster failed")
        return f"포스터 생성에 실패했어요: {exc}"

    payload = {
        "artifact_id": result["artifact_id"],
        "title": result["title"],
        "public_url": result.get("public_url", ""),
    }
    marker = f"[[EVENT_POSTER]]{_json.dumps(payload, ensure_ascii=False)}[[/EVENT_POSTER]]"
    return marker


def describe(account_id: str) -> list[dict]:
    return [
        {
            "name": "mkt_blog_post_form",
            "description": (
                "블로그 포스트 작성 폼 UI를 열어 주제·방향·키워드·톤을 입력할 수 있게 한다. "
                "'블로그 포스트 작성해줘', '네이버 블로그 써줘' 처럼 주제(topic)가 명시되지 않은 요청에 즉시 호출. "
                "메시지에 '주제:' 또는 '바로 완성해줘' 가 있으면 mkt_blog_post 직접 호출."
            ),
            "handler": run_blog_post_form,
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "mkt_review_reply_form",
            "description": (
                "리뷰 답글 작성 폼 UI를 열어 리뷰 원문·별점·플랫폼을 입력할 수 있게 한다. "
                "'리뷰 답글 작성해줘', '리뷰에 답글 달아줘' 처럼 리뷰 원문이 없는 요청에 즉시 호출. "
                "리뷰 원문이 메시지에 있으면 mkt_review_reply 직접 호출."
            ),
            "handler": run_review_reply_form,
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "mkt_sns_post_form",
            "description": (
                "SNS 게시물 작성 폼 UI를 열어 사용자가 주제·제품·혜택·톤·플랫폼을 입력할 수 있게 한다. "
                "'SNS 게시물 작성해줘', '인스타 포스트 만들어줘' 처럼 주제(topic) 가 명시되지 않은 요청에 즉시 호출. "
                "주제·내용이 이미 메시지에 있으면 mkt_sns_post 를 직접 호출."
            ),
            "handler": run_sns_post_form,
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "mkt_sns_post",
            "description": (
                "인스타그램·페이스북 등 SNS 피드 게시물을 작성한다. "
                "캡션 + 해시태그 + 추천 게시 시간 완성. DALL-E 로 이미지 자동 생성도 포함."
            ),
            "handler": run_sns_post,
            "parameters": {
                "type": "object",
                "properties": {
                    "topic":     {"type": "string", "description": "게시물 주제 (예: '신메뉴 출시', '추석 이벤트')"},
                    "product":   {"type": "string", "description": "제품·서비스명(선택)"},
                    "promotion": {"type": "string", "description": "프로모션/혜택(선택)"},
                    "tone":      {"type": "string", "description": "톤 (예: '따뜻한', '유머러스')"},
                    "platform":  {"type": "string", "enum": ["instagram", "facebook", "thread"], "default": "instagram"},
                },
                "required": ["topic"],
            },
        },
        {
            "name": "mkt_blog_post",
            "description": (
                "네이버 블로그 스타일 포스트(blog_post) 를 마크다운으로 작성한다. "
                "사용자가 '업로드'까지 요청하면 auto_upload=true 로 호출해 실제 네이버 블로그 자동 업로드까지 실행."
            ),
            "handler": run_blog_post,
            "parameters": {
                "type": "object",
                "properties": {
                    "topic":       {"type": "string"},
                    "keywords":    {"type": "array", "items": {"type": "string"}},
                    "auto_upload": {"type": "boolean", "default": False, "description": "네이버 블로그 자동 업로드 여부"},
                    "image_urls":  {"type": "array", "items": {"type": "string"}, "description": "포스트에 첨부할 이미지 URL 목록"},
                },
                "required": ["topic"],
            },
        },
        {
            "name": "mkt_review_reply",
            "description": (
                "고객 리뷰(네이버/카카오/구글 등) 에 대한 사장님 답글을 작성한다. "
                "리뷰 본문과 별점이 있으면 함께 넘김."
            ),
            "handler": run_review_reply,
            "parameters": {
                "type": "object",
                "properties": {
                    "review_text": {"type": "string", "description": "리뷰 원문"},
                    "star_rating": {"type": "integer", "minimum": 1, "maximum": 5},
                    "platform":    {"type": "string", "description": "네이버·카카오·구글 등"},
                },
                "required": ["review_text"],
            },
        },
        {
            "name": "mkt_ad_copy",
            "description": "광고 카피·배너 문구를 3~5안으로 작성한다.",
            "handler": run_ad_copy,
            "parameters": {
                "type": "object",
                "properties": {
                    "product":     {"type": "string"},
                    "channel":     {"type": "string", "description": "예: 네이버 검색광고, 인스타그램 피드"},
                    "target":      {"type": "string", "description": "타겟 고객(예: 20대 여성)"},
                    "key_benefit": {"type": "string"},
                },
                "required": ["product"],
            },
        },
        {
            "name": "mkt_shorts_video",
            "description": (
                "사용자가 업로드한 이미지 슬라이드로 YouTube Shorts 세로형 영상을 제작하고 자동 업로드한다. "
                "쇼츠 / 유튜브 영상 / 슬라이드 영상 / 사진으로 영상 만들기 요청 시 즉시 호출한다. "
                "파라미터를 묻지 말고 바로 호출할 것 — 제목·슬라이드 수·시간은 위자드 UI에서 사용자가 직접 설정한다."
            ),
            "handler": run_shorts_wizard,
            "parameters": {
                "type": "object",
                "properties": {
                    "topic":       {"type": "string", "description": "메시지에서 파악된 주제 (없으면 빈 문자열)"},
                    "slide_count": {"type": "integer", "description": "슬라이드 수 (기본 5)", "default": 5},
                    "duration":    {"type": "number", "description": "슬라이드당 초 (기본 3)", "default": 3},
                },
                "required": [],
            },
        },
        {
            "name": "mkt_campaign_plan",
            "description": (
                "마케팅 캠페인·이벤트 기획을 artifact 로 등록한다 (start/end_date → 스케쥴러 D-리마인드 자동)."
            ),
            "handler": run_campaign_plan,
            "parameters": {
                "type": "object",
                "properties": {
                    "title":      {"type": "string"},
                    "start_date": {"type": "string", "description": "YYYY-MM-DD"},
                    "end_date":   {"type": "string", "description": "YYYY-MM-DD"},
                    "goal":       {"type": "string"},
                    "budget":     {"type": "string"},
                    "channels":   {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "start_date", "end_date"],
            },
        },
        {
            "name": "mkt_event_form",
            "description": (
                "이벤트 기획 폼 UI를 열어 사용자가 이벤트 정보를 한번에 입력할 수 있게 한다. "
                "'이벤트 기획해줘', '프로모션 기획해줘' 처럼 세부 정보(이벤트명·기간·혜택)가 없는 요청에 즉시 호출. "
                "사용자가 이벤트명·날짜·혜택 등을 이미 제공한 경우에는 mkt_event_plan 을 직접 호출."
            ),
            "handler": run_event_form,
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "mkt_event_plan",
            "description": (
                "이벤트·프로모션·세일·기념일 행사 기획안을 작성하고 artifact 로 등록한다. "
                "start_date + end_date 또는 due_date 를 저장해 D-7/D-3/D-1/D-0 알림 자동 발생. "
                "'이벤트 기획', '프로모션', '할인 행사', '기념일 이벤트' 요청 시 호출. "
                "인스타 자동 게시 요청 시 mkt_sns_post(depends_on: mkt_event_plan) 을 함께 dispatch. "
                "포스터 생성 요청 시 mkt_event_poster(depends_on: mkt_event_plan) 을 함께 dispatch. "
                "절대 HTML 코드를 직접 출력하지 않는다 — 포스터 HTML은 mkt_event_poster 가 처리."
            ),
            "handler": run_event_plan,
            "parameters": {
                "type": "object",
                "properties": {
                    "title":      {"type": "string", "description": "이벤트명 (예: '어버이날 감사 이벤트')"},
                    "event_type": {"type": "string", "description": "이벤트 종류 (예: '할인', '증정', 'SNS 이벤트')"},
                    "start_date": {"type": "string", "description": "시작일 YYYY-MM-DD"},
                    "end_date":   {"type": "string", "description": "종료일 YYYY-MM-DD (기간 행사)"},
                    "due_date":   {"type": "string", "description": "단일 행사일 YYYY-MM-DD (하루 행사)"},
                    "benefit":    {"type": "string", "description": "혜택·참여 방법"},
                },
                "required": ["title", "event_type", "start_date"],
            },
        },
        {
            "name": "mkt_notice",
            "description": (
                "임시휴무·영업시간변경·이벤트·신상품 등 공지사항을 작성하고 artifact 로 저장한다. "
                "publish_sns=true 로 호출하면 인스타그램용 SNS 버전도 함께 작성해 Instagram 카드를 자동 생성. "
                "'공지', '임시휴무', '영업시간', '안내문' 요청 시 호출."
            ),
            "handler": run_notice,
            "parameters": {
                "type": "object",
                "properties": {
                    "notice_type":  {"type": "string", "description": "공지 종류 (예: '임시휴무', '영업시간 변경', '이벤트 안내')"},
                    "content":      {"type": "string", "description": "공지 핵심 내용"},
                    "date":         {"type": "string", "description": "날짜/시간 (선택)"},
                    "publish_sns":  {"type": "boolean", "default": False, "description": "인스타그램 SNS 버전도 함께 작성 여부"},
                },
                "required": ["notice_type", "content"],
            },
        },
        {
            "name": "mkt_marketing_report",
            "description": (
                "Instagram + YouTube 실제 성과 데이터를 조회해 AI 마케팅 성과 리포트를 생성한다. "
                "'성과 보고', '인스타 분석', '유튜브 분석', '이번달 마케팅 어땠어', '리포트' 요청 시 호출. "
                "파라미터 없이 바로 호출해도 되며, period 는 기본 30일."
            ),
            "handler": run_marketing_report,
            "parameters": {
                "type": "object",
                "properties": {
                    "period": {
                        "type": "integer",
                        "description": "분석 기간(일). 기본 30. 7·14·30·90 권장.",
                        "default": 30,
                    },
                },
                "required": [],
            },
        },
        {
            "name": "mkt_event_poster",
            "description": (
                "이벤트·프로모션 포스터를 HTML로 생성해 미리보기를 보여준다. "
                "'포스터', '전단지', '홍보물', '오프라인 포스터', '이벤트 포스터' 키워드 포함 시 호출. "
                "event_title과 event_content는 필수. style은 선택."
            ),
            "handler": run_event_poster,
            "parameters": {
                "type": "object",
                "properties": {
                    "event_title": {
                        "type": "string",
                        "description": "이벤트·행사명 (예: '봄맞이 할인 이벤트')",
                    },
                    "event_content": {
                        "type": "string",
                        "description": "이벤트 상세 내용 (날짜, 혜택, 참여 방법 등)",
                    },
                    "style": {
                        "type": "string",
                        "description": "디자인 스타일 힌트 (선택, 예: '따뜻한 봄 컬러, 파스텔 톤')",
                    },
                    "source_artifact_id": {
                        "type": "string",
                        "description": "연결할 이벤트 기획안 artifact_id (선택)",
                    },
                },
                "required": ["event_title"],
            },
        },
        {
            "name": "mkt_schedule_form",
            "description": (
                "자동화 스케줄 설정 폼 UI를 띄운다. "
                "'스케줄', '자동화', '자동으로', '정기적으로', '예약', '매주', '매일' 키워드 포함 시 "
                "구체적인 cron·task 정보 없이 바로 호출. "
                "폼을 통해 사용자가 직접 작업·주기·시간을 선택하게 한다."
            ),
            "handler": run_schedule_form,
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
        {
            "name": "mkt_schedule_post",
            "description": (
                "마케팅 작업을 정기 자동 실행하는 스케줄을 실제 등록한다. "
                "반드시 task(작업 지시문)와 cron(5-field 표현식)이 모두 명시된 경우에만 호출. "
                "폼 제출 후 task·cron이 메시지에 포함되어 있으면 이 capability를 호출."
            ),
            "handler": run_schedule_post,
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "자동 실행할 마케팅 작업 지시문 (예: '인스타그램 게시물 작성 — 오늘의 신메뉴 소개')",
                    },
                    "cron": {
                        "type": "string",
                        "description": "cron 5-field 표현식 (예: '0 9 * * 1' = 매주 월요일 오전 9시)",
                    },
                    "label": {
                        "type": "string",
                        "description": "스케줄 이름 (선택, 없으면 task 기반 자동 생성)",
                    },
                },
                "required": ["task", "cron"],
            },
        },
    ]


# ── 폼 pre-routing 패턴 ──────────────────────────────────────────────────
_SNS_FORM_TRIGGER_RE = _re.compile(
    r"(인스타(그램)?\s*(피드|게시물|포스트|콘텐츠|글)?\s*(기획|만들어|만들어줘|만들어\s*줘|작성|작성해줘|써줘|써\s*줘|부탁|요청)"
    r"|sns\s*(게시물|포스트|피드|콘텐츠)?\s*(기획|만들어|작성|써줘|부탁|요청))",
    _re.IGNORECASE,
)
_SNS_TOPIC_PRESENT_RE = _re.compile(
    r"(주제\s*[:：]|바로\s*완성|아래\s*정보로|키워드\s*[:：]|제품\s*[:：]|상품\s*[:：]|메뉴\s*[:：])",
    _re.IGNORECASE,
)


def _needs_sns_post_form(message: str) -> bool:
    """주제 없이 SNS/인스타 게시물을 요청하는 메시지인지 판별."""
    return bool(_SNS_FORM_TRIGGER_RE.search(message)) and not bool(
        _SNS_TOPIC_PRESENT_RE.search(message)
    )


_BLOG_FORM_TRIGGER_RE = _re.compile(
    r"(네이버\s*)?블로그\s*(포스트|글|게시글|포스팅|작성|써줘|써\s*줘|작성해줘|만들어줘|만들어\s*줘|기획|기획해줘|기획해\s*줘|부탁|요청)",
    _re.IGNORECASE,
)
_BLOG_TOPIC_PRESENT_RE = _re.compile(
    r"(주제\s*[:：]|바로\s*완성|아래\s*정보로|키워드\s*[:：])",
    _re.IGNORECASE,
)


def _needs_blog_post_form(message: str) -> bool:
    """주제 없이 블로그 포스트를 요청하는 메시지인지 판별."""
    return bool(_BLOG_FORM_TRIGGER_RE.search(message)) and not bool(
        _BLOG_TOPIC_PRESENT_RE.search(message)
    )


_SHORTS_TRIGGER_RE = _re.compile(
    r"(유튜브\s*(쇼츠|shorts|영상|동영상)|쇼츠\s*(만들|작성|제작|영상|부탁|요청)|shorts\s*(만들|작성|제작))",
    _re.IGNORECASE,
)


def _needs_shorts_wizard(message: str) -> bool:
    """쇼츠/유튜브 영상 제작 요청 메시지인지 판별."""
    return bool(_SHORTS_TRIGGER_RE.search(message))


_REPORT_TRIGGER_RE = _re.compile(
    r"(성과\s*(리포트|보고|분석|보여|알려)|리포트\s*(보여|줘|알려|생성)|인스타(그램)?\s*(분석|성과|통계|지표|조회수|좋아요)|유튜브\s*(분석|성과|통계|지표|조회수)|마케팅\s*(어땠|성과|리포트)|이번\s*달?\s*마케팅|채널\s*(성과|분석))",
    _re.IGNORECASE,
)


def _needs_marketing_report(message: str) -> bool:
    """성과 리포트 요청 메시지인지 판별."""
    return bool(_REPORT_TRIGGER_RE.search(message))


# ──────────────────────────────────────────────────────────────────────────
# 메인 run (DeepAgent 기반)
# ──────────────────────────────────────────────────────────────────────────
@traceable(name="marketing.run", run_type="chain")
async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
    image_urls: list[str] | None = None,
    allow_naver_upload: bool = False,
) -> str:
    # 쇼츠/유튜브 영상 요청 → 마법사 즉시 반환
    if _needs_shorts_wizard(message):
        return await run_shorts_wizard(
            account_id=account_id,
            message=message,
            history=history,
            long_term_context=long_term_context,
            rag_context=rag_context,
        )

    # 인스타그램/SNS 게시물 요청인데 주제 없음 → 폼 즉시 반환
    if _needs_sns_post_form(message):
        return await run_sns_post_form(
            account_id=account_id,
            message=message,
            history=history,
            long_term_context=long_term_context,
            rag_context=rag_context,
        )

    # 블로그 포스트 요청인데 주제 없음 → 폼 즉시 반환
    if _needs_blog_post_form(message):
        return await run_blog_post_form(
            account_id=account_id,
            message=message,
            history=history,
            long_term_context=long_term_context,
            rag_context=rag_context,
        )

    # 성과 리포트 요청 → 질문 없이 바로 조회
    if _needs_marketing_report(message):
        return await run_marketing_report(
            account_id=account_id,
            message=message,
            history=history,
            long_term_context=long_term_context,
            rag_context=rag_context,
        )

    system = AGENT_SYSTEM_PROMPT + "\n\n" + today_context()

    hubs = list_sub_hub_titles(account_id, "marketing")
    if hubs:
        system += "\n\n[이 계정의 marketing 서브허브]\n- " + "\n- ".join(hubs)

    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"

    if rag_context:
        system += f"\n\n{rag_context}"

    fb = feedback_context(account_id, "marketing")
    if fb:
        system += f"\n\n{fb}"

    knowledge_ctx = await marketing_knowledge_context(message)
    if knowledge_ctx:
        system += f"\n\n{knowledge_ctx}"

    # 메시지 본문에서 이미지 URL 파싱 (폼 제출 시 텍스트로 포함된 경우 fallback)
    effective_image_urls: list[str] = list(image_urls or [])
    if not effective_image_urls:
        _url_hits = _re.findall(
            r'https?://\S+\.(?:jpg|jpeg|png|webp|gif)(?:\?\S*)?',
            message, _re.IGNORECASE,
        )
        if not _url_hits:
            # supabase storage URL 등 확장자 없는 경우도 커버
            m = _re.search(r'첨부 이미지 URL[^:]*:\s*(.+)', message)
            if m:
                _url_hits = [u.strip() for u in m.group(1).split(',') if u.strip().startswith('http')]
        effective_image_urls = _url_hits

    if effective_image_urls:
        system += f"\n\n[첨부 이미지 URL]\n" + "\n".join(effective_image_urls)

    return await _run_marketing_agent(
        account_id, message, history, rag_context, long_term_context, system,
        extra_ctx={"image_urls": effective_image_urls or None, "allow_naver_upload": allow_naver_upload},
    )


def _patch_artifact_meta_from_marker(
    artifact_id: str | None, marker: str, pattern: str,
) -> None:
    """Instagram/Review 카드 JSON payload 를 artifact.metadata 에 머지.

    상세 모달에서 image_url · star_rating 등을 재렌더링하기 위해 필요.
    """
    if not artifact_id:
        return
    try:
        m = _re.search(pattern, marker)
        if not m:
            return
        payload = _json.loads(m.group(1))
        if not isinstance(payload, dict):
            return
        from app.core.supabase import get_supabase
        sb = get_supabase()
        current = (
            sb.table("artifacts").select("metadata").eq("id", artifact_id).execute().data
            or []
        )
        meta = dict((current[0].get("metadata") if current else {}) or {})
        for k, v in payload.items():
            if v is None or v == "":
                continue
            meta[k] = v
        sb.table("artifacts").update({"metadata": meta}).eq("id", artifact_id).execute()
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────────────
# DeepAgent 실행 인프라
# ──────────────────────────────────────────────────────────────────────────

_MARKETING_TERMINAL_REMINDER = """
[경고] terminal tool을 호출하지 않았습니다.
반드시 다음 중 하나를 즉시 호출하세요:
- write_sns_post(...) — SNS 피드 게시물 저장
- write_blog_post(...) — 블로그 포스트 저장
- write_review_reply(...) — 리뷰 답글 저장
- write_ad_copy(...) — 광고 카피 저장
- write_event_plan(...) — 이벤트 기획안 저장
- write_campaign(...) — 캠페인 기획 저장
- write_notice(...) — 공지사항 저장
- write_marketing_plan(...) — 마케팅 플랜 저장
- write_product_post(...) — 상품 소개 게시글 저장
- ask_user(...) — 사용자에게 추가 정보 요청

마케팅 자료 작성 요청에서 terminal tool 미호출은 오류입니다.
"""


def _make_marketing_model():
    """Marketing DeepAgent용 LLM 모델 생성."""
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


@traceable(name="marketing._run_marketing_agent", run_type="chain")
async def _run_marketing_agent(
    account_id: str,
    message: str,
    history: list[dict],
    rag_context: str,
    long_term_context: str,
    system_prompt: str,
    *,
    extra_ctx: dict | None = None,
) -> str:
    """Marketing DeepAgent를 실행하고 결과를 반환합니다."""
    inject_agent_context(account_id, message, history, rag_context, long_term_context)
    init_marketing_result_store(extra=extra_ctx)

    model = _make_marketing_model()
    messages_in = [*history[-6:], {"role": "user", "content": message}]

    async def _invoke(sys: str) -> list:
        agent = create_deep_agent(model=model, tools=MARKETING_TOOLS, system_prompt=sys)
        result = await agent.ainvoke({"messages": messages_in})
        return result.get("messages", [])

    async def _invoke_with_retry(sys: str, max_retries: int = 3) -> list:
        import asyncio, re as _re2
        for attempt in range(max_retries + 1):
            try:
                return await _invoke(sys)
            except Exception as exc:
                exc_str = str(exc)
                is_rate_limit = "429" in exc_str or "rate_limit" in exc_str.lower() or "rate limit" in exc_str.lower()
                if not is_rate_limit or attempt >= max_retries:
                    raise
                # 에러 메시지에서 대기 시간 파싱 (예: "try again in 44ms", "try again in 2s")
                wait = 5.0 * (2 ** attempt)  # 기본 지수 백오프: 5s, 10s, 20s
                m = _re2.search(r'try again in (\d+(?:\.\d+)?)(ms|s)', exc_str, _re2.IGNORECASE)
                if m:
                    val, unit = float(m.group(1)), m.group(2).lower()
                    parsed = val / 1000 if unit == "ms" else val
                    wait = max(parsed + 0.5, wait)
                log.warning("[marketing] rate limit hit (attempt %d/%d), waiting %.1fs", attempt + 1, max_retries, wait)
                await asyncio.sleep(wait)
        raise RuntimeError("재시도 횟수 초과")

    try:
        out_messages = await _invoke_with_retry(system_prompt)
    except Exception as exc:
        log.exception("[marketing] deepagent invoke failed")
        return f"마케팅 처리 중 오류가 발생했습니다: {exc}"

    result_data = get_marketing_result_store()

    if not result_data:
        log.info("[marketing] account=%s no terminal tool — retry", account_id)
        try:
            init_marketing_result_store(extra=extra_ctx)
            out_messages = await _invoke_with_retry(system_prompt + "\n\n" + _MARKETING_TERMINAL_REMINDER)
        except Exception as exc:
            log.exception("[marketing] retry invoke failed")
            return f"마케팅 처리 중 오류가 발생했습니다: {exc}"
        result_data = get_marketing_result_store()

    if not result_data:
        from langchain_core.messages import AIMessage
        for msg in reversed(out_messages):
            if isinstance(msg, AIMessage) and msg.content:
                content = msg.content
                if isinstance(content, list):
                    texts = [b["text"] for b in content if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()]
                    if texts:
                        return " ".join(texts).strip()
                elif isinstance(content, str) and content.strip():
                    return content.strip()
        return "처리 결과를 반환하지 못했습니다."

    action = result_data.get("action")
    if action == "write_sns_post":
        return await _execute_write_sns_post(account_id, result_data)
    if action == "write_blog_post":
        return await _execute_write_blog_post(account_id, result_data)
    if action == "write_review_reply":
        return await _execute_write_review_reply(account_id, result_data)
    if action == "write_ad_copy":
        return await _execute_write_ad_copy(account_id, result_data)
    if action == "write_event_plan":
        return await _execute_write_event_plan(account_id, result_data)
    if action == "write_campaign":
        return await _execute_write_campaign(account_id, result_data)
    if action == "write_notice":
        return await _execute_write_notice(account_id, result_data)
    if action == "write_marketing_plan":
        return await _execute_write_marketing_plan(account_id, result_data)
    if action == "write_product_post":
        return await _execute_write_product_post(account_id, result_data)
    if action == "ask_user":
        return result_data.get("question", "무엇을 도와드릴까요?")
    return "알 수 없는 action입니다."


# ──────────────────────────────────────────────────────────────────────────
# Execute functions (terminal tool 결과 처리 + artifact 저장)
# ──────────────────────────────────────────────────────────────────────────

async def _execute_write_sns_post(account_id: str, result_data: dict) -> str:
    import json as _json
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "SNS 게시물"
    caption = result_data.get("caption") or ""
    hashtags_json = result_data.get("hashtags_json") or "[]"
    platform = result_data.get("platform") or "instagram"
    best_time = result_data.get("best_time") or ""
    sub_domain = result_data.get("sub_domain") or "Social"

    try:
        hashtags = _json.loads(hashtags_json)
        if not isinstance(hashtags, list):
            hashtags = []
    except Exception:
        hashtags = []

    # 저장용 content 구성
    content_parts = [caption]
    if hashtags:
        content_parts.append(" ".join(f"#{t}" for t in hashtags))
    if best_time:
        content_parts.append(best_time)
    content = "\n\n".join(p for p in content_parts if p)

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "sns_post",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Social"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
        try:
            sb.table("activity_logs").insert({
                "account_id": account_id, "type": "artifact_created",
                "domain": "marketing", "title": title,
                "description": f"SNS 게시물 생성 ({platform})",
                "metadata": {"artifact_id": artifact_id},
            }).execute()
        except Exception:
            pass
    except Exception:
        log.exception("[marketing] write_sns_post artifact insert failed")

    if artifact_id:
        try:
            from app.memory.long_term import log_artifact_to_memory
            await log_artifact_to_memory(account_id, "marketing", "sns_post", title, content=content[:500])
        except Exception:
            pass

    # Instagram 카드 생성
    instagram_marker = ""
    _needs_instagram = "instagram" in platform.lower() or "인스타" in platform.lower()
    if _needs_instagram:
        image_url = await _generate_sns_image(caption, hashtags)
        payload = {
            "title": title,
            "caption": caption,
            "hashtags": hashtags,
            "best_time": best_time,
            "image_url": image_url,
        }
        instagram_marker = f"\n\n[[INSTAGRAM_POST]]{_json.dumps(payload, ensure_ascii=False)}[[/INSTAGRAM_POST]]"
        if artifact_id:
            _patch_artifact_meta_from_marker(artifact_id, instagram_marker, r"\[\[INSTAGRAM_POST\]\]([\s\S]*?)\[\[/INSTAGRAM_POST\]\]")

    # 응답 구성
    reply = caption
    if hashtags:
        reply += "\n\n" + " ".join(f"#{t}" for t in hashtags)
    if best_time:
        reply += f"\n\n{best_time}"
    reply += instagram_marker
    return reply


async def _execute_write_blog_post(account_id: str, result_data: dict) -> str:
    import json as _json
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "블로그 포스트"
    content = result_data.get("content") or ""
    tags_json = result_data.get("tags_json") or "[]"
    image_urls_json = result_data.get("image_urls_json") or "[]"
    sub_domain = result_data.get("sub_domain") or "Blog"

    extra = get_marketing_extra()
    auto_upload: bool = bool(extra.get("allow_naver_upload") or extra.get("auto_upload"))

    # image_urls 우선순위: 도구 파라미터 → extra_ctx → None
    try:
        tool_image_urls: list[str] = _json.loads(image_urls_json)
        if not isinstance(tool_image_urls, list):
            tool_image_urls = []
    except Exception:
        tool_image_urls = []
    image_urls: list[str] = tool_image_urls or extra.get("image_urls") or []

    try:
        tags = _json.loads(tags_json)
        if not isinstance(tags, list):
            tags = []
    except Exception:
        tags = []

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "blog_post",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Blog"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
        try:
            sb.table("activity_logs").insert({
                "account_id": account_id, "type": "artifact_created",
                "domain": "marketing", "title": title,
                "description": "블로그 포스트 생성",
                "metadata": {"artifact_id": artifact_id},
            }).execute()
        except Exception:
            pass
        try:
            from app.memory.long_term import log_artifact_to_memory
            await log_artifact_to_memory(account_id, "marketing", "blog_post", title, content=content[:500])
        except Exception:
            pass
    except Exception:
        log.exception("[marketing] write_blog_post artifact insert failed")

    # 블로그 미리보기 카드
    blog_payload = {
        "title": title,
        "content": content,
        "tags": tags,
        "image_urls": image_urls or [],
    }
    blog_marker = f"\n\n[[NAVER_BLOG_POST]]{_json.dumps(blog_payload, ensure_ascii=False)}[[/NAVER_BLOG_POST]]"

    reply = content + blog_marker

    # Naver 자동 업로드
    if auto_upload:
        upload_result = await _try_naver_upload(content, account_id=account_id, image_urls=image_urls)
        reply += f"\n\n{upload_result}"

    return reply


async def _execute_write_review_reply(account_id: str, result_data: dict) -> str:
    import json as _json
    from app.core.supabase import get_supabase

    reply_text = result_data.get("reply_text") or ""
    star_rating = result_data.get("star_rating")
    platform = result_data.get("platform")
    sub_domain = result_data.get("sub_domain") or "Reviews"
    title = f"리뷰 답글" + (f" ({star_rating}점)" if star_rating else "")

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "review_reply",
            "title": title,
            "content": reply_text,
            "status": "draft",
            "metadata": {"star_rating": star_rating, "platform": platform} if star_rating else {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Reviews"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
        try:
            from app.memory.long_term import log_artifact_to_memory
            await log_artifact_to_memory(account_id, "marketing", "review_reply", title, content=reply_text[:500])
        except Exception:
            pass
    except Exception:
        log.exception("[marketing] write_review_reply artifact insert failed")

    payload = {
        "reply_text": reply_text,
        "star_rating": star_rating,
        "char_count": len(reply_text),
    }
    review_marker = f"\n\n[[REVIEW_REPLY]]{_json.dumps(payload, ensure_ascii=False)}[[/REVIEW_REPLY]]"
    if artifact_id:
        _patch_artifact_meta_from_marker(artifact_id, review_marker, r"\[\[REVIEW_REPLY\]\]([\s\S]*?)\[\[/REVIEW_REPLY\]\]")

    return reply_text + review_marker


async def _execute_write_ad_copy(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "광고 카피"
    content = result_data.get("content") or ""
    channel = result_data.get("channel")
    target = result_data.get("target")
    sub_domain = result_data.get("sub_domain") or "Campaigns"

    sb = get_supabase()
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "ad_copy",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {k: v for k, v in {"channel": channel, "target": target}.items() if v},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Campaigns"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "marketing", "ad_copy", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[marketing] write_ad_copy artifact insert failed")

    return content


def _valid_date_or_none_mkt(s: str | None) -> str | None:
    from datetime import date
    s = (s or "").strip()
    import re as _re2
    if not _re2.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return None
    try:
        date.fromisoformat(s)
        return s
    except ValueError:
        return None


async def _execute_write_event_plan(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "이벤트 기획안"
    content = result_data.get("content") or ""
    event_type = result_data.get("event_type") or ""
    start_date = result_data.get("start_date") or ""
    end_date = result_data.get("end_date")
    due_date = result_data.get("due_date")
    sub_domain = result_data.get("sub_domain") or "Events"

    metadata: dict = {}
    for k, v in [("start_date", start_date), ("end_date", end_date), ("due_date", due_date)]:
        vv = _valid_date_or_none_mkt(v)
        if vv:
            metadata[k] = vv
    if "end_date" in metadata or "due_date" in metadata:
        metadata["due_label"] = "이벤트 종료" if "end_date" in metadata else "이벤트 당일"
    if event_type:
        metadata["event_type"] = event_type

    cleaned = _strip_html_blocks(content)

    sb = get_supabase()
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "event_plan",
            "title": title,
            "content": cleaned,
            "status": "draft",
            "metadata": metadata,
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Events"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "marketing", "event_plan", title, content=cleaned[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[marketing] write_event_plan artifact insert failed")

    return cleaned


async def _execute_write_campaign(account_id: str, result_data: dict) -> str:
    import json as _json
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "캠페인 기획"
    content = result_data.get("content") or ""
    start_date = result_data.get("start_date") or ""
    end_date = result_data.get("end_date") or ""
    goal = result_data.get("goal")
    channels_json = result_data.get("channels_json") or "[]"
    sub_domain = result_data.get("sub_domain") or "Campaigns"

    try:
        channels = _json.loads(channels_json)
        if not isinstance(channels, list):
            channels = []
    except Exception:
        channels = []

    metadata: dict = {}
    for k, v in [("start_date", start_date), ("end_date", end_date)]:
        vv = _valid_date_or_none_mkt(v)
        if vv:
            metadata[k] = vv
    if "end_date" in metadata:
        metadata["due_label"] = "캠페인 종료"
    if goal:
        metadata["goal"] = goal
    if channels:
        metadata["channels"] = channels

    sb = get_supabase()
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "campaign",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": metadata,
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Campaigns"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "marketing", "campaign", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[marketing] write_campaign artifact insert failed")

    return content


async def _execute_write_notice(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "공지사항"
    content = result_data.get("content") or ""
    notice_type = result_data.get("notice_type") or ""
    date = result_data.get("date")
    sub_domain = result_data.get("sub_domain") or "Social"

    metadata: dict = {}
    if notice_type:
        metadata["notice_type"] = notice_type
    if date:
        metadata["date"] = date

    sb = get_supabase()
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "notice",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": metadata,
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Social"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "marketing", "notice", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[marketing] write_notice artifact insert failed")

    return content


async def _execute_write_marketing_plan(account_id: str, result_data: dict) -> str:
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "마케팅 플랜"
    content = result_data.get("content") or ""
    period = result_data.get("period") or "이번 달"
    sub_domain = result_data.get("sub_domain") or "Social"

    sb = get_supabase()
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "marketing_plan",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {"period": period},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Social"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "marketing", "marketing_plan", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[marketing] write_marketing_plan artifact insert failed")

    return content


async def _execute_write_product_post(account_id: str, result_data: dict) -> str:
    import json as _json
    from app.core.supabase import get_supabase

    title = result_data.get("title") or "상품 소개"
    content = result_data.get("content") or ""
    caption = result_data.get("caption") or ""
    hashtags_json = result_data.get("hashtags_json") or "[]"
    product = result_data.get("product") or ""
    sub_domain = result_data.get("sub_domain") or "Social"

    try:
        hashtags = _json.loads(hashtags_json)
        if not isinstance(hashtags, list):
            hashtags = []
    except Exception:
        hashtags = []

    sb = get_supabase()
    artifact_id: str | None = None
    try:
        res = sb.table("artifacts").insert({
            "account_id": account_id,
            "domains": ["marketing"],
            "kind": "artifact",
            "type": "product_post",
            "title": title,
            "content": content,
            "status": "draft",
            "metadata": {"product": product} if product else {},
        }).execute()
        if res.data:
            artifact_id = res.data[0]["id"]
            record_artifact_for_focus(artifact_id)
            hub_id = pick_sub_hub_id(sb, account_id, "marketing", prefer_keywords=(sub_domain, "Social"))
            if hub_id:
                try:
                    sb.table("artifact_edges").insert({
                        "account_id": account_id, "parent_id": hub_id,
                        "child_id": artifact_id, "relation": "contains",
                    }).execute()
                except Exception:
                    pass
            try:
                from app.memory.long_term import log_artifact_to_memory
                await log_artifact_to_memory(account_id, "marketing", "product_post", title, content=content[:500])
            except Exception:
                pass
    except Exception:
        log.exception("[marketing] write_product_post artifact insert failed")

    # Instagram 카드 (해시태그가 있으면 생성)
    instagram_marker = ""
    effective_caption = caption or content.split("\n\n")[0] if content else ""
    if hashtags:
        image_url = await _generate_sns_image(effective_caption, hashtags)
        payload = {
            "title": title,
            "caption": effective_caption,
            "hashtags": hashtags,
            "best_time": "",
            "image_url": image_url,
        }
        instagram_marker = f"\n\n[[INSTAGRAM_POST]]{_json.dumps(payload, ensure_ascii=False)}[[/INSTAGRAM_POST]]"
        if artifact_id:
            _patch_artifact_meta_from_marker(artifact_id, instagram_marker, r"\[\[INSTAGRAM_POST\]\]([\s\S]*?)\[\[/INSTAGRAM_POST\]\]")

    return content + instagram_marker


def _extract_blog_content(reply: str) -> tuple[str, str]:
    """
    reply에서 실제 블로그 본문과 제목만 추출.
    - [ARTIFACT] 블록 이전 텍스트만 사용
    - 첫 번째 '# 제목' 줄부터 시작 (그 앞의 에이전트 대화 문구 제거)
    - '# 제목' 이 없으면 전체 사용
    Returns: (title, blog_content)
    """
    artifact_pos = reply.find("[ARTIFACT]")
    text = reply[:artifact_pos].strip() if artifact_pos != -1 else reply.strip()

    lines = text.splitlines()
    title = ""
    start_idx = 0

    for i, line in enumerate(lines):
        s = line.strip()
        if s.startswith("# ") and len(s) > 2:
            title = s[2:].strip()
            start_idx = i
            break

    blog_lines = lines[start_idx:] if title else lines

    # 마지막 #태그 줄 이후 대화 문구 제거
    last_tag_idx = None
    for i, line in enumerate(blog_lines):
        if _re.match(r"^(#[\w가-힣A-Za-z]+\s*)+$", line.strip()):
            last_tag_idx = i
    if last_tag_idx is not None:
        blog_lines = blog_lines[: last_tag_idx + 1]

    return title, "\n".join(blog_lines).strip()


async def _generate_blog_image(title: str, content_preview: str) -> str:
    """DALL-E 3으로 블로그 대표 이미지 생성 → 임시 파일 경로 반환. 실패 시 빈 문자열."""
    import tempfile
    import asyncio as _asyncio
    import urllib.request as _urllib
    from app.core.llm import client as openai_client

    prompt = (
        f"Korean small business blog promotional photo for: '{title}'. "
        f"{content_preview[:120]}. "
        "High-quality lifestyle/food/product photo, warm Korean aesthetic, "
        "natural lighting, no text, suitable for Naver blog header image."
    )
    try:
        resp = await openai_client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            n=1,
            size="1024x1024",
            quality="standard",
        )
        image_url = (resp.data[0].url or "").strip()
        if not image_url:
            return ""
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        tmp.close()
        await _asyncio.to_thread(_urllib.urlretrieve, image_url, tmp.name)
        return tmp.name
    except Exception:
        return ""


async def _try_naver_upload(reply: str, account_id: str = "", image_urls: list[str] | None = None) -> str:
    """blog_post 본문을 파싱해 네이버 블로그에 업로드. 결과 문자열 반환."""
    from app.agents._artifact import _parse_block

    # # 제목 줄 기준으로 실제 블로그 본문만 추출 (에이전트 대화 문구 제거)
    title_from_content, blog_content = _extract_blog_content(reply)

    # [ARTIFACT] 블록 title 보조 사용 (# 제목이 없을 때 fallback)
    parsed = _parse_block(reply)
    artifact_title = (parsed or {}).get("title", "").strip()
    title = title_from_content or artifact_title or "블로그 포스팅"

    # 태그 추출 (#태그 형식 줄)
    tags: list[str] = []
    for line in blog_content.splitlines():
        s = line.strip()
        if _re.match(r"^(#[\w가-힣A-Za-z]+\s*)+$", s):
            tags = _re.findall(r"#([\w가-힣A-Za-z]+)", s)
            break

    try:
        from app.services.naver_blog import upload_post
        post_url = await upload_post(
            account_id=account_id,
            title=title,
            content=blog_content,
            tags=tags,
            image_urls=image_urls or [],
        )
        if post_url:
            return f"✅ 네이버 블로그에 업로드했어요!\n\n[🔗 블로그에서 확인하기]({post_url})"
        return "✅ 네이버 블로그에 업로드했어요!"
    except ImportError:
        return "⚠️ playwright가 설치되지 않았습니다. `pip install playwright && playwright install chromium`을 실행해 주세요."
    except Exception as e:
        err = str(e)
        if "naver_login_setup" in err or "쿠키" in err or "cookie" in err.lower():
            return (
                "⚠️ 네이버 블로그 자동 업로드를 사용하려면 최초 1회 로그인 설정이 필요해요.\n\n"
                "터미널에서 아래 명령어를 실행해 주세요:\n"
                "```\ncd backend\npython -m app.services.naver_login_setup\n```\n"
                "브라우저가 열리면 네이버에 로그인 후 터미널에서 엔터를 누르면 설정이 완료됩니다."
            )
        if "세션 만료" in err:
            return (
                "⚠️ 네이버 로그인 세션이 만료됐어요. 아래 명령어로 다시 로그인해 주세요:\n"
                "```\ncd backend\npython -m app.services.naver_login_setup\n```"
            )
        return f"⚠️ 네이버 블로그 업로드 중 오류가 발생했어요: {e}"
