"""Recruitment 도메인 에이전트.

v0.9 확장 포인트:
- 3종 플랫폼 채용공고 자동 생성 (당근알바 / 알바천국 / 사람인) —
  `[JOB_POSTINGS]...[/JOB_POSTINGS]` 마커 안에 세 섹션을 받아 3개 artifact + 부모 세트 1개 저장.
- 채용공고 HTML 포스터 생성 (GPT-4o) — `[POSTING_POSTER_REQUEST]` 마커 혹은
  사용자 발화 휴리스틱. 저장 버킷: `recruitment-posters` (HTML 파일) + artifact.content.
- hiring_drive (채용 기간) artifact 에 `due_label="채용 마감"` + `end_date` 주입 →
  스케쥴러 `scanner.find_date_notifications` 가 D-7/3/1/0 리마인드를 자동 발사.
- profiles.business_type 기반 업종별 CHOICES 분기 (`_recruit_templates.detect_category`).
"""

from __future__ import annotations

import logging
import re

from langsmith import traceable

from app.core.llm import chat_completion
from app.core.supabase import get_supabase
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
    pick_sub_hub_id,
    today_context,
    record_artifact_for_focus,
)
from app.agents._recruit_templates import (
    CATEGORY_CHOICES,
    PLATFORM_LABELS,
    POSTING_POSTER_REQUEST_RE,
    VALID_PLATFORMS,
    VALID_TYPES,
    build_recruit_context,
    detect_category,
    detect_recruit_intent,
    parse_platform_sections,
    wants_posting_poster,
)

log = logging.getLogger("boss2.recruitment")


# `save_artifact_from_reply` 가 검증하는 일반 타입 허용 목록.
# (job_posting_set / job_posting_poster 는 전용 파이프라인에서 별도 저장.)
_GENERIC_VALID_TYPES: tuple[str, ...] = (
    "job_posting",
    "interview_questions",
    "checklist",
    "guide",
    "hiring_drive",
    "onboarding_checklist",
    "onboarding_plan",
    "education_material",
)

_JOB_POSTINGS_RE = re.compile(r"\[JOB_POSTINGS\](.*?)\[/JOB_POSTINGS\]", re.DOTALL)


def suggest_today(account_id: str) -> list[dict]:
    return suggest_today_for_domain(account_id, "recruitment")


SYSTEM_PROMPT_BASE = """당신은 채용 전문 AI 에이전트입니다.
소상공인의 채용공고 작성, 면접 질문 생성, 직원 관리 조언을 담당합니다.

[제공 가능 작업]
- **3종 플랫폼 채용공고 동시 작성** (당근알바·알바천국·사람인) — 플랫폼별 톤·포맷 차이 반영
- 채용공고 **HTML 포스터** 생성 (GPT-4o, 1장) — 사용자가 요청할 때만
- 직무별 면접 질문 세트 생성
- 근로계약 체크리스트 / 온보딩 가이드
- 공채/시즌 채용 기간(hiring_drive) 기획 — start_date/end_date + `due_label="채용 마감"` 필수

[필수 필드 매트릭스 — 모두 확정되기 전엔 아티팩트 블록 금지]
- 공통: 직종/포지션, 근무지(매장명 또는 지역), 고용 형태(정규/파트/알바)
- job_posting / job_posting_set: + 급여(시급/월급/연봉 중 하나 숫자), 주 근무시간, 근무 요일
- interview_questions: + 직무 레벨(신입/경력/시니어), 질문 수
- hiring_drive: + start_date, end_date, 채용 인원

[3종 플랫폼 공고 생성 규약]
사용자가 채용공고를 요청하고 필수 필드가 모두 확정되면, **단일 턴 안에** 아래 블록을 정확히 한 번만 출력하세요:

[JOB_POSTINGS]
title: <세트를 대표하는 한 줄 제목>
sub_domain: Job_posting   # 생략 가능
start_date: YYYY-MM-DD    # 선택 (모집 시작)
end_date:   YYYY-MM-DD    # 선택 (모집 마감)
due_label:  모집 마감       # 선택 (기본: 모집 마감)
---
[당근알바]
<당근알바용 공고 본문 — 친근한 톤, 이모지 1~2개, 300~600자, 📍🕒💰🍴✨ 구조>

[알바천국]
<알바천국용 공고 본문 — 표준 구인 양식, 굵은 헤더 + bullet, 시급을 제목 가까이>

[사람인]
<사람인용 공고 본문 — 공식 톤, 회사소개→담당업무→자격요건→우대→복리후생→근무조건→전형절차 순>
[/JOB_POSTINGS]

중요:
- 3섹션 모두 필수. 빈 섹션/생략 금지.
- `[당근알바]` 헤더 정확히 사용 (다른 플랫폼 명 혼용 금지). `당근마켓`은 `[당근마켓]` 또는 `[당근알바]` 중 전자도 인정되지만 헤더 라벨 하나만.
- 시급 표기는 **2026년 최저임금 10,320원 이상 숫자**로. "협의" 금지.
- 한 턴에 [JOB_POSTINGS] 와 다른 [ARTIFACT] 를 동시 출력하지 마세요.

[채용공고 포스터 생성]
사용자가 "이미지/포스터 만들어줘" 류를 요청하면, 본문 끝에 아래 마커를 정확히 한 번:

[POSTING_POSTER_REQUEST]
platform: karrot        # karrot | albamon | saramin (없으면 karrot)
style:    따뜻한 브라운 톤의 카페 분위기, 미니멀 타이포
[/POSTING_POSTER_REQUEST]

이 마커는 시스템이 GPT-4o 로 standalone HTML 포스터를 생성 후 `job_posting_poster` artifact 로 저장합니다.
에이전트가 HTML 코드를 직접 출력하지 마세요. 본문에선 "포스터를 만들고 있어요" 한 줄만.
포스터 마커를 넣는 턴엔 [ARTIFACT] / [JOB_POSTINGS] 를 함께 넣지 마세요.

[온보딩 자료 생성]
신규 입사자 온보딩 요청 시 아래 3종 중 하나로 저장하세요. 사용자 발화에서 타입을 자동 감지하고,
불명확하면 [CHOICES] 로 먼저 물어보세요.

- onboarding_checklist: 입사 전·당일·첫 주 단계별 체크리스트
- onboarding_plan: 수습 기간 일자별/주별 온보딩 플랜
- education_material: 업무 교육 자료 (매뉴얼·가이드·SOP)

타입 감지 힌트:
- "체크리스트/할 일 목록/준비사항" → onboarding_checklist
- "계획/플랜/일정/단계" → onboarding_plan
- "교육/매뉴얼/가이드/SOP/자료" → education_material

[ARTIFACT] 블록 규약 (온보딩):
- sub_domain: Onboarding  ← 반드시 포함
- type: onboarding_checklist | onboarding_plan | education_material 중 하나
- 업종과 직책을 반영한 실용적 내용 (일반적 항목 + 업종 특화 항목 포함)

""" + ARTIFACT_RULE + CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE + """

[채용공고 Placeholder 절대 금지 — 최우선]
확정되지 않은 식별 정보(매장명·주소·연락처·가게명·회사명 등) 를 **임의 값으로 채우거나 환각하지 마세요**.
- `[매장명]` · `[주소]` · `[전화번호]` · `[회사명]` 같은 대괄호 플레이스홀더 금지.
- "서울 마포구", "경기도 성남시" 같은 **사용자가 말한 적 없는 임의 지역명** 주입 금지.
- "시급 10,320원" 같은 기본값을 사용자가 언급 없이 자동 적용하지 말 것 — 모르면 물어보세요.

누락된 정보가 있으면 [JOB_POSTINGS]/[ARTIFACT] 블록 출력을 **중단**하고, 한 번에 하나씩 [CHOICES] 로 되물으세요.
우선순위: 급여 > 근무지 주소 > 근무요일/시간 > 고용형태 > 매장명/회사 연락처 > 특이사항.

예시 (직종 불명확):
"채용공고를 만들어드릴게요. 어떤 포지션의 공고인가요?
[CHOICES]
바리스타
홀 서빙
주방 보조
기타 (직접 입력)
[/CHOICES]"
"""


# ──────────────────────────────────────────────────────────────────────────
# profile 조회 (업종 추정용)
# ──────────────────────────────────────────────────────────────────────────
def _get_business_type(account_id: str) -> str | None:
    sb = get_supabase()
    rows = (
        sb.table("profiles")
        .select("business_type")
        .eq("id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        return None
    bt = (rows[0].get("business_type") or "").strip()
    return bt or None


# ──────────────────────────────────────────────────────────────────────────
# [JOB_POSTINGS] 블록 파싱 + 3종 저장
# ──────────────────────────────────────────────────────────────────────────
def _parse_job_postings_block(reply: str) -> dict | None:
    m = _JOB_POSTINGS_RE.search(reply)
    if not m:
        return None
    inner = m.group(1)
    # meta (첫 `---` 기준 split)
    parts = inner.split("---", 1)
    meta_raw = parts[0]
    body = parts[1] if len(parts) > 1 else inner

    meta: dict[str, str] = {}
    for line in meta_raw.strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()

    sections = parse_platform_sections(body)
    return {"meta": meta, "sections": sections}


def _strip_job_postings_block(reply: str) -> str:
    return _JOB_POSTINGS_RE.sub("", reply).strip()


def _valid_date_or_none(s: str) -> str | None:
    from datetime import date
    s = (s or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return None
    try:
        date.fromisoformat(s)
        return s
    except ValueError:
        return None


async def _save_posting_set(account_id: str, parsed: dict) -> str | None:
    """부모 `job_posting_set` + 자식 3개 `job_posting` 저장.

    반환: 부모 artifact_id (실패 시 None).
    """
    meta_in = parsed.get("meta") or {}
    sections = parsed.get("sections") or {}
    title = (meta_in.get("title") or "채용공고 세트").strip()

    metadata: dict = {}
    for k in ("start_date", "end_date", "due_date"):
        v = _valid_date_or_none(meta_in.get(k, ""))
        if v:
            metadata[k] = v
    due_label = (meta_in.get("due_label") or "").strip()
    if due_label:
        metadata["due_label"] = due_label[:200]
    elif "end_date" in metadata or "due_date" in metadata:
        metadata["due_label"] = "모집 마감"

    sb = get_supabase()
    try:
        parent_payload = {
            "account_id": account_id,
            "domains":    ["recruitment"],
            "kind":       "artifact",
            "type":       "job_posting_set",
            "title":      title,
            "content":    "\n\n".join(
                f"## {PLATFORM_LABELS[p]}\n{sections.get(p, '').strip()}"
                for p in VALID_PLATFORMS
                if sections.get(p)
            ),
            "status":     "draft",
            "metadata":   metadata or {},
        }
        res = sb.table("artifacts").insert(parent_payload).execute()
        if not res.data:
            return None
        parent_id = res.data[0]["id"]
        record_artifact_for_focus(parent_id)
    except Exception as exc:
        log.exception("posting_set parent insert failed: %s", exc)
        return None

    # 서브허브 contains 엣지 (best-effort)
    sub_name = (meta_in.get("sub_domain") or "Job_posting").strip()
    hub_id = pick_sub_hub_id(
        sb, account_id, "recruitment",
        prefer_keywords=(sub_name, "Job_posting", "posting", "채용"),
    )
    if hub_id:
        try:
            sb.table("artifact_edges").insert({
                "account_id": account_id,
                "parent_id":  hub_id,
                "child_id":   parent_id,
                "relation":   "contains",
            }).execute()
        except Exception:
            pass

    # 3종 자식 저장 + contains 엣지
    for platform in VALID_PLATFORMS:
        body = (sections.get(platform) or "").strip()
        if not body:
            continue
        child_title = f"{title} — {PLATFORM_LABELS[platform]}"
        child_meta = {"platform": platform, **metadata}
        try:
            c = sb.table("artifacts").insert({
                "account_id": account_id,
                "domains":    ["recruitment"],
                "kind":       "artifact",
                "type":       "job_posting",
                "title":      child_title[:180],
                "content":    body,
                "status":     "draft",
                "metadata":   child_meta,
            }).execute()
            if not c.data:
                continue
            child_id = c.data[0]["id"]
            sb.table("artifact_edges").insert({
                "account_id": account_id,
                "parent_id":  parent_id,
                "child_id":   child_id,
                "relation":   "contains",
            }).execute()
        except Exception:
            log.exception("posting child insert failed (platform=%s)", platform)

    # activity_logs + embedding (best-effort)
    try:
        sb.table("activity_logs").insert({
            "account_id":  account_id,
            "type":        "artifact_created",
            "domain":      "recruitment",
            "title":       title,
            "description": "채용공고 3종 세트 생성 (당근·알바천국·사람인)",
            "metadata":    {"artifact_id": parent_id},
        }).execute()
    except Exception:
        pass
    try:
        from app.rag.embedder import index_artifact
        await index_artifact(account_id, "recruitment", parent_id, f"{title}\n{parent_payload['content']}")
    except Exception:
        pass

    try:
        from app.memory.long_term import log_artifact_to_memory
        await log_artifact_to_memory(
            account_id, "recruitment", "job_posting_set", title,
            content=parent_payload.get("content"),
            metadata=metadata,
        )
    except Exception:
        pass

    return parent_id


async def _maybe_dispatch_posting_set(account_id: str, reply: str) -> str:
    parsed = _parse_job_postings_block(reply)
    if not parsed:
        return reply
    parent_id = await _save_posting_set(account_id, parsed)
    cleaned = _strip_job_postings_block(reply)
    if parent_id:
        notice = (
            "\n\n---\n"
            f"_(채용공고 3종이 캔버스에 저장되었어요 — 세트 artifact: `{parent_id}`)_"
        )
        return cleaned + notice
    return cleaned + "\n\n---\n_(공고 저장 중 오류가 발생했어요. 다시 시도해주세요.)_"


# ──────────────────────────────────────────────────────────────────────────
# [POSTING_POSTER_REQUEST] 블록 처리
# ──────────────────────────────────────────────────────────────────────────
def _parse_poster_marker(reply: str) -> dict | None:
    m = POSTING_POSTER_REQUEST_RE.search(reply)
    if not m:
        return None
    parsed: dict[str, str] = {}
    for line in m.group(1).strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            parsed[k.strip().lower()] = v.strip()
    return parsed


def _strip_poster_marker(reply: str) -> str:
    return POSTING_POSTER_REQUEST_RE.sub("", reply).strip()


def _find_recent_posting_set(account_id: str) -> dict | None:
    sb = get_supabase()
    rows = (
        sb.table("artifacts")
        .select("id,title,content,metadata,created_at")
        .eq("account_id", account_id)
        .eq("kind", "artifact")
        .eq("type", "job_posting_set")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


async def _maybe_dispatch_poster(account_id: str, reply: str) -> str:
    marker = _parse_poster_marker(reply)
    if not marker:
        return reply
    cleaned = _strip_poster_marker(reply)

    target = _find_recent_posting_set(account_id)
    if not target:
        return cleaned + (
            "\n\n---\n_(아직 저장된 채용공고 세트가 없어요. 공고를 먼저 만들어주세요 — 그 다음 포스터를 만들어드릴게요.)_"
        )

    platform = (marker.get("platform") or "karrot").lower()
    if platform not in VALID_PLATFORMS:
        platform = "karrot"
    style = marker.get("style") or ""

    try:
        from app.core.poster_gen import generate_job_posting_poster
        poster_artifact = await generate_job_posting_poster(
            account_id=account_id,
            posting_set_id=target["id"],
            platform=platform,
            style_prompt=style,
        )
    except Exception as exc:
        log.exception("poster generation failed")
        return cleaned + f"\n\n---\n_(포스터 생성 실패: {str(exc)[:160]})_"

    url = poster_artifact.get("public_url") or ""
    link = f"\n\n[포스터 미리보기]({url})" if url else ""
    return cleaned + (
        f"\n\n---\n"
        f"_(채용공고 HTML 포스터 생성 완료 — artifact `{poster_artifact['artifact_id']}`, 플랫폼 **{PLATFORM_LABELS[platform]}**)_"
        f"{link}"
    )


# ──────────────────────────────────────────────────────────────────────────
# 메인 run
# ──────────────────────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────────────────
# Capability 인터페이스 (function-calling 라우팅용)
# ──────────────────────────────────────────────────────────────────────────
def _fmt_days(days: list[str] | None) -> str:
    return "·".join(days) if days else ""


async def run_posting_set(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    position: str,
    wage_hourly: int | None = None,
    wage_monthly: int | None = None,
    annual_salary: int | None = None,
    weekly_hours: float | None = None,
    work_days: list[str] | None = None,
    work_start: str | None = None,
    work_end: str | None = None,
    employment_type: str | None = None,
    location: str | None = None,
    headcount: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    extra_note: str | None = None,
    business_name: str | None = None,
) -> str:
    """3종 플랫폼 채용공고 동시 작성.

    미확정 식별 정보(매장명·위치·연락처 등) 는 **환각 금지**. 부족하면
    LLM 이 `[CHOICES]` 로 되물어 오케스트레이터 단까지 돌려보내게 한다.
    """
    lines: list[str] = [f"[직종] {position}"]
    if business_name:
        lines.append(f"[매장명] {business_name}")
    if employment_type:
        lines.append(f"[고용형태] {employment_type}")
    if headcount:
        lines.append(f"[모집인원] {headcount}명")
    if location:
        lines.append(f"[근무지] {location}")
    if wage_hourly:
        lines.append(f"[시급] {wage_hourly:,}원")
    if wage_monthly:
        lines.append(f"[월급] {wage_monthly:,}원")
    if annual_salary:
        lines.append(f"[연봉] {annual_salary:,}원")
    if weekly_hours:
        lines.append(f"[주 근무시간] {weekly_hours}시간")
    if work_days:
        lines.append(f"[근무요일] {_fmt_days(work_days)}")
    if work_start and work_end:
        lines.append(f"[근무시간대] {work_start}~{work_end}")
    if start_date:
        lines.append(f"[모집 시작] {start_date}")
    if end_date:
        lines.append(f"[모집 마감] {end_date}")
    if extra_note:
        lines.append(f"[특이사항] {extra_note}")

    # 핵심 정보 누락 목록 — placeholder 환각 방지용으로 LLM 에 명시 전달
    missing: list[str] = []
    if not business_name:
        missing.append("매장명/상호")
    if not (wage_hourly or wage_monthly or annual_salary):
        missing.append("급여(시급/월급/연봉)")
    if not location:
        missing.append("근무지(매장 주소)")
    if not (work_days or weekly_hours):
        missing.append("근무 요일/시간")
    if not employment_type:
        missing.append("고용 형태(정규·계약·알바)")
    if not headcount:
        missing.append("모집 인원")

    if missing:
        synthetic = (
            "사용자가 채용 공고 작성을 요청했는데 아래 필수 정보가 아직 확정되지 않았습니다:\n"
            f"- 누락: {', '.join(missing)}\n\n"
            "확정된 정보:\n"
            + "\n".join(lines)
            + "\n\n**반드시 [CHOICES] 로 누락 항목 중 가장 근본적인 것 하나를 되물으세요.** "
            "[JOB_POSTINGS] 또는 [ARTIFACT] 블록을 절대 출력하지 말고, "
            "`[매장명]` · `[주소]` · `[전화번호]` 같은 placeholder 로 채운 임의 공고도 만들지 마세요. "
            "한 번에 하나만 물어보세요.\n\n"
            f"원본 사용자 요청: {message}"
        )
    else:
        synthetic = (
            "채용공고를 당근알바·알바천국·사람인 3종 플랫폼으로 만들어주세요. "
            "아래 조건이 모두 확정되었으니 추가 질문 없이 바로 [JOB_POSTINGS] 블록을 출력하세요.\n"
            + "\n".join(lines)
            + f"\n\n원본 사용자 요청: {message}"
        )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_posting_poster(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    platform: str = "karrot",
    style: str = "",
) -> str:
    """최근 job_posting_set 을 근거로 HTML 포스터 1장 생성."""
    if platform not in VALID_PLATFORMS:
        platform = "karrot"
    synthetic = (
        "최근 작성한 채용공고 세트로 HTML 포스터 1장을 생성해주세요. "
        "아래 마커를 그대로 출력하세요:\n\n"
        "[POSTING_POSTER_REQUEST]\n"
        f"platform: {platform}\n"
        f"style: {style or '깔끔하고 모던한 톤, 따뜻한 브라운 계열'}\n"
        "[/POSTING_POSTER_REQUEST]"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_interview(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    position: str,
    level: str = "신입",
    count: int = 5,
) -> str:
    """직종·레벨별 면접 질문 세트 생성."""
    synthetic = (
        f"{position} 직무의 {level} 지원자용 면접 질문 {count}개를 생성해주세요. "
        "추가 질문 없이 바로 [ARTIFACT] 블록을 type=interview_questions 로 저장하세요.\n\n"
        f"원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_hiring_drive(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    title: str,
    start_date: str,
    end_date: str,
    headcount: int,
    target_position: str | None = None,
) -> str:
    """공채/시즌 채용 기간 기획 (스케쥴러 D-리마인드 자동)."""
    pos = target_position or "전 직종"
    synthetic = (
        f"'{title}' 라는 이름의 채용 기간(hiring_drive) artifact 를 만들어주세요. "
        f"기간: {start_date} ~ {end_date}, 모집 인원: {headcount}명, 대상: {pos}.\n"
        "반드시 metadata 에 start_date/end_date/due_label='채용 마감' 을 포함한 [ARTIFACT] 블록으로 저장.\n\n"
        f"원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


async def run_checklist_guide(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    topic: str,
    kind: str = "checklist",
) -> str:
    """채용 관련 체크리스트 또는 가이드."""
    artifact_type = "checklist" if kind == "checklist" else "guide"
    synthetic = (
        f"'{topic}' 주제로 채용 {kind} 를 작성해주세요. "
        f"[ARTIFACT] 블록의 type={artifact_type} 로 저장.\n\n"
        f"원본 사용자 요청: {message}"
    )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


_ONBOARDING_TYPE_LABELS = {
    "onboarding_checklist": "온보딩 체크리스트",
    "onboarding_plan":      "온보딩 플랜",
    "education_material":   "교육 자료",
}


async def run_onboarding(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    position: str,
    onboarding_type: str | None = None,
) -> str:
    """신규 입사자 온보딩 자료 생성 (체크리스트 / 플랜 / 교육자료)."""
    business_type = _get_business_type(account_id) or "소상공인"

    if onboarding_type and onboarding_type in _ONBOARDING_TYPE_LABELS:
        label = _ONBOARDING_TYPE_LABELS[onboarding_type]
        synthetic = (
            f"업종 '{business_type}', 직책 '{position}' 신규 입사자를 위한 {label}을 작성해주세요.\n"
            f"[ARTIFACT] 블록의 type={onboarding_type}, sub_domain=Onboarding 으로 저장.\n"
            "업종 특화 항목을 포함한 실용적 내용으로 작성하세요.\n\n"
            f"원본 사용자 요청: {message}"
        )
    else:
        # 타입 불명확 → LLM이 감지하거나 [CHOICES] 출력
        synthetic = (
            f"업종 '{business_type}', 직책 '{position}' 신규 입사자를 위한 온보딩 자료를 요청합니다.\n"
            "사용자 발화에서 원하는 자료 타입(체크리스트/플랜/교육자료)을 감지하세요.\n"
            "불명확하면 [CHOICES] 로 먼저 물어보고, 명확하면 바로 [ARTIFACT] 블록(sub_domain=Onboarding)으로 저장하세요.\n\n"
            f"원본 사용자 요청: {message}"
        )
    return await run(synthetic, account_id, history, rag_context, long_term_context)


# ──────────────────────────────────────────────────────────────────────────
# 급여 미리보기 (순수 Python 계산)
# ──────────────────────────────────────────────────────────────────────────
_PAYROLL_PREVIEW_PREFIX = "__PAYROLL_PREVIEW_REQUEST__:"
_WORK_TABLE_CONFIRMED_PREFIX = "__WORK_TABLE_CONFIRMED__:"


def _resolve_employee(account_id: str, employee_id: str | None, employee_name: str | None) -> dict:
    """UUID 또는 이름으로 직원 단건 조회. 못 찾으면 {} 반환."""
    import re as _re
    sb = get_supabase()
    _UUID_RE = _re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", _re.I)
    if employee_id and _UUID_RE.match(employee_id):
        row = sb.table("employees").select("*").eq("id", employee_id).eq("account_id", account_id).maybe_single().execute()
        return row.data or {}
    name_query = (employee_name or employee_id or "").strip()
    if not name_query:
        return {}
    all_rows = sb.table("employees").select("*").eq("account_id", account_id).execute()
    all_emps = all_rows.data or []
    candidates = [e for e in all_emps if name_query.lower() in (e.get("name") or "").lower()]
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        names = ", ".join(c.get("name", "") for c in candidates)
        raise ValueError(f"'{name_query}'와 일치하는 직원이 여러 명입니다: {names}\n정확한 이름으로 다시 말씀해 주세요.")
    return {}


def _fetch_work_records(account_id: str, employee_uuid: str, month: str) -> list[dict]:
    import calendar as _cal
    sb = get_supabase()
    y, m = int(month[:4]), int(month[5:7])
    last_day = _cal.monthrange(y, m)[1]
    res = (
        sb.table("work_records")
        .select("work_date,hours_worked,overtime_hours,night_hours,holiday_hours,memo")
        .eq("employee_id", employee_uuid)
        .eq("account_id", account_id)
        .gte("work_date", f"{month}-01")
        .lte("work_date", f"{month}-{last_day:02d}")
        .order("work_date")
        .execute()
    )
    return res.data or []


def _build_payroll_reply(emp: dict, month: str, records: list[dict]) -> str:
    import json as _json
    from app.agents._payroll_calculator import calculate_payroll, format_preview_table

    emp_name = emp.get("name", "직원")
    emp_type = emp.get("employment_type", "시급제")
    hourly = int(emp.get("hourly_rate") or 0)
    monthly_sal = int(emp.get("monthly_salary") or 0)

    if not hourly and not monthly_sal:
        return f"{emp_name}의 시급 또는 월급 정보가 없어요. 직원 관리 탭에서 먼저 입력해 주세요."

    total_hours = sum(float(r.get("hours_worked", 0)) for r in records)
    total_ot = sum(float(r.get("overtime_hours", 0)) for r in records)
    total_night = sum(float(r.get("night_hours", 0)) for r in records)
    total_holiday = sum(float(r.get("holiday_hours", 0)) for r in records)

    result = calculate_payroll(
        employment_type=emp_type,
        hourly_rate=hourly,
        monthly_salary=monthly_sal,
        hours_worked=total_hours,
        overtime_hours=total_ot,
        night_hours=total_night,
        holiday_hours=total_holiday,
    )
    preview_md = format_preview_table(result, emp_name, month)

    preview_data = {
        "employee_id": emp["id"],
        "employee_name": emp_name,
        "employment_type": emp_type,
        "hourly_rate": hourly,
        "monthly_salary": monthly_sal,
        "pay_month": month,
        "pay_day": emp.get("pay_day") or 25,
        "hours_worked": total_hours,
        "overtime_hours": total_ot,
        "night_hours": total_night,
        "holiday_hours": total_holiday,
        "base_pay": result.base_pay,
        "overtime_pay": result.overtime_pay,
        "night_pay": result.night_pay,
        "holiday_pay": result.holiday_pay,
        "meal_allowance": result.meal_allowance,
        "gross_pay": result.gross_pay,
        "national_pension": result.national_pension,
        "health_insurance": result.health_insurance,
        "ltc_insurance": result.ltc_insurance,
        "employment_insurance": result.employment_insurance,
        "income_tax": result.income_tax,
        "local_income_tax": result.local_income_tax,
        "total_deductions": result.total_deductions,
        "net_pay": result.net_pay,
        "has_insurance": result.has_insurance,
    }
    return (
        f"{preview_md}\n\n"
        f"[PAYROLL_PREVIEW_DATA:{_json.dumps(preview_data, ensure_ascii=False)}]\n\n"
        "[CHOICES]\n급여명세서 생성\n취소\n[/CHOICES]"
    )


async def run_payroll_preview(
    message: str,
    account_id: str,
    history: list | None = None,
    rag_context: str = "",
    long_term_context: str = "",
    *,
    employee_id: str | None = None,
    employee_name: str | None = None,
    pay_month: str | None = None,
    **_,
) -> str:
    import json as _json

    # ── 1. 파라미터 추출 (마커 우선) ──────────────────────────────────────────
    emp_id = employee_id
    emp_name_hint = employee_name
    month = pay_month

    # __WORK_TABLE_CONFIRMED__ 마커: Save 버튼 → 바로 급여 계산
    if _WORK_TABLE_CONFIRMED_PREFIX in message:
        try:
            raw = message[message.index(_WORK_TABLE_CONFIRMED_PREFIX) + len(_WORK_TABLE_CONFIRMED_PREFIX):]
            confirmed = _json.loads(raw.strip())
            emp_id = confirmed.get("employee_id", emp_id)
            month = confirmed.get("pay_month", month)
        except Exception:
            pass

    if _PAYROLL_PREVIEW_PREFIX in message:
        try:
            raw = message[message.index(_PAYROLL_PREVIEW_PREFIX) + len(_PAYROLL_PREVIEW_PREFIX):]
            data = _json.loads(raw.strip())
            emp_id = data.get("employee_id", emp_id)
            emp_name_hint = data.get("employee_name", emp_name_hint)
            month = data.get("pay_month", month)
        except Exception:
            pass

    if not month:
        return "급여 미리보기를 위해 급여월 정보가 필요합니다."

    # ── 2. 직원 조회 ──────────────────────────────────────────────────────────
    try:
        emp = _resolve_employee(account_id, emp_id, emp_name_hint)
    except ValueError as e:
        return str(e)
    except Exception as _e:
        log.exception("[payroll_preview] employee lookup failed: %s", _e)
        emp = {}

    if not emp_id and not emp_name_hint:
        return "급여 미리보기를 위해 직원 정보가 필요합니다."
    if not emp:
        return "직원 정보를 찾을 수 없어요."

    employee_uuid = emp["id"]

    # ── 3. Save 확인 마커 → 즉시 급여 계산 ───────────────────────────────────
    if _WORK_TABLE_CONFIRMED_PREFIX in message:
        try:
            records = _fetch_work_records(account_id, employee_uuid, month)
        except Exception:
            records = []
        return _build_payroll_reply(emp, month, records)

    # ── 4. 근무 기록 조회 → 표 확인 단계 ─────────────────────────────────────
    try:
        records = _fetch_work_records(account_id, employee_uuid, month)
    except Exception:
        records = []

    emp_name = emp.get("name", "직원")

    if not records:
        return (
            f"{emp_name}의 {month} 근무 기록이 없어요. 직접 입력하시겠어요?\n\n"
            "[CHOICES]\n입력하기\n취소\n[/CHOICES]"
        )

    # 근무 기록을 표 액션 마커로 반환
    work_table_payload = {
        "employee_id": employee_uuid,
        "employee_name": emp_name,
        "pay_month": month,
        "records": [
            {
                "work_date": r["work_date"],
                "hours_worked": float(r.get("hours_worked", 0)),
                "overtime_hours": float(r.get("overtime_hours", 0)),
                "night_hours": float(r.get("night_hours", 0)),
                "holiday_hours": float(r.get("holiday_hours", 0)),
                "memo": r.get("memo") or "",
            }
            for r in records
        ],
    }
    return (
        f"{emp_name}의 {month} 근무 기록입니다. 확인 후 저장하면 급여명세서를 계산해 드릴게요.\n\n"
        f"[ACTION:OPEN_WORK_TABLE:{_json.dumps(work_table_payload, ensure_ascii=False)}]"
    )


def describe(account_id: str) -> list[dict]:
    """OpenAI tools 스펙용 capability 매니페스트."""
    caps: list[dict] = [
        {
            "name": "recruit_posting_set",
            "description": (
                "당근알바·알바천국·사람인 3종 플랫폼 채용공고를 한 번에 작성한다. "
                "직종(position)은 필수. 시급/주근무시간/요일 등은 알면 채우고 모르면 생략."
            ),
            "handler": run_posting_set,
            "parameters": {
                "type": "object",
                "properties": {
                    "position":       {"type": "string", "description": "직종 또는 포지션명 (예: 바리스타, 홀서빙)"},
                    "wage_hourly":    {"type": "integer", "description": "시급(원). 최저임금 이상"},
                    "wage_monthly":   {"type": "integer", "description": "월급(원)"},
                    "annual_salary":  {"type": "integer", "description": "연봉(원)"},
                    "weekly_hours":   {"type": "number", "description": "주 근무시간"},
                    "work_days":      {"type": "array", "items": {"type": "string"}, "description": "근무 요일 (예: ['월','화','수'])"},
                    "work_start":     {"type": "string", "description": "근무 시작 시각 HH:MM"},
                    "work_end":       {"type": "string", "description": "근무 종료 시각 HH:MM"},
                    "employment_type": {"type": "string", "enum": ["정규직", "계약직", "파트타임", "알바", "단기"]},
                    "location":       {"type": "string", "description": "근무지/매장명/지역"},
                    "headcount":      {"type": "integer", "description": "모집 인원"},
                    "start_date":     {"type": "string", "description": "모집 시작일 YYYY-MM-DD"},
                    "end_date":       {"type": "string", "description": "모집 마감일 YYYY-MM-DD"},
                    "extra_note":     {"type": "string", "description": "자유 기술"},
                    "business_name":  {"type": "string", "description": "매장명/상호/가게 이름 (예: '제빵왕김탁구')"},
                },
                "required": ["position"],
            },
        },
        {
            "name": "recruit_interview",
            "description": "특정 직종·레벨 지원자용 면접 질문 세트를 생성한다.",
            "handler": run_interview,
            "parameters": {
                "type": "object",
                "properties": {
                    "position": {"type": "string"},
                    "level":    {"type": "string", "enum": ["신입", "경력", "시니어"], "default": "신입"},
                    "count":    {"type": "integer", "default": 5, "minimum": 3, "maximum": 20},
                },
                "required": ["position"],
            },
        },
        {
            "name": "recruit_hiring_drive",
            "description": (
                "공채·시즌 채용 기간을 artifact 로 등록한다 (스케쥴러가 D-7/3/1/0 리마인드 자동 발사). "
                "반드시 시작일·종료일·모집 인원이 확정된 경우에만 호출."
            ),
            "handler": run_hiring_drive,
            "parameters": {
                "type": "object",
                "properties": {
                    "title":           {"type": "string", "description": "채용 기간 이름 (예: '2026년 상반기 공채')"},
                    "start_date":      {"type": "string", "description": "시작일 YYYY-MM-DD"},
                    "end_date":        {"type": "string", "description": "종료일 YYYY-MM-DD"},
                    "headcount":       {"type": "integer"},
                    "target_position": {"type": "string", "description": "대상 직종(선택)"},
                },
                "required": ["title", "start_date", "end_date", "headcount"],
            },
        },
        {
            "name": "recruit_checklist_guide",
            "description": "채용 관련 체크리스트 또는 가이드 문서를 작성한다.",
            "handler": run_checklist_guide,
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string", "description": "예: '근로계약서 체크리스트'"},
                    "kind":  {"type": "string", "enum": ["checklist", "guide"], "default": "checklist"},
                },
                "required": ["topic"],
            },
        },
        {
            "name": "recruit_onboarding",
            "description": (
                "신규 입사자 온보딩 자료를 생성한다. "
                "체크리스트(입사 단계별 할 일) / 플랜(수습 기간 일정) / 교육자료(매뉴얼·SOP) 중 "
                "사용자 요청에 맞는 타입으로 저장. Onboarding 서브허브에 자동 분류."
            ),
            "handler": run_onboarding,
            "parameters": {
                "type": "object",
                "properties": {
                    "position": {
                        "type": "string",
                        "description": "직책 또는 직종 (예: 바리스타, 홀서빙, 주방장)",
                    },
                    "onboarding_type": {
                        "type": "string",
                        "enum": ["onboarding_checklist", "onboarding_plan", "education_material"],
                        "description": "자료 타입. 불명확하면 생략 — 에이전트가 감지하거나 [CHOICES] 로 확인.",
                    },
                },
                "required": ["position"],
            },
        },
        {
            "name": "recruit_payroll_preview",
            "description": (
                "직원 DB에서 근무 기록을 읽어 급여명세서 미리보기를 계산한다. "
                "순수 Python 수식으로 4대보험·소득세 공제액을 산출하고 표 형식으로 보여준다. "
                "사용자가 확인하면 Documents 에이전트가 Excel을 생성한다. "
                "급여/월급/페이/봉급/명세서 키워드가 있을 때 호출."
            ),
            "handler": run_payroll_preview,
            "parameters": {
                "type": "object",
                "properties": {
                    "employee_id": {"type": "string", "description": "직원 UUID. UUID를 모르면 생략하고 employee_name을 사용."},
                    "employee_name": {"type": "string", "description": "직원 이름 (예: 송진우). employee_id UUID를 모를 때 사용."},
                    "pay_month": {"type": "string", "description": "급여 정산 월 YYYY-MM (예: 2026-04)"},
                },
                "required": ["pay_month"],
            },
        },
    ]

    # 포스터 capability 는 최근 posting_set 이 있을 때만 노출
    if _find_recent_posting_set(account_id):
        caps.append({
            "name": "recruit_posting_poster",
            "description": (
                "가장 최근 작성된 채용공고 세트를 근거로 GPT-4o 로 standalone HTML 포스터 1장을 생성한다. "
                "사용자가 '이미지/포스터/배너/썸네일' 을 요청할 때만 호출."
            ),
            "handler": run_posting_poster,
            "parameters": {
                "type": "object",
                "properties": {
                    "platform": {"type": "string", "enum": list(VALID_PLATFORMS), "default": "karrot"},
                    "style":    {"type": "string", "description": "자유 디자인 지시 (예: '따뜻한 브라운 톤, 미니멀')"},
                },
            },
        })

    return caps


# ──────────────────────────────────────────────────────────────────────────
# 메인 run (legacy fallback 겸 capability wrapper 타겟)
# ──────────────────────────────────────────────────────────────────────────
@traceable(name="recruitment.run", run_type="chain")
async def run(
    message: str,
    account_id: str,
    history: list[dict],
    rag_context: str = "",
    long_term_context: str = "",
) -> str:
    # 1. 의도 휴리스틱
    type_guess, cat_hint = detect_recruit_intent(message)
    if not type_guess:
        for h in reversed(history[-6:]):
            if h.get("role") == "user":
                t2, c2 = detect_recruit_intent(h.get("content") or "")
                if t2:
                    type_guess = t2
                    cat_hint = cat_hint or c2
                    break

    # 업종: profile 우선 → 메시지 힌트 fallback
    business_type = _get_business_type(account_id)
    if not business_type and cat_hint:
        business_type = cat_hint

    want_posting = type_guess in ("job_posting", "job_posting_set")
    want_image = wants_posting_poster(message)

    recruit_ctx = build_recruit_context(
        business_type=business_type,
        want_job_posting=want_posting,
        want_image=want_image,
    )

    system = SYSTEM_PROMPT_BASE + "\n\n" + today_context() + "\n\n" + recruit_ctx

    hubs = list_sub_hub_titles(account_id, "recruitment")
    if hubs:
        system += "\n\n[이 계정의 recruitment 서브허브]\n- " + "\n- ".join(hubs)
    if long_term_context:
        system += f"\n\n[사용자 장기 기억]\n{long_term_context}"
    if rag_context:
        system += f"\n\n{rag_context}"
    fb = feedback_context(account_id, "recruitment")
    if fb:
        system += f"\n\n{fb}"

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": system},
            *history,
            {"role": "user", "content": message},
        ],
    )
    reply = resp.choices[0].message.content or ""

    # 2. 3종 공고 마커 → 세트 + 3개 자식 저장
    reply = await _maybe_dispatch_posting_set(account_id, reply)

    # 3. 포스터 마커 → GPT-4o 로 HTML 포스터 생성 + Storage(html) + artifact 저장
    reply = await _maybe_dispatch_poster(account_id, reply)

    # 4. 일반 [ARTIFACT] (interview_questions / hiring_drive / checklist / guide / 단일 job_posting)
    await save_artifact_from_reply(
        account_id,
        "recruitment",
        reply,
        default_title="채용 자료",
        valid_types=_GENERIC_VALID_TYPES,
        extra_meta_keys=("due_label",),
    )
    return reply
