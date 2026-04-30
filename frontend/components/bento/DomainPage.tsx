"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Briefcase,
  FileText,
  Megaphone,
  TrendingUp,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { BriefingLoader } from "@/components/chat/BriefingLoader";
import { useChat } from "@/components/chat/ChatContext";
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
  const { userId } = useChat();

  return (
    <div className="bento-shell flex h-screen flex-col overflow-hidden">
      <Header />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] p-4 md:p-6">
          <div
            className={cn(
              "relative mb-6 overflow-hidden rounded-[5px] p-6 text-[color:var(--kb-fg-on-banner)] shadow-lg md:p-8",
              meta.bg,
            )}
          >
            <div
              className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/20 blur-3xl"
              aria-hidden
            />
            <Link
              href="/dashboard"
              className="mb-3 inline-flex items-center gap-1.5 text-xs text-[color:var(--kb-fg-on-banner-muted)] transition-colors hover:text-[color:var(--kb-fg-on-banner)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <div className="relative flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/30 backdrop-blur-sm">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                  {meta.label}
                </h1>
                <p className="text-xs text-[color:var(--kb-fg-on-banner-muted)] md:text-sm">
                  Sub-hub boards
                </p>
              </div>
            </div>
          </div>

          {userId ? (
            <KanbanBoard accountId={userId} domain={domain} />
          ) : (
            <div className="rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] p-8 text-center text-xs text-[color:var(--kb-fg-muted)]">
              불러오는 중...
            </div>
          )}
        </div>
      </main>
      <BriefingLoader />
    </div>
  );
};
