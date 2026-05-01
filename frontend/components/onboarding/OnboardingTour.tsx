"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnboarding } from "./OnboardingContext";
import { OnboardingTooltip } from "./OnboardingTooltip";
import { ONBOARDING_STEPS, ONBOARDING_COMPLETION_MESSAGE } from "./steps";
import { useChat } from "@/components/chat/ChatContext";

const PADDING = 8;

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
