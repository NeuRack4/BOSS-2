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
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col overflow-hidden p-4 md:p-6">
            <div
              className={cn(
                "relative mb-4 shrink-0 overflow-hidden rounded-[5px] p-5 text-[color:var(--kb-fg-on-banner)] shadow-lg md:p-6",
                meta.bg,
              )}
            >
              <div
                className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/20 blur-3xl"
                aria-hidden
              />
              <Link
                href="/dashboard"
                className="mb-2 inline-flex items-center gap-1.5 text-xs text-[color:var(--kb-fg-on-banner-muted)] transition-colors hover:text-[color:var(--kb-fg-on-banner)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Link>
              <div className="relative flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/30 backdrop-blur-sm">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight md:text-2xl">
                    {meta.label}
                  </h1>
                  <p className="text-xs text-[color:var(--kb-fg-on-banner-muted)]">
                    Sub-hub boards
                  </p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {userId ? (
                <KanbanBoard accountId={userId} domain={domain} />
              ) : (
                <div className="rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] p-8 text-center text-xs text-[color:var(--kb-fg-muted)]">
                  불러오는 중...
                </div>
              )}
            </div>
          </div>
        </main>
        <BriefingLoader />
      </div>
    </ChatProvider>
  );
};
