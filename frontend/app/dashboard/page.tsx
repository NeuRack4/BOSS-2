"use client";

import { useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { BriefingLoader } from "@/components/chat/BriefingLoader";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { LayoutProvider } from "@/components/bento/LayoutContext";
import { useChat } from "@/components/chat/ChatContext";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { useTour } from "@/components/tour/TourContext";

export default function DashboardPage() {
  const { userId } = useChat();
  const { start } = useTour();

  // Auto-start on first visit
  useEffect(() => {
    if (!userId) return;
    if (!localStorage.getItem("boss_tour_done")) {
      const t = setTimeout(start, 800);
      return () => clearTimeout(t);
    }
  }, [userId, start]);

  return (
    <LayoutProvider accountId={userId ?? ""}>
      <div className="bento-shell flex h-screen flex-col overflow-hidden">
        <Header sidebar />
        <main className="flex-1 overflow-auto">
          {userId ? (
            <BentoGrid accountId={userId} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[#030303]/40">
              불러오는 중...
            </div>
          )}
        </main>
        <BriefingLoader />
        <TourOverlay />
      </div>
    </LayoutProvider>
  );
}
