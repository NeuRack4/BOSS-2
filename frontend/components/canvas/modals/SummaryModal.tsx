"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";

type LogRow = {
  type: string;
  domain: string;
  title: string;
  description: string;
  created_at: string;
};

type SummaryData = {
  summary: string;
  counts: {
    logs: number;
    artifacts: number;
    types: Record<string, number>;
    statuses: Record<string, number>;
  };
  logs: LogRow[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  scope: "all" | "recruitment" | "marketing" | "sales" | "documents";
  title: string;
};

const TAB_CLS = (active: boolean) =>
  active
    ? "border-[#7f8f54] text-[#6a7843]"
    : "border-transparent text-[#8c7e66] hover:text-[#2e2719]";

export const SummaryModal = ({ open, onClose, scope, title }: Props) => {
  const [tab, setTab] = useState<"summary" | "history">("summary");
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setData(null);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("no user");
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/summary`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: user.id, scope }),
          },
        );
        const json = (await res.json()) as { data?: SummaryData };
        if (!cancelled && json.data) setData(json.data);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  return (
    <Modal open={open} onClose={onClose} title={title} widthClass="w-[580px]">
      <div className="mb-3 flex gap-4 border-b border-[#ddd0b4]">
        <button
          type="button"
          onClick={() => setTab("summary")}
          className={`border-b-2 px-1 pb-2 text-[12px] font-medium transition-colors ${TAB_CLS(tab === "summary")}`}
        >
          현재 상황 요약
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`border-b-2 px-1 pb-2 text-[12px] font-medium transition-colors ${TAB_CLS(tab === "history")}`}
        >
          활동 이력
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-[#8c7e66]" />
        </div>
      ) : !data ? (
        <p className="py-8 text-center text-[12px] text-[#8c7e66]">
          데이터를 불러올 수 없습니다.
        </p>
      ) : tab === "summary" ? (
        <div className="space-y-3">
          <div className="whitespace-pre-wrap rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/50 px-3 py-2.5 text-[12px] leading-relaxed text-[#2e2719]">
            {data.summary}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/40 px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-wider text-[#8c7e66]">
                활동 로그
              </p>
              <p className="mt-0.5 text-lg font-semibold text-[#2e2719]">
                {data.counts.logs}
              </p>
            </div>
            <div className="rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/40 px-3 py-2">
              <p className="font-mono text-[9px] uppercase tracking-wider text-[#8c7e66]">
                아티팩트
              </p>
              <p className="mt-0.5 text-lg font-semibold text-[#2e2719]">
                {data.counts.artifacts}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="h-[360px] pr-2">
          {data.logs.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-[#8c7e66]">
              최근 30일 활동이 없습니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.logs.map((log, i) => (
                <li
                  key={i}
                  className="rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/50 px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-wider text-[#8c7e66]">
                      {log.domain} · {log.type}
                    </span>
                    <span className="font-mono text-[9px] text-[#8c7e66]">
                      {log.created_at?.slice(0, 10)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-[#2e2719]">{log.title}</p>
                  {log.description && (
                    <p className="mt-0.5 text-[11px] text-[#5a5040]">
                      {log.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      )}
    </Modal>
  );
};
