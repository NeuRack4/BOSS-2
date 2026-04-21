"use client";

import { ArrowUpRight } from "lucide-react";
import { DOMAIN_META, type ActivityItem, type DomainKey } from "./types";

const formatRelative = (iso: string): string => {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
};

const TYPE_LABEL: Record<string, string> = {
  artifact_created: "생성",
  agent_run: "실행",
  schedule_run: "스케줄 실행",
  schedule_notify: "알림",
};

type Props = {
  items: ActivityItem[];
};

export const ActivityCard = ({ items }: Props) => {
  const shown = items.slice(0, 6);

  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("boss:open-activity-modal"))
      }
      className="group flex h-full w-full flex-col overflow-hidden rounded-[5px] bg-[#cdd5d7] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-[#030303]">
          Recent Activity
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-[#030303]/40">
          아직 활동이 없어요
        </div>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto">
          {shown.map((it, i) => {
            const domain = it.domain as DomainKey | null | undefined;
            const dot = domain ? DOMAIN_META[domain].accent : "#030303";
            const label = TYPE_LABEL[it.type] ?? it.type;
            return (
              <li
                key={i}
                className="flex items-center gap-2.5 rounded-lg bg-[#fcfcfc]/50 px-3 py-2"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: dot }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-[#030303]/80">
                    <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#030303]/50">
                      {label}
                    </span>
                    {it.title || it.description || "(내용 없음)"}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#030303]/40">
                  {formatRelative(it.created_at)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </button>
  );
};
