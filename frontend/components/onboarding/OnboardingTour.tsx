"use client";

import { useCallback, useEffect, useState } from "react";
import { useOnboarding } from "./OnboardingContext";
import { OnboardingTooltip } from "./OnboardingTooltip";
import { ONBOARDING_STEPS, ONBOARDING_COMPLETION_MESSAGE } from "./steps";
import { useChat } from "@/components/chat/ChatContext";
import { useNodeDetail } from "@/components/detail/NodeDetailContext";
import { createClient } from "@/lib/supabase/client";

const PADDING = 8;

export const OnboardingTour = () => {
  const { isActive, currentStep, totalSteps, next, skip } = useOnboarding();
  const { openChatWithBriefing, userId } = useChat();
  const { openDetail, closeDetail } = useNodeDetail();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = ONBOARDING_STEPS[currentStep];
  const isModalStep = step?.action === "open-node-detail-sample";

  // 완료 이벤트 수신 → 인사 메시지 주입
  // Listener is registered unconditionally: the event fires from finish() in Context
  // after isActive is already set to false, so gating on isActive would miss it.
  useEffect(() => {
    const handler = () => {
      openChatWithBriefing(ONBOARDING_COMPLETION_MESSAGE);
    };
    window.addEventListener("boss:onboarding-complete", handler);
    return () => window.removeEventListener("boss:onboarding-complete", handler);
  }, [openChatWithBriefing]);

  // open-node-detail-sample: 최신 아티팩트 조회 후 모달 오픈
  useEffect(() => {
    if (!isActive || !isModalStep || !userId) return;
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("artifacts")
      .select("id")
      .eq("account_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) openDetail((data as { id: string }).id);
      });
    return () => { cancelled = true; };
    // openDetail은 useCallback([]) — 안정적 참조이므로 deps 생략
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, isModalStep, userId]);

  // 모달 스텝에서 벗어날 때만 closeDetail
  useEffect(() => {
    if (isModalStep || !isActive) return;
    closeDetail();
    // closeDetail은 useCallback([]) — 안정적 참조이므로 deps 생략
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalStep, isActive]);

  // 타겟 요소 좌표 계산
  const recalculate = useCallback(() => {
    if (!step || isModalStep) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [step, isModalStep]);

  // 스텝 변경 시 타겟 요소가 뷰포트에 보이도록 스크롤
  useEffect(() => {
    if (!isActive || !step || isModalStep) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // 스크롤 완료 후 좌표 재계산
      setTimeout(recalculate, 400);
    }
  }, [isActive, currentStep, step, isModalStep, recalculate]);

  useEffect(() => {
    if (!isActive || isModalStep) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recalculate();
    window.addEventListener("resize", recalculate);
    window.addEventListener("scroll", recalculate, true);
    return () => {
      window.removeEventListener("resize", recalculate);
      window.removeEventListener("scroll", recalculate, true);
    };
  }, [isActive, isModalStep, recalculate]);

  if (!isActive || !step) return null;

  // 모달 스텝: 오버레이/스포트라이트 없이 우하단 고정 툴팁만 표시
  if (isModalStep) {
    return (
      <div
        style={{
          position: "fixed",
          bottom: 32,
          right: 32,
          zIndex: 99999,
          width: 260,
          background: "#fff",
          borderRadius: 14,
          padding: "16px 18px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
          border: "2px solid rgba(201,169,110,0.5)",
        }}
      >
        <p style={{ fontWeight: 700, fontSize: 13, color: "#3a2e1e", marginBottom: 6 }}>
          {step.title}
        </p>
        <p style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 12 }}>
          {step.description}
        </p>
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
            onClick={skip}
            style={{ fontSize: 11, color: "#aaa", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
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
    );
  }

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
