"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ChatProvider } from "@/components/chat/ChatContext";
import { BriefingLoader } from "@/components/chat/BriefingLoader";
import { BentoGrid } from "@/components/bento/BentoGrid";
import { createClient } from "@/lib/supabase/client";

export default function DashboardPage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  return (
    <ChatProvider>
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
    </ChatProvider>
  );
}
