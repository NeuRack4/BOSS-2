"use client";

import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOMAIN_META, type ScheduleItem } from "./types";

const dayDiff = (iso: string): number => {
  const t = new Date(iso + "T00:00:00").getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((t - now.getTime()) / (1000 * 60 * 60 * 24));
};

const formatRelative = (iso: string): string => {
  const d = dayDiff(iso);
  if (d === 0) return "오늘";
  if (d === 1) return "내일";
  if (d < 0) return `${-d}일 지남`;
  return `D-${d}`;
};

const urgencyClass = (iso: string): string => {
  const d = dayDiff(iso);
  if (d <= 1) return "bg-[#f39f7e]/30 text-[#030303]";
  if (d <= 3) return "bg-[#f39f7e]/15 text-[#030303]";
  return "bg-[#476f65]/12 text-[#476f65]";
};

type Props = {
  items: ScheduleItem[];
};

export const ScheduleCard = ({ items }: Props) => {
  const shown = items.slice(0, 5);

  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("boss:open-schedule-modal"))
      }
      className="group flex h-full w-full flex-col overflow-hidden rounded-[5px] bg-[#d8dfe0] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-[#030303]">
          Upcoming Schedule
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-[#030303]/40">
          예정된 일정이 없어요
        </div>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto">
          {shown.map((it) => {
            const dot = it.domain ? DOMAIN_META[it.domain].accent : "#476f65";
            return (
              <li
                key={it.id}
                className="group flex items-center gap-2.5 rounded-lg bg-[#f39f7e]/10 px-3 py-2 transition-colors hover:bg-[#f39f7e]/20"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: dot }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-[#030303]">
                    {it.title}
                  </div>
                  <div className="text-[10px] text-[#030303]/50">
                    {it.label}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                    urgencyClass(it.date),
                  )}
                >
                  {formatRelative(it.date)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </button>
  );
};
