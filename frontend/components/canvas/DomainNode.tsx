"use client";

import { useState } from "react";
import { Handle, Position, NodeProps, useStoreApi } from "@xyflow/react";
import {
  ChevronDown,
  Briefcase,
  Megaphone,
  TrendingUp,
  FolderOpen,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Domain = "recruitment" | "marketing" | "sales" | "documents";
type Status = "active" | "draft" | "paused";

type DomainStyle = {
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string; // border + text only (no bg — bg is set via inline style)
  tintRgba: string; // rgba for layered tint over solid base
  handle: string;
};

const DOMAIN: Record<Domain, DomainStyle> = {
  recruitment: {
    label: "Recruitment",
    subtitle: "Recruitment",
    icon: Briefcase,
    accent: "border-[#c47865] text-[#a35c4a]",
    tintRgba: "rgba(196,120,101,0.22)",
    handle: "!bg-[#c47865]",
  },
  marketing: {
    label: "Marketing",
    subtitle: "Marketing",
    icon: Megaphone,
    accent: "border-[#d89a2b] text-[#a87620]",
    tintRgba: "rgba(216,154,43,0.22)",
    handle: "!bg-[#d89a2b]",
  },
  sales: {
    label: "Sales",
    subtitle: "Sales",
    icon: TrendingUp,
    accent: "border-[#7f8f54] text-[#6a7843]",
    tintRgba: "rgba(127,143,84,0.22)",
    handle: "!bg-[#7f8f54]",
  },
  documents: {
    label: "Documents",
    subtitle: "Documents",
    icon: FolderOpen,
    accent: "border-[#8e5572] text-[#764463]",
    tintRgba: "rgba(142,85,114,0.22)",
    handle: "!bg-[#8e5572]",
  },
};

type Latest = {
  id: string;
  title: string;
  type: string;
  status: Status;
};

const STATUS_DOT: Record<Status, string> = {
  active: "bg-[#7f8f54]",
  draft: "bg-[#bfae8a]",
  paused: "bg-[#bfae8a]",
};

const ZOOM_FOCUS_THRESHOLD = 0.7;

export const DomainNode = ({ data, selected }: NodeProps) => {
  const store = useStoreApi();
  const [expanded, setExpanded] = useState(false);
  const toggleExpand = () => {
    const zoom = store.getState().transform[2];
    if (zoom < ZOOM_FOCUS_THRESHOLD) return;
    setExpanded((v) => !v);
  };
  const domains = (data?.domains as Domain[] | null) ?? null;
  const domain = domains?.[0] ?? "recruitment";
  const count = (data?.count as number) ?? 0;
  const latest = (data?.latest as Latest | null) ?? null;
  const style = DOMAIN[domain];
  const Icon = style.icon;
  const isCategory = (data?.type as string | undefined) === "category";
  const rawTitle = (data?.title as string | undefined) ?? "";
  const displayTitle = isCategory
    ? rawTitle.replace(/^\[MOCK\]\s*/, "").trim() || style.label
    : style.label;

  return (
    <div
      className={cn(
        "group/node relative w-[310px] overflow-hidden rounded-xl border-2 backdrop-blur transition-all shadow-md hover:shadow-lg",
        style.accent,
        selected && "ring-2 ring-primary/40",
      )}
      style={{
        background: `linear-gradient(0deg, ${style.tintRgba}, ${style.tintRgba}), #fffaf2`,
      }}
      role="article"
      aria-label={`${style.subtitle} domain`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={toggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpand();
          }
        }}
        className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-4 text-left transition-colors hover:bg-[#ebe0ca]/60"
      >
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-[#f2e9d5]",
            style.accent,
          )}
          aria-hidden="true"
        >
          <Icon className="h-[22px] w-[22px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[22px] font-semibold tracking-tight text-[#2e2719]">
            {displayTitle}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[#8c7e66]">
          {count > 0 && (
            <span className="font-mono text-[15px] tabular-nums">
              {count.toString().padStart(2, "0")}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-[20px] w-[20px] transition-transform duration-300",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#ddd0b4] bg-[#f2e9d5]/60">
          {!latest ? (
            <div className="flex flex-col items-center gap-1 px-3 py-4">
              <Circle className="h-[13px] w-[13px] text-[#bfae8a]" />
              <p className="font-mono text-[14px] text-[#8c7e66]">
                No artifacts yet
              </p>
            </div>
          ) : (
            <div className="px-2 py-1.5">
              <p className="px-2 pb-1 font-mono text-[12px] uppercase tracking-[0.18em] text-[#8c7e66]">
                Latest
              </p>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[#ebe0ca]/70">
                <div
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    STATUS_DOT[latest.status],
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium leading-tight text-[#2e2719]">
                    {latest.title}
                  </p>
                  <p className="mt-px font-mono text-[12px] uppercase leading-tight tracking-wider text-[#8c7e66]">
                    {latest.type}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Handle
        id="l"
        type="target"
        position={Position.Left}
        className={cn("!h-2 !w-2 !border-2 !border-[#f2e9d5]", style.handle)}
      />
      <Handle
        id="l-s"
        type="source"
        position={Position.Left}
        className={cn("!h-2 !w-2 !border-2 !border-[#f2e9d5]", style.handle)}
      />
      <Handle
        id="r-t"
        type="target"
        position={Position.Right}
        className={cn("!h-2 !w-2 !border-2 !border-[#f2e9d5]", style.handle)}
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className={cn("!h-2 !w-2 !border-2 !border-[#f2e9d5]", style.handle)}
      />
    </div>
  );
};
