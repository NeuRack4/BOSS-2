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
        "group relative flex h-full flex-col justify-between overflow-hidden rounded-[5px] p-5 shadow-lg transition-all",
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
      <div className="relative flex items-start justify-between">
        <span className="text-[15px] font-semibold tracking-tight">
          {meta.label}
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>

      <div className="relative space-y-2">
        <div className="flex items-baseline gap-3 text-[11px] font-medium tracking-wide">
          <span className="flex items-center gap-1">
            <span className="opacity-70">활성</span>
            <b className="text-sm font-bold">{stats.active_count}</b>
          </span>
          <span className="flex items-center gap-1">
            <span className="opacity-70">임박</span>
            <b className="text-sm font-bold">{stats.upcoming_count}</b>
          </span>
          <span className="flex items-center gap-1">
            <span className="opacity-70">최근</span>
            <b className="text-sm font-bold">{stats.recent_count}</b>
          </span>
        </div>
        <ul className="space-y-1 text-[11px] leading-snug opacity-90">
          {stats.recent_titles.slice(0, 2).map((t) => (
            <li key={t.id} className="truncate">
              · {t.title}
            </li>
          ))}
          {stats.recent_titles.length === 0 && (
            <li className="italic opacity-60">최근 항목 없음</li>
          )}
        </ul>
      </div>
    </Link>
  );
};
