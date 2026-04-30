"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2 } from "lucide-react";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";

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
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const LongTermMemoryModal = ({ open, onClose }: Props) => {
  const [items, setItems] = useState<LongMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const deleteItem = async (id: string) => {
    setDeletingId(id);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setDeletingId(null);
      return;
    }

    try {
      await fetch(`${API}/api/memory/long/${id}?account_id=${user.id}`, {
        method: "DELETE",
      });
      setItems((prev) => prev.filter((m) => m.id !== id));
      window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
    } finally {
      setDeletingId(null);
    }
  };

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
            Loading...
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
                  className="group rounded-[5px] border border-[#030303]/10 bg-[#ffffff] px-3 py-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <MarkdownMessage
                        content={m.content}
                        className="text-[12.5px] leading-snug text-[#030303]"
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => deleteItem(m.id)}
                        disabled={deletingId === m.id}
                        className="rounded p-1 text-[#030303]/40 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
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
