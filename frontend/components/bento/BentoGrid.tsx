"use client";

import { useEffect, useState } from "react";
import { ProfileMemorySidebar } from "./ProfileMemorySidebar";
import { ChatCenterCard } from "./ChatCenterCard";
import { useLayout } from "./LayoutContext";
import { WidgetSlot } from "./WidgetSlot";
import type { DashboardSummary } from "./types";
import type { WidgetRenderProps } from "./widgetRegistry";

type Props = {
  accountId: string;
};

export const BentoGrid = ({ accountId }: Props) => {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  const ctx = useLayout();

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(
          `${apiBase}/api/dashboard/summary?account_id=${accountId}`,
          { cache: "no-store", signal: controller.signal },
        );
        const json = await res.json();
        if (!cancel) setSummary(json?.data ?? null);
      } catch {
        if (!cancel) setSummary(null);
      } finally {
        clearTimeout(timeoutId);
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

  const rp: WidgetRenderProps = { accountId, summary };

  return (
    <div className="flex w-full justify-center gap-4 p-4 md:p-6">
      <ProfileMemorySidebar renderProps={rp} />
      <div className="w-full max-w-[1400px]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:auto-rows-[140px] md:gap-4">
          {/* Chat — not customizable */}
          <div data-tour-id="chat" className="order-1 md:col-span-6 md:row-span-5 md:col-start-1 md:row-start-1 h-[560px] md:h-auto">
            <ChatCenterCard />
          </div>

          {/* Col 7-9: two stacked slots */}
          <div className="order-2 md:col-span-3 md:row-span-4 md:col-start-7 md:row-start-1 flex flex-col gap-3 md:gap-4">
            <div data-tour-id="recruitment" className="h-[160px] md:h-auto md:flex-[4]">
              <WidgetSlot slotId="main-col7-top" renderProps={rp} />
            </div>
            <div data-tour-id="sales" className="h-[160px] md:h-auto md:flex-[6]">
              <WidgetSlot slotId="main-col7-bottom" renderProps={rp} />
            </div>
          </div>

          {/* Col 10-12: two stacked slots */}
          <div className="order-3 md:col-span-3 md:row-span-4 md:col-start-10 md:row-start-1 flex flex-col gap-3 md:gap-4">
            <div data-tour-id="marketing" className="h-[160px] md:h-auto md:flex-[6]">
              <WidgetSlot slotId="main-col10-top" renderProps={rp} />
            </div>
            <div data-tour-id="documents" className="h-[160px] md:h-auto md:flex-[4]">
              <WidgetSlot slotId="main-col10-bottom" renderProps={rp} />
            </div>
          </div>

          {/* Previous Chat */}
          <div data-tour-id="chat-history" className="order-6 md:col-span-3 md:row-span-3 md:col-start-1 md:row-start-6 h-[420px] md:h-auto">
            <WidgetSlot slotId="main-prev-chat" renderProps={rp} />
          </div>

          {/* Schedule */}
          <div data-tour-id="upcoming-schedule" className="order-7 md:col-span-3 md:row-span-3 md:col-start-4 md:row-start-6 h-[420px] md:h-auto">
            <WidgetSlot slotId="main-schedule" renderProps={rp} />
          </div>

          {/* Activity */}
          <div data-tour-id="recent-activity" className="order-8 md:col-span-6 md:row-span-2 md:col-start-7 md:row-start-5 h-[284px] md:h-auto">
            <WidgetSlot slotId="main-activity" renderProps={rp} />
          </div>

          {/* Subsidy */}
          <div data-tour-id="subsidy-matches" className="order-10 md:col-span-6 md:row-span-2 md:col-start-7 md:row-start-7 h-[284px] md:h-auto">
            <WidgetSlot slotId="main-subsidy" renderProps={rp} />
          </div>
        </div>
      </div>

      {loading && !summary && !ctx?.isEditing && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <div className="rounded-full bg-[#fcfcfc] px-4 py-1.5 text-xs text-[#030303] shadow-lg">
            불러오는 중...
          </div>
        </div>
      )}
    </div>
  );
};
