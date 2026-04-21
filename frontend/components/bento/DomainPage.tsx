"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  FileText,
  Megaphone,
  TrendingUp,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { ChatProvider } from "@/components/chat/ChatContext";
import { BriefingLoader } from "@/components/chat/BriefingLoader";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { DOMAIN_META, type DomainKey } from "./types";
import { KanbanBoard } from "./KanbanBoard";

const ICON: Record<DomainKey, typeof Briefcase> = {
  recruitment: Briefcase,
  marketing: Megaphone,
  sales: TrendingUp,
  documents: FileText,
};

type Props = {
  domain: DomainKey;
};

export const DomainPage = ({ domain }: Props) => {
  const meta = DOMAIN_META[domain];
  const Icon = ICON[domain];
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  return (
    <ChatProvider>
      <div className="bento-shell flex h-screen flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1400px] p-4 md:p-6">
            <div
              className={cn(
                "relative mb-6 overflow-hidden rounded-3xl p-6 text-white shadow-lg md:p-8",
                meta.bg,
              )}
            >
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl"
                aria-hidden
              />
              <Link
                href="/dashboard"
                className="mb-3 inline-flex items-center gap-1.5 text-xs text-white/80 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                대시보드
              </Link>
              <div className="relative flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                    {meta.label}
                  </h1>
                  <p className="text-xs text-white/80 md:text-sm">
                    서브허브별 보드
                  </p>
                </div>
              </div>
            </div>

            {userId ? (
              <KanbanBoard accountId={userId} domain={domain} />
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-xs text-white/50">
                불러오는 중...
              </div>
            )}
          </div>
        </main>
        <ChatOverlay />
        <BriefingLoader />
      </div>
    </ChatProvider>
  );
};
