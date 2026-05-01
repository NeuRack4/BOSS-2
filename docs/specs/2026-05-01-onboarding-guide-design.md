# Onboarding Guide — Design Spec

**Date:** 2026-05-01  
**Branch:** `feat-onboard`  
**Status:** Approved

---

## 개요

신규 회원가입 후 첫 로그인 시 BOSS-2의 핵심 기능을 스포트라이트 투어 방식으로 안내하는 온보딩 가이드.

---

## 1. UX 방식 — 스포트라이트 투어

- 화면 전체에 반투명 어두운 오버레이(rgba(0,0,0,0.7))를 깔고, 소개할 UI 요소만 밝게 노출
- 구현 기법: `box-shadow: 0 0 0 9999px rgba(0,0,0,0.7)` — 외부 라이브러리 없음
- 하이라이트 요소 옆에 툴팁(말풍선) 표시, 위치는 스텝마다 다름(위/아래/좌/우)
- "다음" / "건너뛰기" 버튼, 하단 dot indicator로 진행 상황 표시

---

## 2. 트리거 조건

| 상황 | 동작 |
|------|------|
| 첫 로그인 (`profiles.onboarding_done = false`) | 자동으로 투어 시작 |
| 투어 완료 또는 건너뛰기 | `onboarding_done = true` 저장, 이후 미노출 |
| 헤더 "가이드 다시 보기" 버튼 클릭 | `onboarding_done` 무시하고 투어 강제 재시작 |

---

## 3. 8개 스텝 정의

| # | 제목 | `data-tour` 타겟 | 툴팁 위치 | 설명 |
|---|------|-----------------|----------|------|
| 1 | AI 채팅 | `chat-input` | 위 | "BOSS에게 매출 분석, 직원 관리, 마케팅 전략을 말로 요청하세요." |
| 2 | 도메인 메뉴 | `domain-nav` | 오른쪽 | "매출·채용·마케팅·문서 4개 도메인을 전환하며 각 분야 AI 기능을 사용하세요." |
| 3 | 대시보드 위젯 | `dashboard-widgets` | 아래 | "매출 현황, 활동 로그 등 핵심 지표를 한눈에 확인하세요." |
| 4 | 아티팩트 캔버스 | `artifact-canvas` | 왼쪽 | "AI에게 요청하면 결과물(채용공고, 마케팅 리포트 등)이 카드로 생성됩니다." |
| 5 | 아티팩트 상세 | `artifact-canvas` | 위 | "카드를 클릭하면 상세 내용을 확인하고 편집·다운로드할 수 있어요." |
| 6 | 스케줄 자동화 | `schedule-toggle` | 왼쪽 | "스케줄을 켜면 AI가 정해진 시간에 자동으로 작업을 실행해요." |
| 7 | 프로필 설정 | `profile-menu` | 아래 | "업종·지역·목표를 설정하면 AI가 더 정확한 맞춤 제안을 드려요." |
| 8 | 장기 기억 | `memory-badge` | 아래 | "BOSS는 대화 내용을 장기 기억에 저장해 다음 대화에도 맥락을 유지해요." |

---

## 4. 완료 시 동작

투어 완료(또는 건너뛰기) 후:

1. `profiles.onboarding_done = true` Supabase 업데이트
2. 백엔드 `/chat` API로 다음 메시지 POST → LLM이 응답 생성:

```
안녕하세요! 저는 BOSS예요! 매출 분석, 채용 관리, 마케팅, 서류 작성까지 — 무엇이든 말씀해 주세요! [CHOICES] 매출 관리 요청하기/채용 관리 요청하기/마케팅 요청하기/서류 작성 요청하기[CHOICES]
```

기존 `InlineChat`의 `[CHOICES]` 파서가 자동으로 선택지 버튼을 렌더함.

---

## 5. 아키텍처 & 컴포넌트

### 신규 파일

```
frontend/components/onboarding/
├── OnboardingContext.tsx   — 전역 상태 (currentStep, isActive, start/next/skip/finish)
├── OnboardingTour.tsx      — 스포트라이트 오버레이 + 툴팁 렌더러
├── OnboardingTooltip.tsx   — 말풍선 UI (제목, 설명, 다음/건너뛰기, dot indicator)
└── steps.ts                — 8개 스텝 배열 (selector, 툴팁 텍스트, 위치)
```

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `frontend/app/providers.tsx` | `OnboardingProvider` 추가 |
| `frontend/components/layout/Header.tsx` (또는 해당 헤더 컴포넌트) | "가이드 다시 보기" 버튼 추가 |
| 각 대상 UI 컴포넌트 | `data-tour="..."` 속성 추가 |
| `frontend/components/auth/BossAuthPage.tsx` | 첫 로그인 시 투어 트리거 로직 |

### Supabase 마이그레이션

```sql
-- supabase/migrations/XXX_add_onboarding_done.sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_done boolean DEFAULT false;
```

---

## 6. 상태 관리 흐름

```
로그인 성공
  └→ profiles.onboarding_done 조회
       ├→ false → OnboardingTour 시작 (step 0)
       └→ true  → 투어 없음 (정상 대시보드)

투어 진행 중
  └→ next() → currentStep++
       └→ currentStep >= 8 → finish()
            ├→ profiles.onboarding_done = true (Supabase PATCH)
            └→ /chat API POST → LLM 인사 메시지 + [CHOICES]

건너뛰기
  └→ skip() → finish() (동일 흐름)

"가이드 다시 보기"
  └→ start() → currentStep = 0, isActive = true (DB 업데이트 없음)
```

---

## 7. 포지셔닝 로직

```typescript
// OnboardingTour.tsx 핵심 로직
const rect = document.querySelector(`[data-tour="${step.target}"]`)?.getBoundingClientRect();
// rect 좌표 기반으로 하이라이트 div 위치 설정
// box-shadow로 외부 어둡게, border로 하이라이트 테두리
// 툴팁은 step.tooltipPosition에 따라 rect 기준 offset 계산
```

`window.addEventListener('resize', recalculate)` 로 반응형 대응.

---

## 8. 미결 사항

- `data-tour` 속성을 붙일 정확한 컴포넌트 파일명은 구현 시 탐색
- `memory-badge` 타겟이 되는 UI 요소 존재 여부 확인 필요 (없으면 스텝 위치 조정)
- `schedule-toggle` 타겟은 아티팩트 상세 모달 내부에 있을 수 있어 접근 방식 별도 검토
