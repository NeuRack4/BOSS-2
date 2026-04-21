"use client";

import type { KeyboardEvent } from "react";
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
  const openModal = () =>
    window.dispatchEvent(new CustomEvent("boss:open-schedule-modal"));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModal();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openModal}
      onKeyDown={onKey}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] bg-[#cae0e4] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-base font-semibold tracking-tight text-[#030303]">
          Upcoming Schedule
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/40">
          Nothing here yet
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {shown.map((it) => {
            const dot = it.domain ? DOMAIN_META[it.domain].accent : "#476f65";
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openModal();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[5px] bg-[#f39f7e]/10 px-3 py-2 text-left transition-colors hover:bg-[#f39f7e]/25"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dot }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[#030303]">
                      {it.title}
                    </div>
                    <div className="text-[11px] text-[#030303]/55">
                      {it.label}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-[5px] px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums",
                      urgencyClass(it.date),
                    )}
                  >
                    {formatRelative(it.date)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
