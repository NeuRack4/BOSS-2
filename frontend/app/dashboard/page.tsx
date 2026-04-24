"use client";

import { Header } from "@/components/layout/Header";
import { BriefingLoader } from "@/components/chat/BriefingLoader";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { LayoutProvider } from "@/components/bento/LayoutContext";
import { useChat } from "@/components/chat/ChatContext";

export default function DashboardPage() {
  const { userId } = useChat();

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
      </div>
    </LayoutProvider>
  );
}
