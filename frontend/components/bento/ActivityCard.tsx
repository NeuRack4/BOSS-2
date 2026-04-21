"use client";

import type { KeyboardEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { DOMAIN_META, type ActivityItem, type DomainKey } from "./types";

const formatRelative = (iso: string): string => {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

const TYPE_LABEL: Record<string, string> = {
  artifact_created: "Created",
  agent_run: "Run",
  schedule_run: "Scheduled",
  schedule_notify: "Notify",
};

type Props = {
  items: ActivityItem[];
};

export const ActivityCard = ({ items }: Props) => {
  const shown = items.slice(0, 6);
  const openModal = () =>
    window.dispatchEvent(new CustomEvent("boss:open-activity-modal"));
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
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] bg-[#e3e9dd] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-base font-semibold tracking-tight text-[#030303]">
          Recent Activity
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/40">
          Nothing here yet
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {shown.map((it, i) => {
            const domain = it.domain as DomainKey | null | undefined;
            const dot = domain ? DOMAIN_META[domain].accent : "#030303";
            const label = TYPE_LABEL[it.type] ?? it.type;
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openModal();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[5px] bg-[#fcfcfc]/50 px-3 py-2 text-left transition-colors hover:bg-[#fcfcfc]/75"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: dot }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-[#030303]/80">
                      <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#030303]/55">
                        {label}
                      </span>
                      {it.title || it.description || "(no content)"}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#030303]/50">
                    {formatRelative(it.created_at)}
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
