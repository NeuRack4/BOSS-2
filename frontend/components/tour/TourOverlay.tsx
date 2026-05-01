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
