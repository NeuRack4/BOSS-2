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

const TOOLTIP_GAP = 12;
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
        top: rect.top - TOOLTIP_GAP - 140,
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
