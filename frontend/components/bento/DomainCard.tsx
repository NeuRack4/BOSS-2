"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DOMAIN_META, type DomainKey, type DomainStats } from "./types";

type Props = {
  domain: DomainKey;
  stats: DomainStats;
};

export const DomainCard = ({ domain, stats }: Props) => {
  const meta = DOMAIN_META[domain];

  const textClass = meta.isDark ? "text-white" : "text-[#030303]";
  const glowBg = meta.isDark ? "bg-white/10" : "bg-black/10";

  return (
    <Link
      href={`/${domain}`}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-[5px] p-5 shadow-lg transition-all",
        "hover:scale-[1.015] hover:shadow-xl",
        meta.bg,
        textClass,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-2xl transition-opacity group-hover:opacity-70",
          glowBg,
        )}
        aria-hidden
      />
      <div className="relative mb-2.5 flex items-start justify-between">
        <span className="text-base font-semibold tracking-tight">
          {meta.label}
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>

      <div
        className={cn(
          "relative grid grid-cols-3 overflow-hidden rounded-[5px]",
          meta.isDark ? "bg-white/10" : "bg-black/[0.06]",
        )}
      >
        <Stat
          value={stats.active_count}
          label="Active"
          divider={meta.isDark ? "border-white/15" : "border-black/10"}
        />
        <Stat
          value={stats.upcoming_count}
          label="Due"
          divider={meta.isDark ? "border-white/15" : "border-black/10"}
          border
        />
        <Stat
          value={stats.recent_count}
          label="Recent"
          divider={meta.isDark ? "border-white/15" : "border-black/10"}
          border
        />
      </div>

      <ul
        className={cn(
          "relative mt-2.5 flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-hidden text-[12.5px] leading-snug",
        )}
      >
        {stats.recent_titles.length === 0 ? (
          <li
            className={cn(
              "truncate rounded-[5px] px-2.5 py-1.5 italic opacity-60",
              meta.isDark ? "bg-white/10" : "bg-black/[0.06]",
            )}
          >
            Nothing here yet
          </li>
        ) : (
          stats.recent_titles.slice(0, 4).map((t) => (
            <li
              key={t.id}
              className={cn(
                "truncate rounded-[5px] px-2.5 py-1.5",
                meta.isDark ? "bg-white/10" : "bg-black/[0.06]",
              )}
            >
              {t.title}
            </li>
          ))
        )}
      </ul>
    </Link>
  );
};

const Stat = ({
  value,
  label,
  divider,
  border = false,
}: {
  value: number;
  label: string;
  divider: string;
  border?: boolean;
}) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center px-1 py-1.5",
      border && `border-l ${divider}`,
    )}
  >
    <div className="text-lg font-bold leading-none tabular-nums">{value}</div>
    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider opacity-60">
      {label}
    </div>
  </div>
);
