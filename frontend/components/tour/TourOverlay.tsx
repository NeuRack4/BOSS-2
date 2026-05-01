"use client";

import {
  useCallback,
  useEffect,
  useId,
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
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  const rafRef = useRef<number | null>(null);
  const maskId = useId();

  // Track window width for panel positioning
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Pure rect updater — no side effects, only updates targetRect
  const updateRect = useCallback(() => {
    const step = TOUR_STEPS[currentStep];
    if (!step) return;
    const el = document.querySelector(`[data-tour-id="${step.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTargetRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [currentStep]);

  // Scroll target into view on step change; skip step if element not found
  useEffect(() => {
    if (!isOpen) return;
    setTargetRect(null);
    const step = TOUR_STEPS[currentStep];
    if (!step) return;
    // Short delay to let React finish rendering the target element
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-tour-id="${step.id}"]`);
      if (!el) {
        next();
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(updateRect, 350);
    }, 50);
    return () => clearTimeout(t);
  }, [isOpen, currentStep, updateRect, next]);

  // Track rect on scroll + resize using RAF debounce
  useEffect(() => {
    if (!isOpen) return;
    const scheduleUpdate = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateRect);
    };
    const ro = new ResizeObserver(scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    const step = TOUR_STEPS[currentStep];
    const el = step
      ? document.querySelector(`[data-tour-id="${step.id}"]`)
      : null;
    if (el) ro.observe(el);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate, true);
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isOpen, currentStep, updateRect]);

  if (!isOpen || !targetRect) return null;

  const step = TOUR_STEPS[currentStep];
  const Icon = ICON_MAP[step.iconName] ?? MessageSquare;

  const mx = targetRect.x + targetRect.width / 2;
  const panelOnLeft = mx > windowWidth / 2;
  const isMobile = windowWidth < 768;

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
          <mask id={maskId}>
            <rect width="100%" height="100%" fill="white" />
            <rect x={maskX} y={maskY} width={maskW} height={maskH} rx={8} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask={`url(#${maskId})`} />
      </svg>

      {/* Side panel */}
      <div
        style={{
          position: "fixed",
          zIndex: 51,
          width: 280,
          maxWidth: "calc(100vw - 48px)",
          ...(isMobile
            ? { bottom: 24, left: "50%", transform: "translateX(-50%)" }
            : panelOnLeft
            ? { left: 24, top: "50%", transform: "translateY(-50%)" }
            : { right: 24, top: "50%", transform: "translateY(-50%)" }),
        }}
        className="rounded-[8px] border border-[#ddd0b4] bg-[#faf8f4] p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-[#4a7c59]" />
          <span className="text-[15px] font-semibold text-[#2e2719]">{step.title}</span>
        </div>

        <hr className="mb-3 border-[#ddd0b4]" />

        <p className="text-[13px] leading-relaxed text-[#5a5040]">{step.description}</p>

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
