"use client";

import { forwardRef } from "react";
import {
  Calendar,
  FileCheck,
  FileText,
  Megaphone,
  Receipt,
  ScrollText,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DomainKey } from "./types";
import { DOMAIN_META } from "./types";

export type KanbanCardData = {
  id: string;
  kind: string;
  type: string | null;
  title: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const TYPE_ICON: Record<string, LucideIcon> = {
  contract: ScrollText,
  estimate: Receipt,
  proposal: FileText,
  notice: FileText,
  checklist: FileCheck,
  guide: FileText,
  legal_advice: ScrollText,
  uploaded_doc: FileText,
  analysis: FileCheck,
  job_posting: Users,
  job_posting_set: Users,
  job_posting_poster: Users,
  interview_questions: Users,
  social_post: Megaphone,
  instagram_post: Megaphone,
  campaign: Megaphone,
  review_reply: Megaphone,
  sales_entry: TrendingUp,
  revenue_report: TrendingUp,
  revenue_entry: TrendingUp,
  cost_report: Wallet,
};

const dayDiff = (iso: string): number => {
  const t = new Date(iso + "T00:00:00").getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((t - now.getTime()) / (1000 * 60 * 60 * 24));
};

const formatDDay = (iso: string): string => {
  const d = dayDiff(iso);
  if (d === 0) return "D-0";
  if (d > 0) return `D-${d}`;
  return `D+${-d}`;
};

const dDayTone = (iso: string): string => {
  const d = dayDiff(iso);
  if (d < 0) return "text-[color:var(--kb-fg-faint)]";
  if (d <= 1) return "text-[color:var(--kb-dday-urgent)]";
  if (d <= 3) return "text-[color:var(--kb-dday-soon)]";
  return "text-[color:var(--kb-fg-muted)]";
};

const formatShortDate = (iso: string): string => {
  const dt = new Date(iso);
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  running: "bg-sky-500",
  archived: "bg-[color:var(--kb-status-archived)]",
};

type Props = {
  card: KanbanCardData;
  domain: DomainKey;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick?: () => void;
};

export const KanbanCard = forwardRef<HTMLDivElement, Props>(
  ({ card, domain, dragging, onDragStart, onDragEnd, onClick }, ref) => {
    const meta = DOMAIN_META[domain];
    const Icon = (card.type && TYPE_ICON[card.type]) || FileText;
    const md = card.metadata || {};
    const due = (md.due_date ?? md.end_date) as string | undefined;
    const statusDot =
      STATUS_TONE[card.status] ?? "bg-[color:var(--kb-status-archived)]";

    return (
      <div
        ref={ref}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onClick}
        className={cn(
          "group relative overflow-hidden rounded-[5px] border p-3 transition-all",
          "border-[color:var(--kb-border)] bg-[color:var(--kb-card)]",
          "hover:-translate-y-0.5 hover:border-[color:var(--kb-border-strong)] hover:bg-[color:var(--kb-card-hover)]",
          onClick ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
          dragging && "opacity-40",
        )}
      >
        <div
          className="absolute left-0 top-0 h-full w-[2px] opacity-60 transition-opacity group-hover:opacity-100"
          style={{ backgroundColor: meta.accent }}
          aria-hidden
        />

        <div className="flex items-start gap-2.5">
          <div
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-icon-bg)] text-[color:var(--kb-fg-muted)]"
            aria-hidden
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[13px] font-medium leading-snug text-[color:var(--kb-fg)]">
              {card.title}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-[color:var(--kb-fg-subtle)]">
              <span
                className={cn("h-1.5 w-1.5 rounded-full", statusDot)}
                aria-hidden
              />
              {card.type && (
                <span className="truncate font-mono uppercase tracking-wider">
                  {card.type}
                </span>
              )}
              <span className="ml-auto shrink-0 font-mono tabular-nums">
                {due ? (
                  <span className={dDayTone(due)}>{formatDDay(due)}</span>
                ) : (
                  <span>{formatShortDate(card.created_at)}</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

KanbanCard.displayName = "KanbanCard";
