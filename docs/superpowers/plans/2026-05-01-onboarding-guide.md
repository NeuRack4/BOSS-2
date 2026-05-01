# Onboarding Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 회원가입 후 첫 로그인 시 스포트라이트 투어로 핵심 기능 8개를 안내하고, 완료 후 AI 인사 메시지를 띄운다.

**Architecture:** `OnboardingContext`(전역 상태) + `OnboardingTour`(스포트라이트 렌더러)를 `providers.tsx`에 마운트. 투어 타겟 요소에 `data-tour` 속성 추가. `profiles.onboarding_done` 컬럼으로 완료 상태를 Supabase에 저장.

**Tech Stack:** Next.js 16 App Router, React Context, Supabase client (`@/lib/supabase/client`), Tailwind CSS, `box-shadow` 스포트라이트 기법

---

## File Map

| 역할 | 경로 | 신규/수정 |
|------|------|---------|
| Supabase 마이그레이션 | `supabase/migrations/046_add_onboarding_done.sql` | 신규 |
| 스텝 정의 배열 | `frontend/components/onboarding/steps.ts` | 신규 |
| 전역 상태 Context | `frontend/components/onboarding/OnboardingContext.tsx` | 신규 |
| 툴팁 UI | `frontend/components/onboarding/OnboardingTooltip.tsx` | 신규 |
| 스포트라이트 렌더러 | `frontend/components/onboarding/OnboardingTour.tsx` | 신규 |
| Provider 등록 | `frontend/app/providers.tsx` | 수정 |
| 헤더 버튼 | `frontend/components/layout/Header.tsx` | 수정 |
| 채팅 입력 타겟 | `frontend/components/chat/InlineChat.tsx` | 수정 (data-tour 추가) |
| 도메인 메뉴 타겟 | 탐색 후 `data-tour="domain-nav"` 추가 | 수정 |
| 위젯 타겟 | `frontend/components/bento/BentoGrid.tsx` | 수정 (data-tour 추가) |
| 아티팩트 캔버스 타겟 | 탐색 후 `data-tour="artifact-canvas"` 추가 | 수정 |
| 프로필 버튼 타겟 | `frontend/components/layout/Header.tsx` | 수정 (data-tour 추가) |
| 장기 기억 버튼 타겟 | `frontend/components/layout/Header.tsx` | 수정 (data-tour 추가) |

---

## Task 1: Supabase 마이그레이션

**Files:**
- Create: `supabase/migrations/046_add_onboarding_done.sql`

- [ ] **Step 1: 마이그레이션 파일 생성**

```sql
-- supabase/migrations/046_add_onboarding_done.sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_done boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Supabase SQL Editor 또는 MCP로 실행**

Supabase 대시보드 SQL Editor에서 위 SQL 실행. 또는:
```
mcp__plugin_supabase_supabase__execute_sql 로 실행
```

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/046_add_onboarding_done.sql
git commit -m "feat(db): profiles에 onboarding_done 컬럼 추가"
```

---

## Task 2: 스텝 정의 배열

**Files:**
- Create: `frontend/components/onboarding/steps.ts`

- [ ] **Step 1: steps.ts 작성**

```typescript
// frontend/components/onboarding/steps.ts

export type TooltipPosition = "top" | "bottom" | "left" | "right";

export type OnboardingStep = {
  target: string;           // data-tour 값
  title: string;
  description: string;
  position: TooltipPosition;
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    target: "chat-input",
    title: "💬 AI 채팅",
    description: "BOSS에게 매출 분석, 직원 관리, 마케팅 전략을 말로 요청하세요.",
    position: "top",
  },
  {
    target: "domain-nav",
    title: "📍 도메인 메뉴",
    description: "매출·채용·마케팅·문서 4개 도메인을 전환하며 각 분야 AI 기능을 사용하세요.",
    position: "right",
  },
  {
    target: "dashboard-widgets",
    title: "📊 대시보드 위젯",
    description: "매출 현황, 활동 로그 등 핵심 지표를 한눈에 확인하세요.",
    position: "bottom",
  },
  {
    target: "artifact-canvas",
    title: "🗂 아티팩트 캔버스",
    description: "AI에게 요청하면 결과물(채용공고, 마케팅 리포트 등)이 카드로 생성됩니다.",
    position: "left",
  },
  {
    target: "artifact-canvas",
    title: "🔍 상세 보기",
    description: "카드를 클릭하면 상세 내용을 확인하고 편집·다운로드할 수 있어요.",
    position: "top",
  },
  {
    target: "schedule-toggle",
    title: "⏰ 스케줄 자동화",
    description: "스케줄을 켜면 AI가 정해진 시간에 자동으로 작업을 실행해요.",
    position: "left",
  },
  {
    target: "profile-menu",
    title: "👤 프로필 설정",
    description: "업종·지역·목표를 설정하면 AI가 더 정확한 맞춤 제안을 드려요.",
    position: "bottom",
  },
  {
    target: "memory-badge",
    title: "🧠 장기 기억",
    description: "BOSS는 대화 내용을 장기 기억에 저장해 다음 대화에도 맥락을 유지해요.",
    position: "bottom",
  },
];

export const ONBOARDING_COMPLETION_MESSAGE =
  "안녕하세요! 저는 BOSS예요! 매출 분석, 채용 관리, 마케팅, 서류 작성까지 — 무엇이든 말씀해 주세요! [CHOICES] 매출 관리 요청하기/채용 관리 요청하기/마케팅 요청하기/서류 작성 요청하기[CHOICES]";
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/onboarding/steps.ts
git commit -m "feat(onboarding): 스텝 정의 배열 추가"
```

---

## Task 3: OnboardingContext

**Files:**
- Create: `frontend/components/onboarding/OnboardingContext.tsx`

- [ ] **Step 1: OnboardingContext.tsx 작성**

```typescript
// frontend/components/onboarding/OnboardingContext.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { ONBOARDING_STEPS } from "./steps";

type OnboardingContextValue = {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  next: () => void;
  skip: () => void;
  startTour: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export const useOnboarding = (): OnboardingContextValue => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used inside <OnboardingProvider>");
  return ctx;
};

export const OnboardingProvider = ({ children }: { children: ReactNode }) => {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);

  // 유저 ID 구독
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // 첫 로그인 여부 확인 → 투어 자동 시작
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("onboarding_done")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (data && !(data as { onboarding_done: boolean }).onboarding_done) {
          setCurrentStep(0);
          setIsActive(true);
        }
      });
  }, [userId]);

  const finish = useCallback(async () => {
    setIsActive(false);
    if (!userId) return;
    const supabase = createClient();
    await supabase
      .from("profiles")
      .update({ onboarding_done: true })
      .eq("id", userId);
    // 완료 메시지는 OnboardingTour에서 openChatWithBriefing으로 처리
    window.dispatchEvent(new CustomEvent("boss:onboarding-complete"));
  }, [userId]);

  const next = useCallback(() => {
    if (currentStep + 1 >= ONBOARDING_STEPS.length) {
      void finish();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep, finish]);

  const skip = useCallback(() => {
    void finish();
  }, [finish]);

  const startTour = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const value = useMemo(
    () => ({ isActive, currentStep, totalSteps: ONBOARDING_STEPS.length, next, skip, startTour }),
    [isActive, currentStep, next, skip, startTour],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
};
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/onboarding/OnboardingContext.tsx
git commit -m "feat(onboarding): OnboardingContext 추가"
```

---

## Task 4: OnboardingTooltip

**Files:**
- Create: `frontend/components/onboarding/OnboardingTooltip.tsx`

- [ ] **Step 1: OnboardingTooltip.tsx 작성**

```typescript
// frontend/components/onboarding/OnboardingTooltip.tsx
"use client";

import { TooltipPosition } from "./steps";

type Props = {
  title: string;
  description: string;
  currentStep: number;
  totalSteps: number;
  position: TooltipPosition;
  targetRect: DOMRect;
  onNext: () => void;
  onSkip: () => void;
};

const TOOLTIP_GAP = 12; // px between highlight border and tooltip
const TOOLTIP_W = 220;

export const OnboardingTooltip = ({
  title,
  description,
  currentStep,
  totalSteps,
  position,
  targetRect,
  onNext,
  onSkip,
}: Props) => {
  const style = getTooltipStyle(position, targetRect);

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 10001,
        width: TOOLTIP_W,
        background: "#fff",
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        ...style,
      }}
    >
      <p style={{ fontWeight: 700, fontSize: 13, color: "#3a2e1e", marginBottom: 6 }}>
        {title}
      </p>
      <p style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 12 }}>
        {description}
      </p>

      {/* Dot indicator */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: i === currentStep ? "#c9a96e" : "#ddd",
              display: "inline-block",
            }}
          />
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={onSkip}
          style={{
            fontSize: 11,
            color: "#aaa",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          건너뛰기
        </button>
        <button
          onClick={onNext}
          style={{
            fontSize: 12,
            background: "#c9a96e",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            padding: "5px 14px",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {currentStep === totalSteps - 1 ? "완료 🎉" : "다음 →"}
        </button>
      </div>
    </div>
  );
};

const getTooltipStyle = (
  position: TooltipPosition,
  rect: DOMRect,
): React.CSSProperties => {
  switch (position) {
    case "top":
      return {
        left: rect.left + rect.width / 2 - TOOLTIP_W / 2,
        top: rect.top - TOOLTIP_GAP - 140, // 140 ≈ tooltip height estimate
      };
    case "bottom":
      return {
        left: rect.left + rect.width / 2 - TOOLTIP_W / 2,
        top: rect.bottom + TOOLTIP_GAP,
      };
    case "left":
      return {
        left: rect.left - TOOLTIP_W - TOOLTIP_GAP,
        top: rect.top + rect.height / 2 - 70,
      };
    case "right":
      return {
        left: rect.right + TOOLTIP_GAP,
        top: rect.top + rect.height / 2 - 70,
      };
  }
};
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/onboarding/OnboardingTooltip.tsx
git commit -m "feat(onboarding): OnboardingTooltip UI 컴포넌트 추가"
```

---

## Task 5: OnboardingTour (스포트라이트 렌더러)

**Files:**
- Create: `frontend/components/onboarding/OnboardingTour.tsx`

- [ ] **Step 1: OnboardingTour.tsx 작성**

```typescript
// frontend/components/onboarding/OnboardingTour.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnboarding } from "./OnboardingContext";
import { OnboardingTooltip } from "./OnboardingTooltip";
import { ONBOARDING_STEPS, ONBOARDING_COMPLETION_MESSAGE } from "./steps";
import { useChat } from "@/components/chat/ChatContext";

const PADDING = 8; // px padding around highlighted element

export const OnboardingTour = () => {
  const { isActive, currentStep, totalSteps, next, skip } = useOnboarding();
  const { openChatWithBriefing } = useChat();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = ONBOARDING_STEPS[currentStep];

  // 완료 이벤트 수신 → 인사 메시지 주입
  useEffect(() => {
    const handler = () => {
      openChatWithBriefing(ONBOARDING_COMPLETION_MESSAGE);
    };
    window.addEventListener("boss:onboarding-complete", handler);
    return () => window.removeEventListener("boss:onboarding-complete", handler);
  }, [openChatWithBriefing]);

  // 타겟 요소 좌표 계산
  const recalculate = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [step]);

  useEffect(() => {
    if (!isActive) return;
    recalculate();
    window.addEventListener("resize", recalculate);
    window.addEventListener("scroll", recalculate, true);
    return () => {
      window.removeEventListener("resize", recalculate);
      window.removeEventListener("scroll", recalculate, true);
    };
  }, [isActive, recalculate]);

  if (!isActive || !step) return null;

  const highlight = targetRect
    ? {
        left: targetRect.left - PADDING,
        top: targetRect.top - PADDING,
        width: targetRect.width + PADDING * 2,
        height: targetRect.height + PADDING * 2,
      }
    : null;

  return (
    <>
      {/* 전체 오버레이 — 클릭 차단 */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: "all",
        }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* 스포트라이트 하이라이트 */}
      {highlight && (
        <div
          style={{
            position: "fixed",
            zIndex: 10000,
            left: highlight.left,
            top: highlight.top,
            width: highlight.width,
            height: highlight.height,
            borderRadius: 10,
            // 핵심: 이 요소의 box-shadow가 바깥을 어둡게 만든다
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.72)",
            border: "2px solid rgba(201,169,110,0.7)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* 툴팁 */}
      {targetRect && (
        <OnboardingTooltip
          title={step.title}
          description={step.description}
          currentStep={currentStep}
          totalSteps={totalSteps}
          position={step.position}
          targetRect={targetRect}
          onNext={next}
          onSkip={skip}
        />
      )}

      {/* 타겟을 찾지 못했을 때 중앙 폴백 툴팁 */}
      {!targetRect && (
        <div
          style={{
            position: "fixed",
            zIndex: 10001,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#fff",
            borderRadius: 12,
            padding: "20px 24px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            width: 260,
            textAlign: "center",
          }}
        >
          <p style={{ fontWeight: 700, fontSize: 13, color: "#3a2e1e", marginBottom: 6 }}>
            {step.title}
          </p>
          <p style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 14 }}>
            {step.description}
          </p>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <button onClick={skip} style={{ fontSize: 11, color: "#aaa", background: "none", border: "none", cursor: "pointer" }}>
              건너뛰기
            </button>
            <button
              onClick={next}
              style={{ fontSize: 12, background: "#c9a96e", color: "#fff", border: "none", borderRadius: 7, padding: "5px 14px", cursor: "pointer", fontWeight: 600 }}
            >
              {currentStep === totalSteps - 1 ? "완료 🎉" : "다음 →"}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/onboarding/OnboardingTour.tsx
git commit -m "feat(onboarding): OnboardingTour 스포트라이트 렌더러 추가"
```

---

## Task 6: providers.tsx에 OnboardingProvider 등록

**Files:**
- Modify: `frontend/app/providers.tsx`

현재 파일:
```typescript
"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";
import { AdminFab } from "@/components/layout/AdminFab";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>
    <NodeDetailProvider>
      {children}
      <AdminFab />
    </NodeDetailProvider>
  </ChatProvider>
);
```

- [ ] **Step 1: providers.tsx 수정**

```typescript
"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";
import { AdminFab } from "@/components/layout/AdminFab";
import { OnboardingProvider } from "@/components/onboarding/OnboardingContext";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>
    <NodeDetailProvider>
      <OnboardingProvider>
        {children}
        <AdminFab />
        <OnboardingTour />
      </OnboardingProvider>
    </NodeDetailProvider>
  </ChatProvider>
);
```

> `OnboardingTour`는 `ChatProvider` 하위에 있어야 `useChat()`을 사용할 수 있다. `OnboardingProvider`는 `ChatProvider` 하위이면 어디든 가능.

- [ ] **Step 2: 커밋**

```bash
git add frontend/app/providers.tsx
git commit -m "feat(onboarding): providers에 OnboardingProvider + OnboardingTour 등록"
```

---

## Task 7: data-tour 속성 추가

**Files:**
- Modify: `frontend/components/chat/InlineChat.tsx` (chat-input)
- Modify: 도메인 메뉴 컴포넌트 (domain-nav) — 탐색 필요
- Modify: `frontend/components/bento/BentoGrid.tsx` (dashboard-widgets, artifact-canvas)
- Modify: `frontend/components/layout/Header.tsx` (profile-menu, memory-badge)

> **주의:** `schedule-toggle`은 아티팩트 상세 모달(NodeDetailModal) 내부에 존재할 가능성이 높다. 뷰포트에 보이지 않으면 `OnboardingTour`가 폴백 중앙 툴팁을 표시한다 — 이 동작은 이미 구현되어 있으므로 무방하다.

- [ ] **Step 1: InlineChat.tsx에서 채팅 입력창 찾아 data-tour 추가**

`frontend/components/chat/InlineChat.tsx`를 열어 채팅 입력 `<textarea>` 또는 그것을 감싸는 `<div>`를 찾는다. 예:

```tsx
// 기존
<div className="chat-input-wrap ...">
  <textarea .../>
</div>

// 수정
<div className="chat-input-wrap ..." data-tour="chat-input">
  <textarea .../>
</div>
```

- [ ] **Step 2: 도메인 메뉴 컴포넌트 탐색 및 data-tour 추가**

```bash
grep -r "domain\|Domain\|recruitment\|marketing\|sales\|documents" frontend/components/layout/ --include="*.tsx" -l
```

좌측 사이드바 또는 탭 네비게이션에서 도메인 전환 UI를 찾아 `data-tour="domain-nav"` 추가.

- [ ] **Step 3: BentoGrid.tsx에 위젯·캔버스 data-tour 추가**

`frontend/components/bento/BentoGrid.tsx`를 열어:
- 위젯 영역 컨테이너에 `data-tour="dashboard-widgets"` 추가
- 아티팩트 카드 리스트/캔버스 컨테이너에 `data-tour="artifact-canvas"` 추가

- [ ] **Step 4: Header.tsx에 프로필·메모리 data-tour 추가**

`frontend/components/layout/Header.tsx`에서:
- 프로필 버튼(`boss:open-profile-modal` 이벤트 발생 버튼)에 `data-tour="profile-menu"` 추가
- 장기 기억 버튼(`boss:open-longmem-modal` 이벤트 발생 버튼)에 `data-tour="memory-badge"` 추가

Header.tsx에 장기 기억 버튼이 없다면 아이콘 버튼 하나를 추가한다:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => setLongMemOpen(true)}
  data-tour="memory-badge"
  title="장기 기억"
  className="text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
>
  🧠
</Button>
```

- [ ] **Step 5: schedule-toggle 탐색**

```bash
grep -r "schedule_enabled\|scheduleEnabled\|schedule-toggle" frontend/components/ --include="*.tsx" -l
```

토글을 감싸는 요소에 `data-tour="schedule-toggle"` 추가. 모달 내부에 있으면 해당 스텝에서 폴백 중앙 툴팁이 표시된다 — 동작상 무방.

- [ ] **Step 6: 커밋**

```bash
git add frontend/components/chat/InlineChat.tsx \
        frontend/components/bento/BentoGrid.tsx \
        frontend/components/layout/Header.tsx
# 도메인 메뉴 파일도 추가
git commit -m "feat(onboarding): data-tour 속성 추가"
```

---

## Task 8: 헤더에 "가이드 다시 보기" 버튼 추가

**Files:**
- Modify: `frontend/components/layout/Header.tsx`

- [ ] **Step 1: Header.tsx에 useOnboarding import 및 버튼 추가**

```tsx
// 파일 상단 import에 추가
import { useOnboarding } from "@/components/onboarding/OnboardingContext";
```

`Header` 함수 내부에 추가:
```tsx
const { startTour } = useOnboarding();
```

정상 모드 버튼 그룹(`layoutCtx?.isEditing`이 false일 때)에 추가:
```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={startTour}
  title="가이드 다시 보기"
  className="hidden sm:flex text-[#5a5040] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
>
  가이드
</Button>
```

`Logout` 버튼 바로 앞에 삽입한다.

- [ ] **Step 2: 커밋**

```bash
git add frontend/components/layout/Header.tsx
git commit -m "feat(onboarding): 헤더에 가이드 다시 보기 버튼 추가"
```

---

## Task 9: 동작 확인

- [ ] **Step 1: 개발 서버 실행**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: 브라우저에서 확인**

1. `http://localhost:3000/login` 접속
2. 테스트 계정으로 로그인 (또는 Supabase에서 `onboarding_done = false`로 리셋)
3. 대시보드 진입 시 투어가 자동 시작되는지 확인
4. 각 스텝의 스포트라이트 + 툴팁 위치 확인
5. "다음" 버튼으로 8개 스텝 진행
6. 완료 후 채팅창에 인사 메시지 + [CHOICES] 버튼 표시 확인
7. 로그아웃 후 재로그인 → 투어 미표시 확인
8. 헤더 "가이드" 버튼 클릭 → 투어 재시작 확인

- [ ] **Step 3: Supabase에서 onboarding_done 리셋하여 재테스트**

```sql
UPDATE profiles SET onboarding_done = false WHERE id = '<your-test-user-id>';
```

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat(onboarding): 온보딩 투어 구현 완료"
```
