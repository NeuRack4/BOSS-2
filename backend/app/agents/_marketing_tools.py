"""Marketing DeepAgent 도구 모음.

Terminal: write_sns_post, write_blog_post, write_review_reply, write_ad_copy,
          write_event_plan, write_campaign, write_notice, write_marketing_plan,
          write_product_post, ask_user
Result store: init_marketing_result_store / get_marketing_result_store / get_marketing_extra
"""
from __future__ import annotations

import logging
from contextvars import ContextVar
from langchain_core.tools import tool

log = logging.getLogger("boss2.marketing_tools")

_marketing_result: ContextVar[dict | None] = ContextVar("marketing_result", default=None)
_marketing_extra: ContextVar[dict] = ContextVar("marketing_extra", default={})


def init_marketing_result_store(extra: dict | None = None) -> dict:
    """요청 시작 시 호출 — 빈 dict로 초기화하고 반환."""
    store: dict = {}
    _marketing_result.set(store)
    _marketing_extra.set(extra or {})
    return store


def get_marketing_result_store() -> dict | None:
    return _marketing_result.get(None)


def get_marketing_extra() -> dict:
    return _marketing_extra.get({})


@tool
def write_sns_post(
    title: str,
    caption: str,
    hashtags_json: str,
    platform: str = "instagram",
    best_time: str = "",
    sub_domain: str = "Social",
) -> str:
    """[TERMINAL] SNS 피드 게시물(캡션+해시태그)을 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 게시물 제목 (예: "봄 신메뉴 출시 인스타그램 포스트")
    caption: 완성된 SNS 캡션 본문 (이모지 포함, 줄바꿈 포함)
    hashtags_json: 해시태그 목록 JSON 문자열 (예: '["신메뉴", "맛집", "foodstagram"]', # 기호 제외)
    platform: 플랫폼 (instagram | facebook | thread). 기본 instagram
    best_time: 추천 게시 시간 (예: "💡 추천 게시 시간: 오후 12~1시")
    sub_domain: 서브허브 이름 (Social | Blog | Campaigns | Events | Reviews). 기본 Social
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_sns_post"
        store["title"] = title
        store["caption"] = caption
        store["hashtags_json"] = hashtags_json
        store["platform"] = platform
        store["best_time"] = best_time
        store["sub_domain"] = sub_domain
    return "SNS 게시물이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_blog_post(
    title: str,
    content: str,
    tags_json: str = "[]",
    sub_domain: str = "Blog",
) -> str:
    """[TERMINAL] 네이버 블로그 포스트를 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 블로그 포스트 제목 (이모지 포함 가능, 25자 이내)
    content: 완성된 블로그 본문 마크다운 (# 제목→소제목들→마무리 구조, 태그줄 포함)
    tags_json: 태그 목록 JSON 문자열 (예: '["맛집", "카페", "서울카페"]', # 기호 제외)
    sub_domain: 서브허브 이름. 기본 Blog
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_blog_post"
        store["title"] = title
        store["content"] = content
        store["tags_json"] = tags_json
        store["sub_domain"] = sub_domain
    return "블로그 포스트가 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_review_reply(
    reply_text: str,
    sub_domain: str = "Reviews",
    star_rating: int | None = None,
    platform: str | None = None,
) -> str:
    """[TERMINAL] 고객 리뷰 답글을 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    reply_text: 완성된 리뷰 답글 본문 (100~150자, 제목·레이블 없이 본문만)
    sub_domain: 서브허브 이름. 기본 Reviews
    star_rating: 리뷰 별점 (1~5, 없으면 생략)
    platform: 플랫폼 (예: 네이버, 카카오, 구글)
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_review_reply"
        store["reply_text"] = reply_text
        store["star_rating"] = star_rating
        store["platform"] = platform
        store["sub_domain"] = sub_domain
    return "리뷰 답글이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_ad_copy(
    title: str,
    content: str,
    channel: str | None = None,
    target: str | None = None,
    sub_domain: str = "Campaigns",
) -> str:
    """[TERMINAL] 광고 카피·배너 문구를 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 광고 카피 제목 (예: "스프링 신메뉴 네이버 검색광고 카피")
    content: 완성된 광고 카피 본문 (3~5안)
    channel: 광고 채널 (예: 네이버 검색광고, 인스타그램 피드)
    target: 타겟 고객 (예: 20대 여성)
    sub_domain: 서브허브 이름. 기본 Campaigns
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_ad_copy"
        store["title"] = title
        store["content"] = content
        store["channel"] = channel
        store["target"] = target
        store["sub_domain"] = sub_domain
    return "광고 카피가 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_event_plan(
    title: str,
    content: str,
    event_type: str,
    start_date: str,
    end_date: str | None = None,
    due_date: str | None = None,
    sub_domain: str = "Events",
) -> str:
    """[TERMINAL] 이벤트·프로모션 기획안을 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    start_date/end_date 또는 due_date를 저장해 D-7/D-3/D-1/D-0 알림이 자동 발송됩니다.

    title: 이벤트명 (예: "봄맞이 할인 이벤트")
    content: 완성된 기획안 본문 마크다운 (HTML 절대 포함 금지)
    event_type: 이벤트 종류 (예: 할인, 증정, SNS 이벤트)
    start_date: 시작일 YYYY-MM-DD
    end_date: 종료일 YYYY-MM-DD (기간 행사, 없으면 생략)
    due_date: 단일 행사일 YYYY-MM-DD (하루 행사, 없으면 생략)
    sub_domain: 서브허브 이름. 기본 Events
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_event_plan"
        store["title"] = title
        store["content"] = content
        store["event_type"] = event_type
        store["start_date"] = start_date
        store["end_date"] = end_date
        store["due_date"] = due_date
        store["sub_domain"] = sub_domain
    return "이벤트 기획안이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_campaign(
    title: str,
    content: str,
    start_date: str,
    end_date: str,
    goal: str | None = None,
    channels_json: str = "[]",
    sub_domain: str = "Campaigns",
) -> str:
    """[TERMINAL] 마케팅 캠페인 기획을 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 캠페인명
    content: 완성된 캠페인 기획서 본문 마크다운
    start_date: 캠페인 시작일 YYYY-MM-DD
    end_date: 캠페인 종료일 YYYY-MM-DD
    goal: 목표 KPI (선택)
    channels_json: 활용 채널 목록 JSON 문자열 (예: '["인스타그램", "네이버 블로그"]')
    sub_domain: 서브허브 이름. 기본 Campaigns
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_campaign"
        store["title"] = title
        store["content"] = content
        store["start_date"] = start_date
        store["end_date"] = end_date
        store["goal"] = goal
        store["channels_json"] = channels_json
        store["sub_domain"] = sub_domain
    return "캠페인 기획이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_notice(
    title: str,
    content: str,
    notice_type: str,
    date: str | None = None,
    sub_domain: str = "Social",
) -> str:
    """[TERMINAL] 공지사항을 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 공지 제목 (📢 이모지로 시작 권장)
    content: 완성된 공지 본문 (제목+본문+마무리 인사 포함)
    notice_type: 공지 종류 (임시휴무 | 영업시간 변경 | 이벤트 안내 | 신상품 출시)
    date: 날짜/시간 정보 (선택)
    sub_domain: 서브허브 이름. 기본 Social
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_notice"
        store["title"] = title
        store["content"] = content
        store["notice_type"] = notice_type
        store["date"] = date
        store["sub_domain"] = sub_domain
    return "공지사항이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_marketing_plan(
    title: str,
    content: str,
    period: str = "이번 달",
    sub_domain: str = "Social",
) -> str:
    """[TERMINAL] 마케팅 플랜·캘린더를 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 플랜 제목 (예: "5월 마케팅 캘린더")
    content: 완성된 마케팅 플랜 본문 마크다운
    period: 기준 기간 (예: "이번 달", "이번 주", "2026년 5월")
    sub_domain: 서브허브 이름. 기본 Social
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_marketing_plan"
        store["title"] = title
        store["content"] = content
        store["period"] = period
        store["sub_domain"] = sub_domain
    return "마케팅 플랜이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def write_product_post(
    title: str,
    content: str,
    caption: str = "",
    hashtags_json: str = "[]",
    product: str = "",
    sub_domain: str = "Social",
) -> str:
    """[TERMINAL] 상품·서비스 소개 게시글을 저장합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.

    title: 게시글 제목
    content: 완성된 상품 소개 게시글 전체 본문 (인스타 캡션 + 상세 설명 + 가격 안내 + 해시태그)
    caption: 인스타그램 캡션 부분만 (Instagram 카드용, 없으면 content에서 자동 추출)
    hashtags_json: 해시태그 목록 JSON 문자열 (예: '["신메뉴", "맛집"]', # 기호 제외)
    product: 소개할 상품·서비스명 (선택)
    sub_domain: 서브허브 이름. 기본 Social
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "write_product_post"
        store["title"] = title
        store["content"] = content
        store["caption"] = caption
        store["hashtags_json"] = hashtags_json
        store["product"] = product
        store["sub_domain"] = sub_domain
    return "상품 소개 게시글이 저장됩니다. 추가 도구 호출 없이 종료하세요."


@tool
def ask_user(question: str) -> str:
    """[TERMINAL] 사용자에게 추가 정보를 요청합니다.
    이 도구를 호출하면 대화가 종료됩니다 — 이후 추가 도구를 호출하지 마세요.
    [CHOICES] 블록을 포함해 선택지를 제시할 수 있습니다.

    question: 사용자에게 전달할 질문 문구 ([CHOICES]...[/CHOICES] 포함 가능)
    """
    store = _marketing_result.get(None)
    if store is not None:
        store["action"] = "ask_user"
        store["question"] = question
    return "사용자에게 질문을 전달합니다. 추가 도구 호출 없이 종료하세요."


MARKETING_TOOLS = [
    write_sns_post,
    write_blog_post,
    write_review_reply,
    write_ad_copy,
    write_event_plan,
    write_campaign,
    write_notice,
    write_marketing_plan,
    write_product_post,
    ask_user,
]

MARKETING_TERMINAL_TOOL_NAMES = {
    "write_sns_post",
    "write_blog_post",
    "write_review_reply",
    "write_ad_copy",
    "write_event_plan",
    "write_campaign",
    "write_notice",
    "write_marketing_plan",
    "write_product_post",
    "ask_user",
}
