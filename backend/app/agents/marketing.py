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
from app.core.llm import chat_completion
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
    pick_sub_hub_id,
    pick_main_hub_id,
    record_artifact_for_focus,
)
from app.agents._marketing_knowledge import marketing_knowledge_context
from langsmith import traceable
import re as _re
import json as _json

_NAVER_UPLOAD_RE = _re.compile(r"\[NAVER_UPLOAD\]", _re.IGNORECASE)
_INSTAGRAM_POST_RE = _re.compile(
    r"\[\[INSTAGRAM_POST\]\]([\s\S]*?)\[\[/INSTAGRAM_POST\]\]"
)


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

SYSTEM_PROMPT = (
    """당신은 소상공인 마케팅 전문 AI 에이전트입니다.
카페, 음식점, 책방, 만화방, 의류점, 뷰티샵, 학원 등 모든 업종의 마케팅을 담당합니다.
사용자 프로필(업종·상호·위치·주 채널·목표)을 최대한 활용해 맞춤형 콘텐츠를 작성합니다.

가능한 작업:
- sns_post: 인스타그램·SNS 포스트 (캡션 + 해시태그 + 게시 시간 추천)
- blog_post: 네이버 블로그 포스팅 (마크다운 형식, 소제목 구조)
- ad_copy: 광고 카피 및 홍보 문구
- marketing_plan: 주별·월별 마케팅 캘린더
- event_plan: 이벤트·프로모션 기획안
- campaign: 기간성 광고 캠페인 기획
- review_reply: 플레이스·리뷰 답글 (별점별 톤 자동 조절)
- notice: 공지사항 (임시휴무·영업시간변경·이벤트·신상품 등)
- product_post: 상품·서비스 소개 게시글

허용 type: sns_post | blog_post | ad_copy | marketing_plan | event_plan | campaign | review_reply | notice | product_post | schedule_post
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
    + ARTIFACT_RULE
    + CLARIFY_RULE
    + NICKNAME_RULE
    + PROFILE_RULE
    + """
[결과물 저장 강화 규칙]
- 대화를 통해 타입별 필수 필드를 모두 확인했다면, 그 턴에 반드시 완성된 결과물 + [ARTIFACT] 블록을 출력한다.
- 결과물을 작성한 뒤 "추가로 궁금하신 점", "사업 단계가 어떻게 되세요" 같은 후속 질문을 덧붙이지 않는다.
- 예외: 결과물 없이 순수 질문만 하는 턴은 가능. 단 그 턴에는 결과물 내용도 쓰지 않는다.

[sub_domain 매핑 가이드 — 반드시 아래 기준으로 선택]
- sns_post / product_post → Social
- blog_post              → Blog
- ad_copy / campaign     → Campaigns
- event_plan             → Events
- review_reply           → Reviews
- marketing_plan / notice → Social (가장 가까운 허브 선택)
시스템 컨텍스트의 "이 계정의 marketing 서브허브" 목록에 위 이름이 있으면 반드시 해당 이름으로 sub_domain 을 채운다.

[네이버 블로그 자동 업로드 규칙]
당신은 네이버 블로그에 직접 자동 업로드할 수 있습니다. 사용자에게 "직접 복사해서 붙여넣으세요"라고 안내하지 마세요.

사용자가 블로그 포스팅 작성과 함께 네이버 블로그 업로드/게시를 요청한 경우:
1. blog_post 형식으로 포스팅을 작성하고 [ARTIFACT] 블록을 정상 출력한다.
2. 응답의 맨 마지막 줄에 반드시 [NAVER_UPLOAD] 를 단독으로 출력한다. (다른 텍스트 없이)
3. "업로드해드릴게요", "자동 업로드됩니다" 등의 안내 문구를 본문에 자연스럽게 포함한다.

절대 하지 말아야 할 것:
- "직접 복사해서 붙여넣으세요"라고 안내하는 것
- blog_post 타입이 아닌 경우(sns_post 등)에 [NAVER_UPLOAD] 출력
- 업로드 요청이 없을 때 [NAVER_UPLOAD] 출력

작성 원칙:
- 프로필에 업종·가게명·위치 정보가 있으면 반드시 반영해 맞춤형으로 작성
- 없는 수치(매출·방문자 수·실적 등)는 절대 만들어내지 않음
- 실용적이고 바로 복사해 사용할 수 있는 한국어로 작성
- 과장 없이 진정성 있는 목소리 유지

예시 (채널 확인 시):
"어떤 채널에 올리실 건가요?
[CHOICES]
인스타그램 피드
인스타그램 스토리
네이버 블로그
기타 (직접 입력)
[/CHOICES]"

[인스타그램 피드 즉시 생성 규칙]
사용자가 이미 캡션·해시태그·게시 시간을 제공했거나, "인스타 피드", "인스타그램 피드", "sns 게시물"을 명시적으로 요청한 경우:
- CHOICES 로 채널을 다시 묻지 말 것
- 바로 sns_post 타입 결과물을 완성해 출력하고 [ARTIFACT] 블록 포함
- 캡션은 사용자 제공 내용을 그대로 반영 (개선·수정 시 알림)
- 해시태그는 '#태그1 #태그2 ...' 형식으로 한 줄에 붙여 출력
- 추천 게시 시간은 '💡 추천 게시 시간: ...' 형식으로 출력
"""
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
    synthetic = (
        "SNS 피드 게시물(sns_post) 을 작성해주세요. 추가 질문 없이 바로 완성된 캡션 + 해시태그 + 추천 게시 시간을 출력하고, "
        "[ARTIFACT] 블록(type=sns_post) 으로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    reply = await run(synthetic, account_id, history, rag_context, long_term_context)

    # Instagram 플랫폼 선택 시에만 카드 생성
    _needs_instagram = (
        "instagram" in platform.lower()
        or "인스타" in platform.lower()
    )
    if _needs_instagram and "[[INSTAGRAM_POST]]" not in reply:
        from app.agents._artifact import _parse_block
        caption, hashtags, best_time = _extract_sns_content(reply)
        if not caption:
            caption = topic
        if not hashtags:
            hashtags = [topic.replace(" ", ""), "신메뉴", "맛집", "foodstagram", "instafood"]
        image_url = await _generate_sns_image(caption, hashtags)
        parsed = _parse_block(reply) or {}
        payload = {
            "title": parsed.get("title", topic),
            "caption": caption,
            "hashtags": hashtags,
            "best_time": best_time,
            "image_url": image_url,
        }
        reply += f"\n\n[[INSTAGRAM_POST]]{_json.dumps(payload, ensure_ascii=False)}[[/INSTAGRAM_POST]]"

    return reply


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
    lines = [f"[주제] {topic}"]
    if keywords:
        lines.append(f"[주요 키워드] {', '.join(keywords)}")
    if image_urls:
        lines.append(f"[첨부 이미지 URL] {', '.join(image_urls)}")
    if _preceding_reply:
        lines.append(f"[참고 기획안 (앞 단계 결과)]\n{_preceding_reply[:1200]}")
    if auto_upload:
        lines.append("[네이버 블로그 자동 업로드] 요청됨")
    synthetic = (
        "네이버 블로그 포스트(blog_post) 를 작성해주세요. 마크다운 형식으로 제목·본문·해시태그 완성. "
        + ("완성 후 [NAVER_UPLOAD] 마커를 맨 마지막에 단독으로 출력해 자동 업로드." if auto_upload else "")
        + "\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    reply = await run(synthetic, account_id, history, rag_context, long_term_context, image_urls=image_urls, allow_naver_upload=auto_upload)

    # 네이버 블로그 미리보기 카드 마커 추가
    if "[[NAVER_BLOG_POST]]" not in reply:
        preview = await _maybe_naver_blog_preview(reply, image_urls)
        reply += preview

    return reply


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
    lines = [f"[리뷰 본문] {review_text}"]
    if star_rating is not None:
        lines.append(f"[별점] {star_rating}")
    if platform:
        lines.append(f"[플랫폼] {platform}")
    synthetic = (
        "고객 리뷰에 대한 사장님 답글(review_reply) 을 작성해주세요. 150자 내외, 진심 어린 톤. "
        "[ARTIFACT] 블록(type=review_reply) 으로 저장하세요.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


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
    lines = [f"[광고 대상 상품/서비스] {product}"]
    if channel:
        lines.append(f"[채널] {channel}")
    if target:
        lines.append(f"[타겟] {target}")
    if key_benefit:
        lines.append(f"[핵심 혜택] {key_benefit}")
    synthetic = (
        "광고 카피(ad_copy) 를 작성해주세요. 3~5안으로 짧게. [ARTIFACT] 블록(type=ad_copy) 으로 저장.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


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
    synthetic = (
        f"'{title}' 캠페인(campaign) 기획서를 작성해주세요. "
        "[ARTIFACT] 블록(type=campaign, start_date, end_date, due_label='캠페인 종료') 으로 저장.\n"
        + "\n".join(lines)
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


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
    synthetic = (
        f"'{title}' 이벤트/프로모션 기획안(event_plan) 을 작성해주세요. "
        "[ARTIFACT] 블록(type=event_plan, start_date, "
        + ("end_date, due_label='이벤트 종료'" if end_date else "due_date, due_label='이벤트 당일'")
        + ") 으로 저장하세요.\n"
        + "\n".join(lines)
        + """

[출력 형식 — 반드시 아래 구조로 작성]
이모지 사용 금지. 대괄호 라벨([이벤트명] 등) 헤더 사용 금지.
마크다운 굵은 글씨(**텍스트**)와 bullet(-) 만 사용. 간결하고 실용적으로.

**이벤트 소개** (1~2문장, 핵심 콘셉트)

**기간** : 날짜 ~ 날짜

**혜택**
- 혜택 항목 1
- 혜택 항목 2

**홍보 계획** (2~3줄)

**준비 체크리스트**
- [ ] 항목 1
- [ ] 항목 2
- [ ] 항목 3
"""
        + f"\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


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
    lines = [
        f"[공지 종류] {notice_type}",
        f"[핵심 내용] {content}",
    ]
    if date:
        lines.append(f"[날짜/시간] {date}")

    sns_instruction = ""
    if publish_sns:
        sns_instruction = (
            "\n\n공지 작성 후, 같은 내용을 인스타그램에 바로 올릴 수 있도록 "
            "SNS 캡션(3~4문장) + 해시태그(15~20개) + 💡 추천 게시 시간 형식으로도 작성해주세요. "
            "SNS 버전은 [ARTIFACT] 블록 없이 공지 하단에 바로 붙여 출력하세요."
        )

    synthetic = (
        f"{notice_type} 공지사항(notice) 을 작성해주세요. "
        "짧고 명확하게, 핵심 정보만 담아서. "
        "[ARTIFACT] 블록(type=notice) 으로 저장하세요.\n"
        + "\n".join(lines)
        + sns_instruction
        + f"\n\n원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


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
        ig_report(days=period),
        yt_report(account_id=account_id, days=period),
        return_exceptions=True,
    )

    if isinstance(ig_data, Exception):
        ig_data = {"error": str(ig_data)}
    if isinstance(yt_data, Exception):
        yt_data = {"error": str(yt_data)}

    ig_ok = "error" not in ig_data
    yt_ok = "error" not in yt_data.get("channel", {})

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

    # GPT-4o로 인사이트 분석
    analysis_prompt = (
        f"소상공인 마케팅 성과 데이터를 분석해서 실질적인 인사이트를 제공해주세요.\n\n"
        f"{data_summary}\n\n"
        "다음 3가지를 간결하게 작성해주세요:\n"
        "1. 이번 기간 성과 요약 (2~3줄)\n"
        "2. 잘된 점 + 개선 포인트 (각 1~2가지)\n"
        "3. 다음 기간 추천 액션 (2~3가지, 구체적으로)\n\n"
        "소상공인 입장에서 쉽게 이해할 수 있는 언어로 작성하세요."
    )

    try:
        resp = await chat_completion(
            messages=[{"role": "user", "content": analysis_prompt}],
            model="gpt-4o",
            temperature=0.4,
        )
        analysis = resp.choices[0].message.content or "분석 데이터를 불러올 수 없습니다."
    except Exception:
        analysis = "분석 중 오류가 발생했습니다."

    # [[MARKETING_REPORT]] 마커 생성
    report_payload = {
        "period_days": period,
        "instagram": ig_data if ig_ok else {"error": ig_data.get("error")},
        "youtube": yt_data if yt_ok else {"error": yt_data.get("channel", {}).get("error")},
        "analysis": analysis,
    }
    marker = f"\n\n[[MARKETING_REPORT]]{_json.dumps(report_payload, ensure_ascii=False)}[[/MARKETING_REPORT]]"

    # artifact 저장용 응답 조합
    reply_lines = [f"최근 {period}일 마케팅 성과 리포트를 생성했습니다.\n"]
    reply_lines.append(analysis)
    reply_lines.append(
        f"\n[ARTIFACT]\ntitle: 마케팅 성과 리포트 ({period}일)\ntype: marketing_report\ndomains: [marketing]\n[/ARTIFACT]"
    )
    reply_lines.append(marker)

    return "\n".join(reply_lines)


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
                "인스타 자동 게시 요청 시 mkt_sns_post(depends_on: mkt_event_plan) 을 함께 dispatch."
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
            "name": "mkt_schedule_post",
            "description": (
                "마케팅 작업을 정기 자동 실행하는 스케줄을 등록한다. "
                "'매주', '매일', '자동으로', '정기적으로', '스케줄', '예약' 키워드와 함께 "
                "SNS 게시물·블로그·광고 카피 등 반복 작업 요청 시 호출."
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


# ──────────────────────────────────────────────────────────────────────────
# 메인 run (legacy fallback 겸 capability wrapper 타겟)
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
    system = SYSTEM_PROMPT + "\n\n" + today_context()

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

    # 지식베이스 (지원사업 + 법령) 컨텍스트 주입
    knowledge_ctx = await marketing_knowledge_context(message)
    if knowledge_ctx:
        system += f"\n\n{knowledge_ctx}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content

    # ── 디버그 로그 (artifact 저장 여부 추적) ──────────────────────────────
    import logging as _logging
    _log = _logging.getLogger("boss.marketing")
    _log.info(
        "[marketing.run] account=%s | has_ARTIFACT=%s | has_CHOICES=%s | preview=%s",
        account_id,
        "[ARTIFACT]" in reply,
        "[CHOICES]" in reply,
        reply[:120].replace("\n", " "),
    )
    # ────────────────────────────────────────────────────────────────────────

    # [NAVER_UPLOAD] 마커 감지 → allow_naver_upload=True일 때만 실제 업로드
    wants_naver_upload = allow_naver_upload and bool(_NAVER_UPLOAD_RE.search(reply))
    reply = _NAVER_UPLOAD_RE.sub("", reply).rstrip()

    artifact_id = await save_artifact_from_reply(
        account_id,
        "marketing",
        reply,
        default_title="마케팅 자료",
        valid_types=VALID_TYPES,
    )

    if wants_naver_upload:
        reply += "\n\n" + await _try_naver_upload(reply, image_urls=image_urls)
    else:
        review_marker = _maybe_review_reply_card(reply)
        if review_marker:
            reply += review_marker
            _patch_artifact_meta_from_marker(
                artifact_id, review_marker, r"\[\[REVIEW_REPLY\]\]([\s\S]*?)\[\[/REVIEW_REPLY\]\]",
            )
        else:
            instagram_marker = await _maybe_instagram_preview(reply)
            if instagram_marker:
                reply += instagram_marker
                _patch_artifact_meta_from_marker(
                    artifact_id, instagram_marker, r"\[\[INSTAGRAM_POST\]\]([\s\S]*?)\[\[/INSTAGRAM_POST\]\]",
                )

    return reply


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


async def _try_naver_upload(reply: str, image_urls: list[str] | None = None) -> str:
    """blog_post 본문을 파싱해 네이버 블로그에 업로드. 결과 문자열 반환."""
    import os as _os
    from app.core.config import settings
    from app.agents._artifact import _parse_block

    if not settings.naver_blog_id or not settings.naver_blog_pw:
        return "📌 네이버 블로그 자동 업로드를 사용하려면 `.env`에 `NAVER_BLOG_ID`와 `NAVER_BLOG_PW`를 설정해 주세요."

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

    # 이미지: 사용자 첨부 이미지 URL을 그대로 전달 (다운로드 불필요)

    try:
        from app.services.naver_blog import upload_post
        post_url = await upload_post(
            blog_id=settings.naver_blog_id,
            blog_pw=settings.naver_blog_pw,
            title=title,
            content=blog_content,
            tags=tags,
            image_urls=image_urls or [],
        )
        if post_url:
            return f"✅ 네이버 블로그에 업로드했어요!\n🔗 {post_url}"
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
