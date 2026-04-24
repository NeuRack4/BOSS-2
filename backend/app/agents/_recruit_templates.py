"""채용 도메인 전용 템플릿/지식 모듈.

`_doc_templates.py` 와 동일한 구조를 따름:
- `VALID_TYPES` × 필수 필드 매트릭스
- `CATEGORY_CHOICES` — `profiles.business_type` 휴리스틱 → 직종 CHOICES 분기
- `PLATFORM_BLOCK_MARKERS` — 3종 공고 섹션 파싱
- `load_platform_brief(platform)` / `load_category_brief(category)` — markdown 인라인 로드
- `build_recruit_context(...)` — recruitment 에이전트 system prompt 말미 주입

외부 LLM 호출 없이 모두 로컬 파일 로드.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

_KNOWLEDGE_ROOT = Path(__file__).parent / "_recruit_knowledge"

VALID_TYPES: tuple[str, ...] = (
    "job_posting",          # 플랫폼별 채용공고 1개
    "job_posting_set",      # 3종 공고 묶음 부모
    "job_posting_poster",   # 공고 포스터 (GPT-4o HTML)
    "interview_questions",  # 면접 질문 세트
    "checklist",            # 채용 체크리스트
    "guide",                # 채용 가이드
    "hiring_drive",         # 시즌/공채 기간
)

VALID_PLATFORMS: tuple[str, ...] = ("karrot", "albamon", "saramin")

PLATFORM_LABELS: dict[str, str] = {
    "karrot":  "당근알바",
    "albamon": "알바천국",
    "saramin": "사람인",
}

TYPE_SPEC: dict[str, dict] = {
    "job_posting": {
        "label": "채용공고",
        "required": ("직종/포지션", "근무지", "고용 형태", "급여", "주 근무시간"),
        "default_due_label": "모집 마감",
    },
    "job_posting_set": {
        "label": "채용공고 세트 (당근/알바천국/사람인 3종)",
        "required": ("직종/포지션", "근무지", "고용 형태", "급여", "주 근무시간"),
        "default_due_label": "모집 마감",
    },
    "interview_questions": {
        "label": "면접 질문 세트",
        "required": ("직종", "직무 레벨(신입/경력)", "질문 수"),
        "default_due_label": None,
    },
    "checklist": {
        "label": "채용 체크리스트",
        "required": ("적용 상황", "핵심 항목"),
        "default_due_label": None,
    },
    "guide": {
        "label": "채용 가이드",
        "required": ("대상", "범위"),
        "default_due_label": None,
    },
    "hiring_drive": {
        "label": "채용 기간/공채",
        "required": ("기간(start_date, end_date)", "채용 인원", "대상 직종"),
        "default_due_label": "채용 마감",
    },
}


# ── 업종별 기본 CHOICES ─────────────────────────────────────────────────────
# profiles.business_type 자유 텍스트 → 여기 카테고리 키로 매핑.
CATEGORY_CHOICES: dict[str, tuple[str, ...]] = {
    "cafe": (
        "바리스타",
        "홀 서빙",
        "주방 보조",
        "오픈/마감 알바",
        "매니저",
        "기타 (직접 입력)",
    ),
    "restaurant": (
        "홀 서빙",
        "주방 보조",
        "조리사/쉐프",
        "배달 담당",
        "매니저",
        "기타 (직접 입력)",
    ),
    "retail": (
        "캐셔/계산원",
        "매장 관리",
        "상품 진열",
        "야간 알바",
        "점장/매니저",
        "기타 (직접 입력)",
    ),
    "beauty": (
        "스태프/인턴",
        "디자이너",
        "네일리스트",
        "왁싱/에스테틱",
        "실장/원장",
        "기타 (직접 입력)",
    ),
    "academy": (
        "강사",
        "보조 강사/조교",
        "데스크/상담실장",
        "관리팀/총무",
        "기타 (직접 입력)",
    ),
    "default": (
        "정규직 직원",
        "파트타임 알바",
        "단기 알바",
        "인턴",
        "기타 (직접 입력)",
    ),
}

# business_type 자유 텍스트 → CATEGORY_CHOICES 키 매핑 (소문자 부분일치).
_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "cafe":       ("카페", "커피", "cafe", "coffee", "디저트", "베이커리"),
    "restaurant": ("음식점", "식당", "레스토랑", "한식", "일식", "중식", "양식", "주점", "술집", "고깃집", "분식"),
    "retail":     ("소매", "편의점", "마트", "판매", "의류", "옷가게", "잡화", "슈퍼", "retail", "백화점"),
    "beauty":     ("미용", "헤어", "네일", "뷰티", "피부", "에스테틱", "왁싱", "미용실"),
    "academy":    ("학원", "교습", "과외", "academy", "공부방", "교육"),
}


def detect_category(business_type: str | None) -> str:
    """`profiles.business_type` 을 CATEGORY_CHOICES 키로 매핑. 매칭 실패 시 'default'."""
    if not business_type:
        return "default"
    low = business_type.casefold()
    for key, kws in _CATEGORY_KEYWORDS.items():
        for kw in kws:
            if kw in low:
                return key
    return "default"


# ── 플랫폼 섹션 파싱 ─────────────────────────────────────────────────────────
# LLM 출력에서 3종 섹션을 구분. `[당근마켓] [알바천국] [사람인]` 헤더 약속.
_PLATFORM_MARKERS: tuple[tuple[str, str], ...] = (
    (r"\[당근(?:마켓|알바)?\]", "karrot"),
    (r"\[알바천국\]",            "albamon"),
    (r"\[사람인\]",              "saramin"),
)


def parse_platform_sections(text: str) -> dict[str, str]:
    """3종 공고 섹션을 분리. 파싱 실패 시 전체를 karrot 에 담아 반환."""
    sections: dict[str, str] = {"karrot": "", "albamon": "", "saramin": ""}
    positions: list[tuple[int, int, str]] = []
    for pattern, key in _PLATFORM_MARKERS:
        m = re.search(pattern, text)
        if m:
            positions.append((m.start(), m.end(), key))
    positions.sort()
    for i, (start, end, key) in enumerate(positions):
        next_start = positions[i + 1][0] if i + 1 < len(positions) else len(text)
        sections[key] = text[end:next_start].strip()
    if not any(sections.values()):
        sections["karrot"] = text.strip()
    return sections


# ── 포스터 생성 요청 마커 감지 ───────────────────────────────────────────────
# 에이전트 응답에 `[POSTING_POSTER_REQUEST]platform: ... | style: ...[/POSTING_POSTER_REQUEST]`
# 를 넣으면 recruitment.py 가 이를 감지해 HTML 포스터 생성 파이프라인으로 넘긴다.
# 구버전 마커 `[POSTING_IMAGE_REQUEST]` 도 당분간 허용 (동일 핸들러).
POSTING_POSTER_REQUEST_RE = re.compile(
    r"\[POSTING_(?:POSTER|IMAGE)_REQUEST\](.*?)\[/POSTING_(?:POSTER|IMAGE)_REQUEST\]", re.DOTALL,
)

# 사용자 발화에서 포스터 요청 의도 감지 (휴리스틱).
_POSTER_REQUEST_KEYWORDS: tuple[str, ...] = (
    "포스터 만들", "포스터도 만들", "포스터 뽑아",
    "이미지 만들", "이미지 생성", "이미지도 만들", "이미지 뽑아",
    "디자인 만들", "공고 이미지", "채용 이미지", "공고 포스터", "채용 포스터",
    "썸네일 만들", "배너 만들",
)


def wants_posting_poster(message: str) -> bool:
    low = (message or "").lower()
    return any(kw in low for kw in _POSTER_REQUEST_KEYWORDS)


# ── 지식 파일 로드 ──────────────────────────────────────────────────────────
@lru_cache(maxsize=32)
def _read_md(path: Path) -> str:
    if path.is_file():
        try:
            return path.read_text(encoding="utf-8")
        except Exception:
            return ""
    return ""


def load_labor_law() -> str:
    return _read_md(_KNOWLEDGE_ROOT / "labor_law.md")


def load_platform_brief(platform: str) -> str:
    if platform not in VALID_PLATFORMS:
        return ""
    return _read_md(_KNOWLEDGE_ROOT / "platforms" / f"{platform}.md")


def load_category_brief(category: str) -> str:
    if category not in CATEGORY_CHOICES:
        category = "default"
    return _read_md(_KNOWLEDGE_ROOT / "categories" / f"{category}.md")


def _format_type_matrix() -> str:
    lines = ["[type × 필수 필드 매트릭스]"]
    for t, spec in TYPE_SPEC.items():
        req = ", ".join(spec["required"])
        due = spec.get("default_due_label") or "—"
        lines.append(f"- {t} ({spec['label']}): {req}  · 기본 due_label: {due}")
    return "\n".join(lines)


def build_recruit_context(
    *,
    business_type: str | None = None,
    want_job_posting: bool = False,
    want_image: bool = False,
) -> str:
    """recruitment 에이전트 system prompt 말미에 주입할 컨텍스트 블록.

    - 항상: type 매트릭스 + 근로법 요점
    - want_job_posting=True: 업종 카테고리 브리프 + 3종 플랫폼 베스트 프랙티스
    - want_image=True: 이미지 요청 마커 사용 가이드
    """
    chunks: list[str] = [_format_type_matrix()]

    labor = load_labor_law()
    if labor:
        chunks.append(f"[근로 법령 요점]\n{labor}")

    category = detect_category(business_type)
    choices = CATEGORY_CHOICES[category]
    choices_block = "\n".join(f"- {c}" for c in choices)
    chunks.append(
        f"[업종 추정: {category}] 사용자 업종(`{business_type or '미설정'}`) 에 맞는 직종 CHOICES 예시:\n{choices_block}"
    )

    cat_brief = load_category_brief(category)
    if cat_brief:
        chunks.append(f"[업종 세부 가이드 — {category}]\n{cat_brief}")

    if want_job_posting:
        for p in VALID_PLATFORMS:
            b = load_platform_brief(p)
            if b:
                chunks.append(f"[{PLATFORM_LABELS[p]} 플랫폼 가이드 — {p}]\n{b}")

    if want_image:
        chunks.append(
            "[채용공고 포스터 생성 지시]\n"
            "사용자가 채용공고 포스터(=이미지) 를 요청하면, 가장 최근 작성된 공고 세트를 근거로\n"
            "아래 마커를 **응답 본문 끝에** 정확히 한 번만 삽입하세요:\n\n"
            "[POSTING_POSTER_REQUEST]\n"
            "platform: karrot|albamon|saramin  # 없으면 karrot 기본\n"
            "style: 한 줄 디자인 지시 (예: 따뜻한 브라운 톤 카페 분위기)\n"
            "[/POSTING_POSTER_REQUEST]\n\n"
            "시스템이 마커를 파싱해 GPT-4o 로 standalone HTML 포스터를 생성 후 캔버스에 저장합니다.\n"
            "마커 외엔 '포스터를 만들고 있어요' 정도로만 간단히 안내하세요. HTML 코드를 직접 출력하지 마세요."
        )

    return "\n\n---\n\n".join(chunks)


# ── 사용자 메시지에서 type/업종 의도 휴리스틱 감지 ──────────────────────────
def detect_recruit_intent(message: str) -> tuple[str | None, str | None]:
    """(type, category_hint) 반환. 둘 다 None 이면 에이전트가 CHOICES 로 되묻도록.

    LLM 비용 없이 빠른 1차 분류.
    """
    msg = (message or "").lower()

    # type 키워드
    type_keywords: dict[str, tuple[str, ...]] = {
        "job_posting_set": ("3종", "당근.*알바천국.*사람인", "플랫폼별", "공고 여러", "공고 만들"),
        "interview_questions": ("면접 질문", "면접질문", "면접 준비"),
        "hiring_drive":   ("공채", "시즌 채용", "대규모 채용", "채용 기간"),
        "checklist":      ("체크리스트", "점검표"),
        "guide":          ("가이드", "매뉴얼"),
        "job_posting":    ("채용공고", "구인공고", "알바 공고", "직원 뽑",),
    }
    t_hit: str | None = None
    for t, kws in type_keywords.items():
        for kw in kws:
            if re.search(kw, msg):
                t_hit = t
                break
        if t_hit:
            break

    # 업종 키워드 (profile 이 비어있는 경우 메시지에서라도 힌트)
    cat_hit: str | None = None
    for key, kws in _CATEGORY_KEYWORDS.items():
        for kw in kws:
            if kw in msg:
                cat_hit = key
                break
        if cat_hit:
            break

    return t_hit, cat_hit
