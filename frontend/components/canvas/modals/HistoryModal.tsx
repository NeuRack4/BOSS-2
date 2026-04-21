"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";

type LogRow = {
  id: string;
  type: string;
  domain: string;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  artifactId: string;
  title: string;
};

export const HistoryModal = ({ open, onClose, artifactId, title }: Props) => {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("no user");
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/schedules/${artifactId}/history?account_id=${user.id}&limit=50`,
        );
        const json = (await res.json()) as { data?: { logs?: LogRow[] } };
        if (!cancelled) setLogs(json.data?.logs ?? []);
      } catch {
        if (!cancelled) setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, artifactId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`실행 이력: ${title}`}
      widthClass="w-[560px]"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[#8c7e66]" />
        </div>
      ) : !logs || logs.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-[#8c7e66]">
          Nothing here yet
        </p>
      ) : (
        <ScrollArea className="h-[360px] pr-2">
          <ul className="space-y-2">
            {logs.map((log) => {
              const preview = (log.metadata?.reply_preview as string) || "";
              return (
                <li
                  key={log.id}
                  className="rounded-md border border-[#ddd0b4] bg-[#ebe0ca]/50 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#8c7e66]">
                      {log.domain}
                    </span>
                    <span className="font-mono text-[10px] text-[#8c7e66]">
                      {log.created_at?.replace("T", " ").slice(0, 19)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-[#2e2719]">
                    {log.description || log.title}
                  </p>
                  {preview && (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] text-[#5a5040]">
                      {preview}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </Modal>
  );
};
