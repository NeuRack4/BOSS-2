# Onboarding Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 그리드 아이템을 SVG mask 오버레이로 하나씩 하이라이트하고 우측 사이드 패널로 설명하는 인터랙티브 온보딩 투어를 구현한다.

**Architecture:** `TourContext`(전역 상태)를 `providers.tsx`에 추가하고, `TourOverlay`(SVG mask + 사이드 패널)를 `dashboard/page.tsx`에 마운트한다. `data-tour-id` 속성을 `BentoGrid`·`ProfileMemorySidebar`의 컨테이너 div에 추가해 타겟 좌표를 `getBoundingClientRect()`로 추적한다. 첫 가입 자동 시작은 `localStorage` 키로 제어한다.

**Tech Stack:** React 18, Next.js 16 App Router, Tailwind CSS, Lucide React, TypeScript

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/components/tour/tourSteps.ts` | 12개 스텝 정의 (id, title, icon name, description) |
| Create | `frontend/components/tour/TourContext.tsx` | 투어 상태 Context + Provider + `useTour` hook |
| Create | `frontend/components/tour/TourOverlay.tsx` | SVG mask 오버레이 + 사이드 패널 렌더 |
| Modify | `frontend/app/providers.tsx` | `TourProvider` 추가 |
| Modify | `frontend/components/layout/Header.tsx` | Guide 버튼 추가 (Notice ↔ Logout 사이) |
| Modify | `frontend/app/dashboard/page.tsx` | `TourOverlay` 마운트 + 첫 가입 자동 시작 |
| Modify | `frontend/components/bento/BentoGrid.tsx` | 컨테이너 div에 `data-tour-id` 추가 |
| Modify | `frontend/components/bento/ProfileMemorySidebar.tsx` | 사이드바 슬롯 div에 `data-tour-id` 추가 |

---

## Task 1: tourSteps.ts — 스텝 정의

**Files:**
- Create: `frontend/components/tour/tourSteps.ts`
- Test: `frontend/components/tour/__tests__/tourSteps.test.ts`

- [ ] **Step 1: 테스트 파일 생성**

```ts
// frontend/components/tour/__tests__/tourSteps.test.ts
import { TOUR_STEPS } from "../tourSteps";

describe("TOUR_STEPS", () => {
  it("has exactly 12 steps", () => {
    expect(TOUR_STEPS).toHaveLength(12);
  });

  it("each step has required fields", () => {
    for (const step of TOUR_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.iconName).toBeTruthy();
      expect(step.description).toBeTruthy();
    }
  });

  it("step ids are unique", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd frontend && npx jest components/tour/__tests__/tourSteps.test.ts
```

Expected: `Cannot find module '../tourSteps'`

- [ ] **Step 3: tourSteps.ts 구현**

```ts
// frontend/components/tour/tourSteps.ts
export type TourStep = {
  id: string;
  title: string;
  iconName: string;
  description: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "chat",
    title: "Chat",
    iconName: "MessageSquare",
    description: "BOSS AI와 대화하는 메인 공간. 채용·마케팅·매출 등 자연어로 요청하면 자동으로 처리해줍니다.",
  },
  {
    id: "marketing",
    title: "마케팅",
    iconName: "Megaphone",
    description: "인스타그램·네이버 블로그·유튜브 콘텐츠를 AI가 자동으로 기획하고 발행합니다.",
  },
  {
    id: "recruitment",
    title: "채용",
    iconName: "Users",
    description: "채용 공고 작성, 이력서 검토, 면접 일정 관리를 한 곳에서 처리합니다.",
  },
  {
    id: "sales",
    title: "매출",
    iconName: "TrendingUp",
    description: "일매출 입력·분석·목표 추적과 메뉴별 수익성을 한눈에 확인합니다.",
  },
  {
    id: "documents",
    title: "서류",
    iconName: "FileText",
    description: "계약서·공지문·지원서류를 AI가 자동으로 작성하고 저장합니다.",
  },
  {
    id: "profiles",
    title: "프로필",
    iconName: "Store",
    description: "사업장 정보와 목표를 설정합니다. 프로필이 상세할수록 AI 답변이 정확해집니다.",
  },
  {
    id: "longterm-memory",
    title: "장기 메모리",
    iconName: "Brain",
    description: "AI가 누적 학습한 내 사업장 인사이트를 확인하고 관리합니다.",
  },
  {
    id: "chat-history",
    title: "대화 기록",
    iconName: "Clock",
    description: "이전 대화 세션을 다시 불러와 확인할 수 있습니다.",
  },
  {
    id: "upcoming-schedule",
    title: "예정 일정",
    iconName: "Calendar",
    description: "자동화 스케줄과 예약된 AI 작업 목록을 확인합니다.",
  },
  {
    id: "recent-activity",
    title: "최근 활동",
    iconName: "Zap",
    description: "AI가 처리한 작업 로그와 결과를 시간순으로 확인합니다.",
  },
  {
    id: "memos",
    title: "메모",
    iconName: "StickyNote",
    description: "빠른 메모를 저장하고 AI가 필요할 때 참고합니다.",
  },
  {
    id: "subsidy-matches",
    title: "지원사업 매칭",
    iconName: "Target",
    description: "내 사업장 정보 기반으로 적합한 정부 지원사업을 자동 추천합니다.",
  },
];
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
cd frontend && npx jest components/tour/__tests__/tourSteps.test.ts
```

Expected: 3 tests passed

- [ ] **Step 5: 커밋**

```bash
git add frontend/components/tour/tourSteps.ts frontend/components/tour/__tests__/tourSteps.test.ts
git commit -m "feat(tour): tourSteps 12개 스텝 정의"
```

---

## Task 2: TourContext.tsx — 상태 관리

**Files:**
- Create: `frontend/components/tour/TourContext.tsx`
- Test: `frontend/components/tour/__tests__/TourContext.test.ts`

- [ ] **Step 1: 테스트 작성**

```ts
// frontend/components/tour/__tests__/TourContext.test.ts
import { renderHook, act } from "@testing-library/react";
import { TourProvider, useTour } from "../TourContext";
import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <TourProvider>{children}</TourProvider>
);

describe("useTour", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts closed", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.currentStep).toBe(0);
  });

  it("start() opens tour at step 0", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("next() advances step", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    act(() => result.current.next());
    expect(result.current.currentStep).toBe(1);
  });

  it("prev() decrements step, not below 0", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    act(() => result.current.prev());
    expect(result.current.currentStep).toBe(0);
    act(() => result.current.next());
    act(() => result.current.prev());
    expect(result.current.currentStep).toBe(0);
  });

  it("close() closes tour and sets localStorage", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
    expect(localStorage.getItem("boss_tour_done")).toBe("1");
  });

  it("next() on last step closes tour", () => {
    const { result } = renderHook(() => useTour(), { wrapper });
    act(() => result.current.start());
    // advance to last step (index 11)
    for (let i = 0; i < 11; i++) act(() => result.current.next());
    expect(result.current.currentStep).toBe(11);
    act(() => result.current.next());
    expect(result.current.isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd frontend && npx jest components/tour/__tests__/TourContext.test.ts
```

Expected: `Cannot find module '../TourContext'`

- [ ] **Step 3: TourContext.tsx 구현**

```tsx
// frontend/components/tour/TourContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { TOUR_STEPS } from "./tourSteps";

type TourContextValue = {
  isOpen: boolean;
  currentStep: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  close: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export const TourProvider = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const start = useCallback(() => {
    setCurrentStep(0);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem("boss_tour_done", "1");
  }, []);

  const next = useCallback(() => {
    setCurrentStep((s) => {
      if (s >= TOUR_STEPS.length - 1) {
        setIsOpen(false);
        localStorage.setItem("boss_tour_done", "1");
        return 0;
      }
      return s + 1;
    });
  }, []);

  const prev = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  return (
    <TourContext.Provider value={{ isOpen, currentStep, start, next, prev, close }}>
      {children}
    </TourContext.Provider>
  );
};

export const useTour = (): TourContextValue => {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used inside TourProvider");
  return ctx;
};
```

- [ ] **Step 4: 테스트 재실행 — PASS 확인**

```bash
cd frontend && npx jest components/tour/__tests__/TourContext.test.ts
```

Expected: 6 tests passed

- [ ] **Step 5: 커밋**

```bash
git add frontend/components/tour/TourContext.tsx frontend/components/tour/__tests__/TourContext.test.ts
git commit -m "feat(tour): TourContext 상태 관리"
```

---

## Task 3: TourOverlay.tsx — SVG mask + 사이드 패널

**Files:**
- Create: `frontend/components/tour/TourOverlay.tsx`

> 이 컴포넌트는 DOM 좌표 계산에 의존하므로 Jest 단위 테스트 대신 Task 8 이후 수동 브라우저 검증으로 대체한다.

- [ ] **Step 1: TourOverlay.tsx 구현**

```tsx
// frontend/components/tour/TourOverlay.tsx
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  MessageSquare,
  Megaphone,
  Users,
  TrendingUp,
  FileText,
  Store,
  Brain,
  Clock,
  Calendar,
  Zap,
  StickyNote,
  Target,
  ChevronLeft,
  ChevronRight,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTour } from "./TourContext";
import { TOUR_STEPS } from "./tourSteps";

const ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare,
  Megaphone,
  Users,
  TrendingUp,
  FileText,
  Store,
  Brain,
  Clock,
  Calendar,
  Zap,
  StickyNote,
  Target,
};

const PADDING = 10;

type Rect = { x: number; y: number; width: number; height: number };

export const TourOverlay = () => {
  const { isOpen, currentStep, next, prev, close } = useTour();
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const rafRef = useRef<number>(0);

  const updateRect = useCallback(() => {
    const step = TOUR_STEPS[currentStep];
    if (!step) return;
    const el = document.querySelector(`[data-tour-id="${step.id}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTargetRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [currentStep]);

  // Scroll target into view then update rect
  useEffect(() => {
    if (!isOpen) return;
    const step = TOUR_STEPS[currentStep];
    if (!step) return;
    const el = document.querySelector(`[data-tour-id="${step.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Wait for scroll animation
      const t = setTimeout(updateRect, 350);
      return () => clearTimeout(t);
    } else {
      // Element not found (e.g. sidebar hidden on small screen) — skip step
      next();
    }
  }, [isOpen, currentStep, updateRect, next]);

  // Track rect on scroll + resize
  useEffect(() => {
    if (!isOpen) return;
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateRect);
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateRect);
    });
    window.addEventListener("scroll", onScroll, true);
    const step = TOUR_STEPS[currentStep];
    const el = step
      ? document.querySelector(`[data-tour-id="${step.id}"]`)
      : null;
    if (el) ro.observe(el);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, currentStep, updateRect]);

  if (!isOpen || !targetRect) return null;

  const step = TOUR_STEPS[currentStep];
  const Icon = ICON_MAP[step.iconName] ?? MessageSquare;

  const mx = targetRect.x + targetRect.width / 2;
  const panelOnLeft = mx > window.innerWidth / 2;
  const isMobile = window.innerWidth < 768;

  const maskX = targetRect.x - PADDING;
  const maskY = targetRect.y - PADDING;
  const maskW = targetRect.width + PADDING * 2;
  const maskH = targetRect.height + PADDING * 2;

  return (
    <>
      {/* SVG overlay */}
      <svg
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 50,
          pointerEvents: "none",
        }}
      >
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={maskX}
              y={maskY}
              width={maskW}
              height={maskH}
              rx={8}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tour-mask)"
        />
      </svg>

      {/* Side panel */}
      <div
        style={{
          position: "fixed",
          zIndex: 51,
          width: 280,
          ...(isMobile
            ? {
                bottom: 24,
                left: "50%",
                transform: "translateX(-50%)",
              }
            : panelOnLeft
            ? {
                left: 24,
                top: "50%",
                transform: "translateY(-50%)",
              }
            : {
                right: 24,
                top: "50%",
                transform: "translateY(-50%)",
              }),
        }}
        className="rounded-[8px] border border-[#ddd0b4] bg-[#faf8f4] p-4 shadow-xl"
      >
        {/* Header */}
        <div className="mb-3 flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-[#4a7c59]" />
          <span className="text-[15px] font-semibold text-[#2e2719]">
            {step.title}
          </span>
        </div>

        {/* Divider */}
        <hr className="mb-3 border-[#ddd0b4]" />

        {/* Description */}
        <p className="text-[13px] leading-relaxed text-[#5a5040]">
          {step.description}
        </p>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] text-[#030303]/40">
            {currentStep + 1} / {TOUR_STEPS.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prev}
              disabled={currentStep === 0}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[#5a5040] transition-colors hover:bg-[#ebe0ca] disabled:opacity-30"
              aria-label="이전"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={next}
              className="flex h-7 items-center gap-1 rounded-[5px] bg-[#4a7c59] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#3d6a4a]"
            >
              {currentStep === TOUR_STEPS.length - 1 ? "완료" : "다음"}
              {currentStep < TOUR_STEPS.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={close}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[#5a5040] transition-colors hover:bg-[#ebe0ca]"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/tour/TourOverlay.tsx
git commit -m "feat(tour): TourOverlay SVG mask + 사이드 패널"
```

---

## Task 4: BentoGrid — data-tour-id 추가

**Files:**
- Modify: `frontend/components/bento/BentoGrid.tsx`

- [ ] **Step 1: BentoGrid.tsx 수정 — 각 컨테이너 div에 data-tour-id 추가**

`frontend/components/bento/BentoGrid.tsx` 의 return 내부를 아래와 같이 수정한다.

```tsx
return (
  <div className="flex w-full justify-center gap-4 p-4 md:p-6">
    <ProfileMemorySidebar renderProps={rp} />
    <div className="w-full max-w-[1400px]">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:auto-rows-[140px] md:gap-4">
        {/* Chat */}
        <div
          data-tour-id="chat"
          className="order-1 md:col-span-6 md:row-span-5 md:col-start-1 md:row-start-1 h-[560px] md:h-auto"
        >
          <ChatCenterCard />
        </div>

        {/* Col 7-9: recruitment + sales */}
        <div className="order-2 md:col-span-3 md:row-span-4 md:col-start-7 md:row-start-1 flex flex-col gap-3 md:gap-4">
          <div data-tour-id="recruitment" className="h-[160px] md:h-auto md:flex-[4]">
            <WidgetSlot slotId="main-col7-top" renderProps={rp} />
          </div>
          <div data-tour-id="sales" className="h-[160px] md:h-auto md:flex-[6]">
            <WidgetSlot slotId="main-col7-bottom" renderProps={rp} />
          </div>
        </div>

        {/* Col 10-12: marketing + documents */}
        <div className="order-3 md:col-span-3 md:row-span-4 md:col-start-10 md:row-start-1 flex flex-col gap-3 md:gap-4">
          <div data-tour-id="marketing" className="h-[160px] md:h-auto md:flex-[6]">
            <WidgetSlot slotId="main-col10-top" renderProps={rp} />
          </div>
          <div data-tour-id="documents" className="h-[160px] md:h-auto md:flex-[4]">
            <WidgetSlot slotId="main-col10-bottom" renderProps={rp} />
          </div>
        </div>

        {/* Previous Chat */}
        <div
          data-tour-id="chat-history"
          className="order-6 md:col-span-3 md:row-span-3 md:col-start-1 md:row-start-6 h-[420px] md:h-auto"
        >
          <WidgetSlot slotId="main-prev-chat" renderProps={rp} />
        </div>

        {/* Schedule */}
        <div
          data-tour-id="upcoming-schedule"
          className="order-7 md:col-span-3 md:row-span-3 md:col-start-4 md:row-start-6 h-[420px] md:h-auto"
        >
          <WidgetSlot slotId="main-schedule" renderProps={rp} />
        </div>

        {/* Activity */}
        <div
          data-tour-id="recent-activity"
          className="order-8 md:col-span-6 md:row-span-2 md:col-start-7 md:row-start-5 h-[284px] md:h-auto"
        >
          <WidgetSlot slotId="main-activity" renderProps={rp} />
        </div>

        {/* Subsidy */}
        <div
          data-tour-id="subsidy-matches"
          className="order-10 md:col-span-6 md:row-span-2 md:col-start-7 md:row-start-7 h-[284px] md:h-auto"
        >
          <WidgetSlot slotId="main-subsidy" renderProps={rp} />
        </div>
      </div>
    </div>

    {loading && !summary && !ctx?.isEditing && (
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
        <div className="rounded-full bg-[#fcfcfc] px-4 py-1.5 text-xs text-[#030303] shadow-lg">
          불러오는 중...
        </div>
      </div>
    )}
  </div>
);
```

> 주의: order-4, order-5, order-9 slot이 원본에 없다면 그대로 둔다. 원본 순서를 유지하되 data-tour-id만 추가한다.

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/bento/BentoGrid.tsx
git commit -m "feat(tour): BentoGrid data-tour-id 추가"
```

---

## Task 5: ProfileMemorySidebar — data-tour-id 추가

**Files:**
- Modify: `frontend/components/bento/ProfileMemorySidebar.tsx`

- [ ] **Step 1: ProfileMemorySidebar.tsx 수정**

```tsx
// frontend/components/bento/ProfileMemorySidebar.tsx
"use client";

import { WidgetSlot } from "./WidgetSlot";
import type { WidgetRenderProps } from "./widgetRegistry";

type Props = {
  renderProps: WidgetRenderProps;
};

export const ProfileMemorySidebar = ({ renderProps }: Props) => (
  <aside
    className="hidden min-w-[220px] max-w-[320px] flex-1 basis-0 flex-col gap-4 self-stretch min-[1500px]:flex"
    aria-label="프로필 및 기억"
  >
    <div data-tour-id="profiles" className="min-h-0 flex-1 basis-0">
      <WidgetSlot slotId="sidebar-0" renderProps={renderProps} />
    </div>
    <div data-tour-id="longterm-memory" className="min-h-0 flex-1 basis-0">
      <WidgetSlot slotId="sidebar-1" renderProps={renderProps} />
    </div>
    <div data-tour-id="memos" className="min-h-0 flex-[0.75] basis-0">
      <WidgetSlot slotId="sidebar-2" renderProps={renderProps} />
    </div>
  </aside>
);
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/bento/ProfileMemorySidebar.tsx
git commit -m "feat(tour): ProfileMemorySidebar data-tour-id 추가"
```

---

## Task 6: providers.tsx — TourProvider 추가

**Files:**
- Modify: `frontend/app/providers.tsx`

- [ ] **Step 1: TourProvider import 및 적용**

```tsx
// frontend/app/providers.tsx
"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";
import { AdminFab } from "@/components/layout/AdminFab";
import { TourProvider } from "@/components/tour/TourContext";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <TourProvider>
    <ChatProvider>
      <NodeDetailProvider>
        {children}
        <AdminFab />
      </NodeDetailProvider>
    </ChatProvider>
  </TourProvider>
);
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/app/providers.tsx
git commit -m "feat(tour): providers에 TourProvider 추가"
```

---

## Task 7: Header — Guide 버튼 추가

**Files:**
- Modify: `frontend/components/layout/Header.tsx`

- [ ] **Step 1: Guide 버튼 추가**

`Header.tsx`의 lucide import에 `BookOpen` 추가:

```tsx
import { CalendarDays, Activity as ActivityIcon, Bell, BookOpen } from "lucide-react";
```

`useTour` import 추가 (파일 상단 import 블록 어딘가에):

```tsx
import { useTour } from "@/components/tour/TourContext";
```

`Header` 컴포넌트 함수 내부에 hook 추가 (기존 `const router = useRouter();` 바로 아래):

```tsx
const { start: startTour } = useTour();
```

Notice 버튼과 Logout 버튼 사이에 Guide 버튼 삽입:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => setNoticeOpen(true)}
  title="Notice"
  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
>
  <Bell className="h-4 w-4 shrink-0" />
  <span className="hidden sm:inline">Notice</span>
</Button>
{/* Guide 버튼 — Notice 와 Logout 사이 */}
<Button
  variant="ghost"
  size="sm"
  onClick={startTour}
  title="사용 가이드"
  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
>
  <BookOpen className="h-4 w-4 shrink-0" />
  <span className="hidden sm:inline">Guide</span>
</Button>
<Button
  variant="ghost"
  size="sm"
  onClick={handleLogout}
  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
>
  Logout
</Button>
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/layout/Header.tsx
git commit -m "feat(tour): Header에 Guide 버튼 추가"
```

---

## Task 8: dashboard/page.tsx — TourOverlay 마운트 + 자동 시작

**Files:**
- Modify: `frontend/app/dashboard/page.tsx`

- [ ] **Step 1: TourOverlay 마운트 + 첫 가입 자동 시작 로직 추가**

```tsx
// frontend/app/dashboard/page.tsx
"use client";

import { useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { BriefingLoader } from "@/components/chat/BriefingLoader";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { LayoutProvider } from "@/components/bento/LayoutContext";
import { useChat } from "@/components/chat/ChatContext";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { useTour } from "@/components/tour/TourContext";

export default function DashboardPage() {
  const { userId } = useChat();
  const { start } = useTour();

  // 첫 가입 자동 시작
  useEffect(() => {
    if (!userId) return;
    if (!localStorage.getItem("boss_tour_done")) {
      // 대시보드 그리드가 렌더된 후 시작
      const t = setTimeout(start, 800);
      return () => clearTimeout(t);
    }
  }, [userId, start]);

  return (
    <LayoutProvider accountId={userId ?? ""}>
      <div className="bento-shell flex h-screen flex-col overflow-hidden">
        <Header sidebar />
        <main className="flex-1 overflow-auto">
          {userId ? (
            <BentoGrid accountId={userId} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[#030303]/40">
              불러오는 중...
            </div>
          )}
        </main>
        <BriefingLoader />
        <TourOverlay />
      </div>
    </LayoutProvider>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/app/dashboard/page.tsx
git commit -m "feat(tour): dashboard에 TourOverlay 마운트 + 자동 시작"
```

---

## Task 9: 수동 브라우저 검증

- [ ] **Step 1: dev 서버 실행**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: 첫 가입 자동 시작 확인**

1. `localStorage.removeItem("boss_tour_done")` 실행 (브라우저 콘솔)
2. 페이지 새로고침
3. 800ms 후 투어 자동 시작 확인
4. `chat` 그리드가 하이라이트되고 SVG 딤처리 확인
5. 사이드 패널에 "Chat" 제목 + MessageSquare 아이콘 확인

- [ ] **Step 3: 투어 순서 전체 검증**

다음/이전 버튼으로 12개 스텝 순서 확인:
- chat → marketing → recruitment → sales → documents → profiles → longterm-memory → chat-history → upcoming-schedule → recent-activity → memos → subsidy-matches

각 스텝에서:
- 해당 그리드 아이템만 밝게 하이라이트
- SVG 나머지 영역 딤처리
- 사이드 패널 제목/설명/아이콘 일치
- 스텝 카운터 (N / 12) 정확

- [ ] **Step 4: Guide 버튼 확인**

1. Header의 Notice ↔ Logout 사이에 Guide 버튼 존재
2. 클릭 시 투어 재시작 (step 0)
3. `localStorage`에 `boss_tour_done` 있어도 재시작 가능

- [ ] **Step 5: 닫기 확인**

✕ 버튼 클릭 → 투어 종료 → `localStorage.getItem("boss_tour_done") === "1"`

- [ ] **Step 6: 사이드 패널 위치 확인**

화면 오른쪽 절반 그리드(marketing, documents 등) 하이라이트 시 패널이 왼쪽으로 전환되는지 확인

- [ ] **Step 7: 최종 커밋**

```bash
git add -A
git commit -m "feat(tour): 온보딩 투어 완성"
```
