"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";

type LongMemoryRow = {
  id: string;
  content: string;
  importance: number | null;
  created_at: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const formatRelative = (iso: string): string => {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
};

export const LongTermMemoryModal = ({ open, onClose }: Props) => {
  const [items, setItems] = useState<LongMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("memory_long")
        .select("id, content, importance, created_at")
        .eq("account_id", user.id)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setItems((data as LongMemoryRow[] | null) ?? []);
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Long-term Memory"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="h-[560px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/60">
            불러오는 중...
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/50">
            Nothing here yet
          </div>
        ) : (
          <ScrollArea className="h-full pr-1">
            <ul className="space-y-1.5">
              {items.map((m) => (
                <li
                  key={m.id}
                  className="rounded-[5px] border border-[#030303]/10 bg-[#ffffff] px-3 py-2"
                >
                  <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-[#030303]">
                    {m.content}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] tabular-nums text-[#030303]/50">
                    <span>{formatRelative(m.created_at)}</span>
                    {typeof m.importance === "number" && (
                      <span>★ {m.importance.toFixed(1)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
