# Onboarding Tour Design

**Date:** 2026-05-02  
**Branch:** feat-onboard-2  
**Status:** Approved

---

## Overview

처음 회원가입하거나 사용법을 잊은 사용자를 위한 인터랙티브 투어. 대시보드의 각 그리드 아이템을 SVG mask 오버레이로 하이라이트하고 우측 사이드 패널로 설명한다.

---

## Trigger

1. **자동 시작**: 첫 가입 후 대시보드 진입 시 1회. `localStorage` 키 `boss_tour_done` 없으면 자동 시작, 완료/스킵 시 저장.
2. **수동 시작**: Header의 `Guide` 버튼 (Notice ↔ Logout 사이). 언제든 재시작 가능.

---

## Architecture

### 새 파일

| 파일 | 역할 |
|------|------|
| `frontend/components/tour/tourSteps.ts` | 12개 스텝 정의 (id, title, icon, description) |
| `frontend/components/tour/useTour.ts` | 투어 상태 훅 (step, isOpen, start, next, prev, close) |
| `frontend/components/tour/TourOverlay.tsx` | SVG mask 오버레이 + 사이드 패널 렌더 |

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/components/layout/Header.tsx` | Guide 버튼 추가, `useTour` 연결 |
| `frontend/app/dashboard/page.tsx` | `TourOverlay` 마운트 + 첫 가입 자동 시작 |
| 각 그리드 컴포넌트 12개 | `data-tour-id` 속성 추가 |

---

## SVG Mask Overlay

```
position: fixed, inset-0, z-index: 50

<svg width="100vw" height="100vh">
  <defs>
    <mask id="tour-mask">
      <rect width="100%" height="100%" fill="white" />
      <rect x y w h rx="8" fill="black" />  ← 타겟 영역 구멍
    </mask>
  </defs>
  <rect width="100%" height="100%"
        fill="rgba(0,0,0,0.55)"
        mask="url(#tour-mask)" />
</svg>
```

- 타겟 좌표: `document.querySelector('[data-tour-id="<id>"]').getBoundingClientRect()`
- `ResizeObserver` + `scroll` 이벤트로 실시간 재계산
- 하이라이트 rect는 8px 패딩 추가해 그리드 경계선과 겹치지 않게
- SVG 위에 `pointer-events: none` — 투어 중에도 스크롤 가능

---

## Side Panel

```
position: fixed
right: 24px (타겟이 화면 오른쪽 절반이면 left: 24px로 전환)
top: 50%, transform: translateY(-50%)
width: 280px, z-index: 51
배경: #faf8f4, border: #ddd0b4, rounded-[8px]
```

패널 구조:
```
┌──────────────────────────────┐
│  [Icon]  제목                │
│  ─────────────────────────   │
│  설명 텍스트 2~3줄            │
│                              │
│  3 / 12     [이전]  [다음]  [✕] │
└──────────────────────────────┘
```

- 아이콘: Lucide 컴포넌트, `h-5 w-5 text-[#4a7c59]`
- 이전/다음: Sand 테마 버튼 (`#4a7c59`)
- 마지막 스텝 다음 버튼 → "완료" 텍스트, 클릭 시 투어 종료

---

## Tour Steps

| # | data-tour-id | Icon (Lucide) | 제목 | 설명 |
|---|---|---|---|---|
| 1 | `chat` | `MessageSquare` | Chat | BOSS AI와 대화하는 메인 공간. 채용·마케팅·매출 등 자연어로 요청하면 자동으로 처리해줍니다. |
| 2 | `marketing` | `Megaphone` | 마케팅 | 인스타그램·네이버 블로그·유튜브 콘텐츠를 AI가 자동으로 기획하고 발행합니다. |
| 3 | `recruitment` | `Users` | 채용 | 채용 공고 작성, 이력서 검토, 면접 일정 관리를 한 곳에서 처리합니다. |
| 4 | `sales` | `TrendingUp` | 매출 | 일매출 입력·분석·목표 추적과 메뉴별 수익성을 한눈에 확인합니다. |
| 5 | `documents` | `FileText` | 서류 | 계약서·공지문·지원서류를 AI가 자동으로 작성하고 저장합니다. |
| 6 | `profiles` | `Store` | 프로필 | 사업장 정보와 목표를 설정합니다. 프로필이 상세할수록 AI 답변이 정확해집니다. |
| 7 | `longterm-memory` | `Brain` | 장기 메모리 | AI가 누적 학습한 내 사업장 인사이트를 확인하고 관리합니다. |
| 8 | `chat-history` | `Clock` | 대화 기록 | 이전 대화 세션을 다시 불러와 확인할 수 있습니다. |
| 9 | `upcoming-schedule` | `Calendar` | 예정 일정 | 자동화 스케줄과 예약된 AI 작업 목록을 확인합니다. |
| 10 | `recent-activity` | `Zap` | 최근 활동 | AI가 처리한 작업 로그와 결과를 시간순으로 확인합니다. |
| 11 | `memos` | `StickyNote` | 메모 | 빠른 메모를 저장하고 AI가 필요할 때 참고합니다. |
| 12 | `subsidy-matches` | `Target` | 지원사업 매칭 | 내 사업장 정보 기반으로 적합한 정부 지원사업을 자동 추천합니다. |

---

## data-tour-id 타겟 컴포넌트

| data-tour-id | 컴포넌트 |
|---|---|
| `chat` | `ChatCenterCard` |
| `marketing` | `DomainPage` (marketing) |
| `recruitment` | `DomainPage` (recruitment) |
| `sales` | `DomainPage` (sales) |
| `documents` | `DomainPage` (documents) |
| `profiles` | `ProfileMemorySidebar` |
| `longterm-memory` | `ProfileMemorySidebar` 내 장기 메모리 섹션 또는 Header의 LongTermMemory 버튼 |
| `chat-history` | `PreviousChatCard` |
| `upcoming-schedule` | `ScheduleCard` |
| `recent-activity` | `ActivityCard` |
| `memos` | `MemosWidget` |
| `subsidy-matches` | `SubsidyMatchCard` |

---

## State

```ts
interface TourState {
  isOpen: boolean;
  currentStep: number; // 0-indexed
}
```

`useTour` 훅:
- `start()` — `isOpen: true`, `currentStep: 0`
- `next()` — step + 1, 마지막이면 `close()`
- `prev()` — step - 1
- `close()` — `isOpen: false`, `localStorage.setItem("boss_tour_done", "1")`

---

## Edge Cases

- **그리드 아이템이 스크롤 밖에 있는 경우**: `scrollIntoView({ behavior: "smooth", block: "center" })` 후 재계산
- **타겟 요소를 못 찾는 경우**: 해당 스텝 스킵하고 다음으로 이동
- **모바일 (화면 좁음)**: 사이드 패널을 `bottom: 24px`, `left: 50%`, `transform: translateX(-50%)` 하단 고정으로 전환 (breakpoint: `< 768px`)
