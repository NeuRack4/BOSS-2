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
  if (d < 0) return "text-white/30";
  if (d <= 1) return "text-[#ff8577]";
  if (d <= 3) return "text-[#ffc86b]";
  return "text-white/55";
};

const formatShortDate = (iso: string): string => {
  const dt = new Date(iso);
  return dt.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
};

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-400",
  paused: "bg-amber-400",
  running: "bg-sky-400",
  archived: "bg-white/20",
};

type Props = {
  card: KanbanCardData;
  domain: DomainKey;
  dragging?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
};

export const KanbanCard = forwardRef<HTMLDivElement, Props>(
  ({ card, domain, dragging, onDragStart, onDragEnd }, ref) => {
    const meta = DOMAIN_META[domain];
    const Icon = (card.type && TYPE_ICON[card.type]) || FileText;
    const md = card.metadata || {};
    const due = (md.due_date ?? md.end_date) as string | undefined;
    const statusDot = STATUS_TONE[card.status] ?? "bg-white/20";

    return (
      <div
        ref={ref}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={cn(
          "group relative cursor-grab overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 transition-all active:cursor-grabbing",
          "hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/[0.06]",
          dragging && "opacity-40",
        )}
      >
        <div
          className="absolute left-0 top-0 h-full w-[2px] opacity-40 transition-opacity group-hover:opacity-90"
          style={{ backgroundColor: meta.accent }}
          aria-hidden
        />

        <div className="flex items-start gap-2.5">
          <div
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/[0.04] text-white/70"
            aria-hidden
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[13px] font-medium leading-snug text-white/95">
              {card.title}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-white/40">
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
