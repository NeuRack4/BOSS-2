"""서류 도메인 전용 템플릿/지식 모듈.

- `TYPE_SPEC` — 허용 type × contract_subtype 별 필수필드/설명/기본 due_label.
- `SKELETONS` — 에이전트가 본문 생성 시 참고하는 markdown 스켈레톤.
- `load_knowledge(subtype)` — `_doc_knowledge/{subtype}/{acceptable,risks}.md` 원본 로드
  (v1.1 공정성 분석에서도 동일 자산 재활용 목적).
- `build_doc_context(type_, subtype)` — documents 에이전트 system prompt 말미에 주입.

한국 법령 조항 원문은 LLM 선학습에만 의존하지 않도록 markdown 파일 원본을 그대로 덧붙임.
파일 크기가 커도 system 에 한 번만 실리며, LLM 컨텍스트 한도 내에서 잘라낸다.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_KNOWLEDGE_ROOT = Path(__file__).parent / "_doc_knowledge"

VALID_CONTRACT_SUBTYPES: tuple[str, ...] = (
    "labor",        # 근로계약서
    "lease",        # 상가 임대차 계약서
    "service",      # 용역/SW 개발 계약서
    "supply",       # 납품/공급 계약서
    "partnership",  # 파트너십/주주간 계약서
    "franchise",    # 프랜차이즈 가맹 계약서
    "nda",          # 비밀유지 계약서
)

CONTRACT_SUBTYPE_LABELS: dict[str, str] = {
    "labor": "근로계약서",
    "lease": "상가 임대차 계약서",
    "service": "용역/개발 계약서",
    "supply": "납품/공급 계약서",
    "partnership": "파트너십/주주간 계약서",
    "franchise": "프랜차이즈 가맹 계약서",
    "nda": "비밀유지(NDA) 계약서",
}

TYPE_SPEC: dict[str, dict] = {
    "contract": {
        "label": "계약서",
        "required": ("contract_subtype", "당사자(갑/을)", "주요 조건·금액", "기간"),
        "default_due_label": "계약 만료",
    },
    "estimate": {
        "label": "견적서",
        "required": ("발주처", "품목·수량·단가", "유효기간"),
        "default_due_label": "견적 유효기간",
    },
    "proposal": {
        "label": "제안서",
        "required": ("제안 대상", "제안 범위", "제안가·기간"),
        "default_due_label": "제안 회신 기한",
    },
    "notice": {
        "label": "공지문",
        "required": ("게시 대상", "공지 일자", "핵심 메시지"),
        "default_due_label": "공지 게시일",
    },
    "checklist": {
        "label": "체크리스트",
        "required": ("적용 상황", "핵심 항목 리스트"),
        "default_due_label": None,
    },
    "guide": {
        "label": "가이드/안내문",
        "required": ("적용 상황", "핵심 항목 리스트"),
        "default_due_label": None,
    },
}


SKELETONS: dict[str, str] = {
    "contract.labor": """\
# 근로계약서

**사용자**: {{사업자명}} (이하 "갑") · **근로자**: {{근로자명}} (이하 "을")

## 1. 근로계약기간
- 시작: {{start_date}}  /  종료: {{end_date 또는 "기간의 정함 없음"}}
- 수습기간: {{있으면 기간+감액률 (최저임금 90% 이상, 3개월 이내, 1년 이상 계약일 때만)}}

## 2. 근무 장소 및 담당 업무
- 근무 장소: {{주소}}
- 담당 업무: {{직무 기술}}

## 3. 소정근로시간 및 휴게
- 소정근로: {{요일}} {{HH:MM~HH:MM}} (1일 {{N}}시간, 주 {{N}}시간)
- 휴게시간: {{12:00~13:00}} (근로시간 불포함)

## 4. 휴일·휴가
- 주휴일: {{요일}} (1주 소정근로일 개근 시 유급)
- 연차유급휴가: 근로기준법 §60에 따름

## 5. 임금
- 기본급: 월 {{금액}}원 ({{시급 환산}})
- 가산수당: 연장 1.5배 / 야간(22~06시) 0.5배 가산 / 휴일 1.5배
- 지급일: 매월 {{N}}일 근로자 지정 계좌 입금
- 급여명세서는 매월 교부

## 6. 사회보험
- 국민연금·건강보험·고용보험·산재보험 법정 비율로 각각 부담

## 7. 근로계약서 교부
- 2부 작성 후 갑·을 각 1부씩 보관 (근로기준법 §17)

---
20{{YY}}년 {{MM}}월 {{DD}}일
갑: {{서명}}    을: {{서명}}
""",

    "contract.lease": """\
# 상가 임대차 계약서

**임대인**: {{이름/법인}} · **임차인**: {{이름/법인}}

## 1. 임대 목적물
- 주소: {{지번/도로명}}
- 면적: 전용 {{N}}㎡ / 공용 {{N}}㎡

## 2. 임대차 기간
- {{start_date}} ~ {{end_date}} ({{N}}년) — 상가건물임대차보호법 §10 계약갱신요구권 10년 적용

## 3. 차임 및 관리비
- 보증금: {{금액}}원
- 월 차임: {{금액}}원 (VAT {{별도/포함}}), 매월 {{N}}일 지급
- 관리비: {{금액}}원 / 별도 고지

## 4. 계약 갱신 및 해지
- 임차인의 갱신요구권은 최초 계약일로부터 10년 한도 인정
- 월 차임 3기 연체 시 임대인의 해지 사유

## 5. 원상회복 및 권리금
- 원상회복 범위: {{구체 명시}}
- 권리금 회수 기회 보호: 상가건물임대차보호법 §10-4 적용

---
{{YYYY}}년 {{MM}}월 {{DD}}일
임대인: {{서명}}    임차인: {{서명}}
""",

    "contract.service": """\
# 용역/개발 계약서

**발주자(갑)**: {{법인명}} · **수행자(을)**: {{법인/개인}}

## 1. 용역 범위
- 과업명: {{제목}}
- 범위(Scope): {{불릿으로 구체적 산출물 명시}}
- 제외 범위: {{오해 여지 항목 차단}}

## 2. 계약 기간 및 일정
- 총 기간: {{start_date}} ~ {{end_date}}
- 마일스톤: {{M1: 날짜 / M2: 날짜 / 최종 납품: 날짜}}

## 3. 계약금액 및 지급
- 총액: {{금액}}원 (VAT 별도)
- 지급: 착수 {{%}} / 중간 {{%}} / 최종 {{%}} — 세금계산서 발행 후 {{N}}일 내

## 4. 산출물 및 지식재산권
- 산출물: {{소스코드·문서·디자인·데이터}}
- 저작권 귀속: {{검수 후 갑에게 이전 / 을 보유 + 갑에 사용권 부여 중 택}}

## 5. 검수 및 하자보수
- 검수 기준: {{체크리스트 첨부}}
- 하자보수 기간: 검수 완료일로부터 {{N}}개월

## 6. 비밀유지 및 분쟁 해결
- 비밀유지 의무 기간: 계약 종료 후 {{N}}년
- 관할 법원: {{상호 합의하는 지방법원}}

---
{{YYYY}}년 {{MM}}월 {{DD}}일
갑: {{서명}}    을: {{서명}}
""",

    "contract.supply": """\
# 납품/공급 계약서

**발주자(갑)**: {{법인명}} · **납품자(을)**: {{법인명}}

## 1. 물품 및 수량
- 품목: {{규격/SKU}}
- 수량: {{단위}}
- 단가: {{금액}}원 (VAT 별도)

## 2. 납품 기한 및 장소
- 납품 기한: **{{delivery_date}}** (지연 시 일 {{%}} 지체상금)
- 납품 장소: {{주소}}
- 검수 기간: 납품일로부터 {{N}}영업일

## 3. 대금 지급
- 지급 조건: 검수 완료 후 {{N}}일 이내 계좌 입금
- 세금계산서는 {{납품 즉시 / 월말 합산}}

## 4. 품질 보증 및 반품
- 불량 기준: {{KS/KC/내부 QC}}
- 반품 처리: 검수 시 불량 발견 {{N}}% 초과 시 전량 반품 또는 교체 요구

## 5. 계약 해지
- 3회 이상 납기 지연 또는 불량률 {{N}}% 초과 시 갑의 해지 사유

---
{{YYYY}}년 {{MM}}월 {{DD}}일
갑: {{서명}}    을: {{서명}}
""",

    "contract.partnership": """\
# 파트너십/주주간 계약서

**당사자**: {{A}}, {{B}} ({{추가 파트너}})

## 1. 사업 목적 및 지분
- 사업: {{간단 기술}}
- 지분: {{A N%, B N%}} — 총 100%

## 2. 출자 및 역할
- 출자금: {{A: 금액, B: 금액}}
- 역할 분담: {{책임 영역 구체적으로}}

## 3. 의사결정
- 일상 운영: {{대표 1인 결정 가능 한도}}
- 중요 결정(차입·매각·증자 등): 지분 {{N}}% 이상 동의 필요

## 4. 이익 분배 및 비용 부담
- 이익 배당: 지분 비율에 따라
- 손실 부담: 지분 비율에 따라 (단 불법행위·중과실은 개별 귀책)

## 5. 동반매도·선매수권 (Drag/Tag/ROFR)
- {{필요 시 수치와 함께 명시}}

## 6. 이탈 및 환매
- 파트너 이탈 시 환매 공식: {{EBITDA×N / 순자산가치 등}}

---
{{YYYY}}년 {{MM}}월 {{DD}}일
{{A}}: {{서명}}    {{B}}: {{서명}}
""",

    "contract.franchise": """\
# 프랜차이즈 가맹 계약서

**가맹본부(갑)**: {{법인명}} · **가맹점(을)**: {{이름/법인}}

## 1. 영업표지 및 영업지역
- 영업표지: {{브랜드/로고}}
- 독점 영업지역: {{행정구역 또는 반경 km}} (가맹사업법 §12-4)

## 2. 계약 기간
- {{start_date}} ~ {{end_date}} ({{N}}년), 갱신 조건: {{내용}}

## 3. 가맹금 및 로열티
- 가맹비: {{금액}}원 (가맹사업법 §6-2에 따른 예치 가능)
- 교육비/인테리어: {{금액}}
- 로열티: 매출의 {{N}}% 또는 월 {{금액}}원
- 광고·판촉 분담금: 매출의 {{N}}%

## 4. 품목 공급 및 가격 구속
- 필수 공급 품목: {{리스트}}
- 권장가 고시: **강제 아님** (공정거래법 §46 재판매가격유지행위 금지)

## 5. 정보공개서 및 숙고 기간
- 정보공개서 수령일: {{YYYY-MM-DD}}
- 숙고 기간 14일 이상 경과 후 계약 체결 (가맹사업법 §7)

## 6. 계약 해지 및 위약금
- 사유: {{구체 명시, 단순 매출 부진만으로 해지 불가}}
- 위약금: {{과도하지 않은 합리적 수준, 공정거래위원회 권고 참고}}

---
{{YYYY}}년 {{MM}}월 {{DD}}일
가맹본부: {{서명}}    가맹점: {{서명}}
""",

    "contract.nda": """\
# 비밀유지계약서 (NDA)

**당사자 A**: {{이름/법인}} · **당사자 B**: {{이름/법인}}

## 1. 비밀정보의 정의
- "{{프로젝트명}}" 관련 {{기술/영업/재무}} 정보 중 "대외비" 또는 유사 표시가 있는 자료
- 구두 정보는 제공 후 {{N}}일 이내 서면 확인 시 비밀정보로 간주

## 2. 비밀유지 의무 기간
- 계약 체결일로부터 {{N}}년 ({{관행상 1~3년}})

## 3. 사용 목적 제한
- {{검토/평가/협업}} 목적으로만 사용. 목적 외 이용 금지

## 4. 제외 사유
- 공개된 정보, 독립 개발 정보, 제3자로부터 정당하게 입수한 정보는 제외

## 5. 위반 시 조치
- 서면 통지 후 즉시 시정 요구 및 실손해 배상 (위약금 예정은 두지 않음 — 근기법·민법상 무효 소지)

---
{{YYYY}}년 {{MM}}월 {{DD}}일
A: {{서명}}    B: {{서명}}
""",

    "estimate": """\
# 견적서 — {{제목}}

**공급자**: {{사업자명 / 대표자 / 사업자등록번호}}
**수신**: {{발주처 / 담당자}}
**발행일**: {{YYYY-MM-DD}}
**유효기간**: {{due_date}}

| No | 품목 | 규격 | 수량 | 단가 | 공급가 |
|---:|------|------|---:|---:|---:|
| 1  | {{품목}} | {{규격}} | {{N}} | {{원}} | {{원}} |

- 공급가 합계: {{금액}}원
- 부가세(10%): {{금액}}원
- **총 합계**: **{{금액}}원**

### 특이사항
- 결제 조건: {{검수 후 N일 이내 / 선금 N%}}
- 납기: {{영업일 N일}}
- 상기 금액은 {{유효기간}}까지 유효합니다.
""",

    "proposal": """\
# {{제안서 제목}}

**제출자**: {{법인명 / 담당자}}
**수신**: {{제안 대상}}
**제출일**: {{YYYY-MM-DD}}

## 1. 제안 배경 및 목적
{{1~2문단. 의뢰자 상황과 해결하려는 문제}}

## 2. 제안 범위 (Scope)
- {{항목 1: 산출물과 책임}}
- {{항목 2}}
- **제외 범위**: {{오해 방지}}

## 3. 추진 일정
| 단계 | 산출물 | 기간 |
|------|--------|------|
| 기획 | {{}} | {{MM-DD ~ MM-DD}} |
| 실행 | {{}} | {{}} |
| 검수 | {{}} | {{}} |

## 4. 투입 인력 및 체계
- {{PM / 전문가 / 지원}}

## 5. 견적
- 총액: {{금액}}원 (VAT 별도)
- 지급 조건: {{}}

## 6. 회신 기한
- **{{due_date}}** 까지 회신 요청드립니다.
""",

    "notice": """\
# {{공지 제목}}

**게시 대상**: {{직원 / 고객 / 거래처}}
**게시일**: {{due_date 또는 today}}
**작성**: {{가게명/담당자}}

---

{{본문 1~3문단. 구체적인 날짜/시간/대상/사유 명시}}

### 문의
- 담당: {{이름}} / {{연락처}}

감사합니다.
""",

    "checklist": """\
# {{체크리스트 제목}}

**적용 상황**: {{오픈 준비 / 마감 / 연말 정산 등}}
**갱신일**: {{YYYY-MM-DD}}

## 필수 확인 항목
- [ ] {{항목 1 — 구체적 행위}}
- [ ] {{항목 2}}
- [ ] {{항목 3}}

## 권장 항목
- [ ] {{항목}}

## 예외 상황 대응
- {{상황}} → {{대응}}
""",

    "guide": """\
# {{가이드 제목}}

**대상**: {{신규 직원 / 점주 / 고객}}
**작성일**: {{YYYY-MM-DD}}

## 개요
{{무엇에 대한 가이드인지 1~2문단}}

## 절차
1. {{단계 1}}
2. {{단계 2}}
3. {{단계 3}}

## 주의사항
- {{법령·관행·안전 관련 유의점}}

## 관련 자료
- {{참고 문서/URL}}
""",
}


@lru_cache(maxsize=16)
def load_knowledge(subtype: str) -> str:
    """`_doc_knowledge/{subtype}/{acceptable,risks}.md` 를 읽어 하나의 블록으로 반환.

    파일이 없으면 빈 문자열. lru_cache 로 반복 로드 방지.
    """
    if subtype not in VALID_CONTRACT_SUBTYPES:
        return ""
    base = _KNOWLEDGE_ROOT / subtype
    parts: list[str] = []
    risks = base / "risks.md"
    accept = base / "acceptable.md"
    if risks.is_file():
        parts.append(f"[위험 조항 패턴 — {subtype}]\n{risks.read_text(encoding='utf-8')}")
    if accept.is_file():
        parts.append(f"[관행적 허용 조항 — {subtype}]\n{accept.read_text(encoding='utf-8')}")
    return "\n\n---\n\n".join(parts)


def _format_type_matrix() -> str:
    lines = ["[type × 필수 필드 매트릭스]"]
    for t, spec in TYPE_SPEC.items():
        req = ", ".join(spec["required"])
        due = spec.get("default_due_label") or "—"
        lines.append(f"- {t} ({spec['label']}): {req}  · 기본 due_label: {due}")
    lines.append("")
    lines.append("[contract.subtype 옵션]")
    for s in VALID_CONTRACT_SUBTYPES:
        lines.append(f"- {s}: {CONTRACT_SUBTYPE_LABELS[s]}")
    return "\n".join(lines)


def build_doc_context(type_: str | None = None, subtype: str | None = None) -> str:
    """documents 에이전트 system prompt 말미에 주입할 컨텍스트 블록.

    - type_ 미지정: 전체 type 매트릭스만 노출 (초기 대화 단계).
    - type_='contract' + subtype 지정: 스켈레톤 + 법령 지식 블록까지 주입.
    """
    chunks: list[str] = [_format_type_matrix()]

    if type_:
        skel_key = f"{type_}.{subtype}" if type_ == "contract" and subtype else type_
        skel = SKELETONS.get(skel_key)
        if skel:
            chunks.append(f"[추천 스켈레톤 — {skel_key}]\n{skel}")

    if type_ == "contract" and subtype:
        k = load_knowledge(subtype)
        if k:
            # 전체를 담기엔 클 수 있어 앞쪽을 우선, 12k 글자 상한
            trimmed = k[:12000] + ("\n\n...(이하 생략)" if len(k) > 12000 else "")
            chunks.append(trimmed)

    return "\n\n---\n\n".join(chunks)


def detect_doc_intent(message: str) -> tuple[str | None, str | None]:
    """사용자 메시지에서 type 과 contract_subtype 키워드를 휴리스틱으로 뽑아냄.

    LLM 호출 없이 빠르게 classification. 확신이 없으면 (None, None) — 에이전트가 CHOICES 로 되물음.
    """
    msg = (message or "").lower()

    subtype_keywords: dict[str, tuple[str, ...]] = {
        "labor": ("근로계약", "고용계약", "알바 계약", "아르바이트 계약"),
        "lease": ("임대차", "상가 계약", "가게 계약", "월세 계약", "임차 계약"),
        "service": ("용역", "개발 계약", "sw 계약", "외주 계약", "컨설팅 계약"),
        "supply": ("납품", "공급 계약", "식자재 계약", "원재료 계약"),
        "partnership": ("파트너십", "주주간", "공동창업", "동업 계약"),
        "franchise": ("가맹", "프랜차이즈"),
        "nda": ("nda", "비밀유지", "기밀유지"),
    }
    for sub, kws in subtype_keywords.items():
        for kw in kws:
            if kw in msg:
                return "contract", sub

    type_keywords: dict[str, tuple[str, ...]] = {
        "contract": ("계약서",),
        "estimate": ("견적서", "견적"),
        "proposal": ("제안서",),
        "notice": ("공지문", "공지", "안내문"),
        "checklist": ("체크리스트", "점검표"),
        "guide": ("가이드", "매뉴얼"),
    }
    for t, kws in type_keywords.items():
        for kw in kws:
            if kw in msg:
                return t, None

    return None, None
