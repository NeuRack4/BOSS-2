"use client";

import { useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
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
  accent: string;
  handle: string;
};

const DOMAIN: Record<Domain, DomainStyle> = {
  recruitment: {
    label: "Recruitment",
    subtitle: "Recruitment",
    icon: Briefcase,
    accent: "border-blue-400/40 bg-blue-400/10 text-blue-500",
    handle: "!bg-blue-400",
  },
  marketing: {
    label: "Marketing",
    subtitle: "Marketing",
    icon: Megaphone,
    accent: "border-purple-400/40 bg-purple-400/10 text-purple-500",
    handle: "!bg-purple-400",
  },
  sales: {
    label: "Sales",
    subtitle: "Sales",
    icon: TrendingUp,
    accent: "border-emerald-400/40 bg-emerald-400/10 text-emerald-500",
    handle: "!bg-emerald-400",
  },
  documents: {
    label: "Documents",
    subtitle: "Documents",
    icon: FolderOpen,
    accent: "border-amber-400/40 bg-amber-400/10 text-amber-500",
    handle: "!bg-amber-400",
  },
};

type Latest = {
  id: string;
  title: string;
  type: string;
  status: Status;
};

const STATUS_DOT: Record<Status, string> = {
  active: "bg-emerald-500",
  draft: "bg-zinc-400",
  paused: "bg-amber-500",
};

export const DomainNode = ({ data, selected }: NodeProps) => {
  const [expanded, setExpanded] = useState(false);
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
        "group/node relative w-[220px] overflow-hidden rounded-xl border bg-zinc-900/90 backdrop-blur transition-all hover:shadow-lg",
        style.accent,
        selected && "ring-2 ring-primary/40",
      )}
      role="article"
      aria-label={`${style.subtitle} domain`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2.5 p-3 text-left transition-colors hover:bg-zinc-800/40"
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-zinc-950",
            style.accent,
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold tracking-tight text-zinc-100">
            {displayTitle}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-zinc-500">
          {count > 0 && (
            <span className="font-mono text-[10px] tabular-nums">
              {count.toString().padStart(2, "0")}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-300",
              expanded && "rotate-180",
            )}
          />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/60">
          {!latest ? (
            <div className="flex flex-col items-center gap-1 px-3 py-4">
              <Circle className="h-3 w-3 text-zinc-600" />
              <p className="font-mono text-[11px] text-zinc-500">
                No artifacts yet
              </p>
            </div>
          ) : (
            <div className="px-2 py-1.5">
              <p className="px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">
                Latest
              </p>
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-800/50">
                <div
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    STATUS_DOT[latest.status],
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium leading-tight text-zinc-100">
                    {latest.title}
                  </p>
                  <p className="mt-px font-mono text-[9px] uppercase leading-tight tracking-wider text-zinc-500">
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
        className={cn("!h-2 !w-2 !border-2 !border-zinc-950", style.handle)}
      />
      <Handle
        id="l-s"
        type="source"
        position={Position.Left}
        className={cn("!h-2 !w-2 !border-2 !border-zinc-950", style.handle)}
      />
      <Handle
        id="r-t"
        type="target"
        position={Position.Right}
        className={cn("!h-2 !w-2 !border-2 !border-zinc-950", style.handle)}
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className={cn("!h-2 !w-2 !border-2 !border-zinc-950", style.handle)}
      />
    </div>
  );
};
