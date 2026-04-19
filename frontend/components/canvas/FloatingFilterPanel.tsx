"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALL_DOMAINS,
  DOMAIN_LABEL,
  useFilter,
  type Domain,
  type TimeRange,
} from "./FilterContext";
import { loadPanelState, savePanelState } from "./floatingPanels";

const PANEL_ID = "filter";
const PANEL_WIDTH = 280;
const PANEL_MARGIN = 16;

const SLIDER_STEPS: TimeRange[] = [null, 7, 6, 5, 4, 3, 2, 1];

const labelForStep = (v: TimeRange) => (v === null ? "전체" : `${v}일`);
const rangeLabel = (v: TimeRange) =>
  v === null ? "최초 ~ 현재" : `${v}일 전 ~ 현재`;

type Position = { x: number; y: number };

// SSR-deterministic placeholder; real position computed in effect after mount.
const SSR_POSITION: Position = { x: 0, y: PANEL_MARGIN };

const topRightPosition = (): Position => ({
  x: window.innerWidth - PANEL_WIDTH - PANEL_MARGIN,
  y: PANEL_MARGIN,
});

const clampToViewport = (
  p: Position,
  panelEl: HTMLDivElement | null,
): Position => {
  if (typeof window === "undefined") return p;
  const w = panelEl?.offsetWidth ?? PANEL_WIDTH;
  const h = panelEl?.offsetHeight ?? 60;
  return {
    x: Math.max(0, Math.min(p.x, window.innerWidth - w)),
    y: Math.max(0, Math.min(p.y, window.innerHeight - h)),
  };
};

export const FloatingFilterPanel = () => {
  const {
    timeRangeDays,
    setTimeRangeDays,
    selectedDomains,
    toggleDomain,
    showArchive,
    setShowArchive,
  } = useFilter();

  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef<Position | null>(null);
  const [position, setPosition] = useState<Position>(SSR_POSITION);
  const [minimized, setMinimized] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = loadPanelState(PANEL_ID);
    if (stored) {
      setPosition(
        clampToViewport({ x: stored.x, y: stored.y }, panelRef.current),
      );
      setMinimized(stored.minimized);
    } else {
      setPosition(clampToViewport(topRightPosition(), panelRef.current));
    }
    setHydrated(true);
  }, []);

  // Persist whenever position/minimized changes (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    savePanelState(PANEL_ID, { x: position.x, y: position.y, minimized });
  }, [position, minimized, hydrated]);

  // Keep panel inside viewport on resize
  useEffect(() => {
    const onResize = () => {
      setPosition((p) => clampToViewport(p, panelRef.current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleDragStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragOffsetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [],
  );

  const handleDragMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const offset = dragOffsetRef.current;
    if (!offset) return;
    setPosition(
      clampToViewport(
        { x: e.clientX - offset.x, y: e.clientY - offset.y },
        panelRef.current,
      ),
    );
  }, []);

  const handleDragEnd = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOffsetRef.current) return;
    dragOffsetRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const stepIndex = SLIDER_STEPS.findIndex((s) => s === timeRangeDays);
  const currentIndex = stepIndex === -1 ? 1 : stepIndex;

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed z-40 select-none rounded-xl border border-[#ddd0b4] bg-[#fffaf2]/95 text-[#2e2719] shadow-xl backdrop-blur",
        "transition-shadow",
      )}
      style={{
        left: position.x,
        top: position.y,
        width: PANEL_WIDTH,
        opacity: hydrated ? 1 : 0,
      }}
      role="region"
      aria-label="캔버스 필터"
    >
      {/* Header (drag handle) */}
      <div
        className="flex cursor-grab items-center justify-between border-b border-[#ddd0b4] bg-[#ebe0ca]/60 px-3 py-2 active:cursor-grabbing"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div className="flex items-center gap-1.5">
          <GripVertical className="h-3.5 w-3.5 text-[#8c7e66]" />
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#8c7e66]" />
          <span className="text-xs font-semibold text-[#2e2719]">필터</span>
        </div>
        <button
          type="button"
          onClick={() => setMinimized((m) => !m)}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded p-1 text-[#8c7e66] transition-colors hover:bg-[#ebe0ca] hover:text-[#2e2719]"
          aria-label={minimized ? "펼치기" : "최소화"}
        >
          {minimized ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Body */}
      {!minimized && (
        <div className="space-y-2.5 px-3 py-2.5">
          {/* Row 1: time slider */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#8c7e66]">
                생성 시간
              </span>
              <span className="text-[11px] tabular-nums text-[#2e2719]">
                {rangeLabel(timeRangeDays)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={SLIDER_STEPS.length - 1}
              step={1}
              value={currentIndex}
              onChange={(e) =>
                setTimeRangeDays(SLIDER_STEPS[Number(e.target.value)])
              }
              className="h-1.5 w-full cursor-pointer accent-[#7f8f54]"
              aria-label="시간 범위 필터"
            />
            <div className="mt-0.5 flex select-none justify-between px-0.5 text-[10px] text-[#8c7e66]">
              {SLIDER_STEPS.map((s, i) => (
                <span
                  key={i}
                  className={cn(
                    "tabular-nums",
                    i === currentIndex && "font-semibold text-[#6a7843]",
                  )}
                >
                  {labelForStep(s)}
                </span>
              ))}
            </div>
          </div>

          {/* Row 2: domain toggles */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#8c7e66]">
                도메인
              </span>
              <span className="text-[11px] text-[#8c7e66]">
                {selectedDomains.size}/{ALL_DOMAINS.length} 선택
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {ALL_DOMAINS.map((d: Domain) => {
                const active = selectedDomains.has(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDomain(d)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-md border px-1.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-[#7f8f54]/50 bg-[#7f8f54]/15 text-[#6a7843]"
                        : "border-[#ddd0b4] bg-[#ebe0ca] text-[#8c7e66] hover:border-[#bfae8a] hover:text-[#2e2719]",
                    )}
                  >
                    {DOMAIN_LABEL[d]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: archive toggle */}
          <button
            type="button"
            onClick={() => setShowArchive(!showArchive)}
            aria-pressed={showArchive}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
              showArchive
                ? "border-[#8e5572]/50 bg-[#8e5572]/15 text-[#764463]"
                : "border-[#ddd0b4] bg-[#ebe0ca] text-[#8c7e66] hover:border-[#bfae8a] hover:text-[#2e2719]",
            )}
          >
            <span>📦</span>
            <span>아카이브 {showArchive ? "숨기기" : "보기"}</span>
          </button>
        </div>
      )}
    </div>
  );
};
