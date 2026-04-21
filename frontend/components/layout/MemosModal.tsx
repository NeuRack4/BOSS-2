"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";

type MemoRow = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  artifact_id: string;
  artifacts?: { title: string | null } | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const cleanTitle = (t: string | null | undefined) =>
  (t ?? "").replace(/^\[MOCK\]\s*/, "").trim() || "(제목 없음)";

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

export const MemosModal = ({ open, onClose }: Props) => {
  const [items, setItems] = useState<MemoRow[]>([]);
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
        .from("memos")
        .select(
          "id, content, created_at, updated_at, artifact_id, artifacts(title)",
        )
        .eq("account_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setItems((data as unknown as MemoRow[] | null) ?? []);
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleFocus = (artifactId: string) => {
    onClose();
    window.dispatchEvent(
      new CustomEvent("boss:focus-node", { detail: { id: artifactId } }),
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Memos"
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
            <div className="grid grid-cols-2 gap-2">
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleFocus(m.artifact_id)}
                  title="노드로 이동"
                  className="rounded-[5px] border border-[#030303]/10 bg-[#ffffff] px-3 py-2 text-left transition-colors hover:border-[#030303]/25 hover:bg-[#030303]/[0.03]"
                >
                  <div className="mb-1 truncate font-mono text-[10px] uppercase tracking-wider text-[#030303]/55">
                    {cleanTitle(m.artifacts?.title)}
                  </div>
                  <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-[#030303] line-clamp-6">
                    {m.content}
                  </p>
                  <div className="mt-1.5 font-mono text-[10px] tabular-nums text-[#030303]/50">
                    {formatRelative(m.updated_at)}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
