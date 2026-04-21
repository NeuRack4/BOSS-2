"use client";

import { useEffect, useState } from "react";
import { DomainCard } from "./DomainCard";
import { ChatCenterCard } from "./ChatCenterCard";
import { ScheduleCard } from "./ScheduleCard";
import { ActivityCard } from "./ActivityCard";
import { PreviousChatCard } from "./PreviousChatCard";
import { AdBanner } from "./AdBanner";
import type { DashboardSummary, DomainStats, DomainKey } from "./types";

const EMPTY_STATS: DomainStats = {
  active_count: 0,
  upcoming_count: 0,
  recent_count: 0,
  total_count: 0,
  recent_titles: [],
};

type Props = {
  accountId: string;
};

export const BentoGrid = ({ accountId }: Props) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/dashboard/summary?account_id=${accountId}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (!cancel) setSummary(json?.data ?? null);
      } catch {
        if (!cancel) setSummary(null);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    const onChange = () => load();
    window.addEventListener("boss:artifacts-changed", onChange);
    return () => {
      cancel = true;
      window.removeEventListener("boss:artifacts-changed", onChange);
    };
  }, [apiBase, accountId]);

  const stats = (d: DomainKey) => summary?.domains?.[d] ?? EMPTY_STATS;

  return (
    <div className="flex w-full justify-center gap-4 p-4 md:p-6">
      <AdBanner side="left" />
      <div className="w-full max-w-[1400px]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:auto-rows-[140px] md:gap-4">
          {/* Top-left: Chat (half width, 4 rows tall) */}
          <div className="order-1 md:col-span-6 md:row-span-4 md:col-start-1 md:row-start-1 h-[420px] md:h-auto">
            <ChatCenterCard />
          </div>

          {/* Top-right: 채용/매출 column — 4:6 height split */}
          <div className="order-2 md:col-span-3 md:row-span-4 md:col-start-7 md:row-start-1 flex flex-col gap-3 md:gap-4">
            <div className="h-[160px] md:h-auto md:flex-[4]">
              <DomainCard domain="recruitment" stats={stats("recruitment")} />
            </div>
            <div className="h-[160px] md:h-auto md:flex-[6]">
              <DomainCard domain="sales" stats={stats("sales")} />
            </div>
          </div>

          {/* Top-right: 마케팅/서류 column — 6:4 height split */}
          <div className="order-3 md:col-span-3 md:row-span-4 md:col-start-10 md:row-start-1 flex flex-col gap-3 md:gap-4">
            <div className="h-[160px] md:h-auto md:flex-[6]">
              <DomainCard domain="marketing" stats={stats("marketing")} />
            </div>
            <div className="h-[160px] md:h-auto md:flex-[4]">
              <DomainCard domain="documents" stats={stats("documents")} />
            </div>
          </div>

          {/* Bottom row — 2.5 : 2.5 : 5 width ratio (3 : 3 : 6 in 12-col grid) */}
          <div className="order-6 md:col-span-3 md:row-span-2 md:col-start-1 md:row-start-5 h-[220px] md:h-auto">
            <PreviousChatCard />
          </div>

          <div className="order-7 md:col-span-3 md:row-span-2 md:col-start-4 md:row-start-5 h-[220px] md:h-auto">
            <ScheduleCard items={summary?.upcoming ?? []} />
          </div>

          <div className="order-8 md:col-span-6 md:row-span-2 md:col-start-7 md:row-start-5 h-[220px] md:h-auto">
            <ActivityCard items={summary?.recent_activity ?? []} />
          </div>
          {/* end bottom row */}
        </div>
      </div>
      {loading && !summary && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <div className="rounded-full bg-[#fcfcfc] px-4 py-1.5 text-xs text-[#030303] shadow-lg">
            불러오는 중...
          </div>
        </div>
      )}
    </div>
  );
};
