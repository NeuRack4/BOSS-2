"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, X } from "lucide-react";
import { useNodeDetail } from "@/components/detail/NodeDetailContext";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type MemoRow = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  artifact_id: string | null;
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
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { openDetail } = useNodeDetail();

  const fetchMemos = async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("memos")
      .select("id, content, created_at, updated_at, artifact_id, artifacts(title)")
      .eq("account_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(200);
    setItems((data as unknown as MemoRow[] | null) ?? []);
  };

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

  useEffect(() => {
    if (adding) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [adding]);

  const submitMemo = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await fetch(`${API}/api/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: user.id, content: text }),
      });
      setAdding(false);
      setDraft("");
      await fetchMemos();
      window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
    } finally {
      setSaving(false);
    }
  };

  const handleFocus = (artifactId: string | null) => {
    if (!artifactId) return;
    onClose();
    openDetail(artifactId);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Memos"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="flex h-[560px] flex-col gap-3">
        {adding ? (
          <div className="shrink-0 rounded-[5px] border border-[#030303]/15 bg-[#fafafa] p-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitMemo();
                if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              placeholder="메모 입력… (Cmd+Enter 저장)"
              rows={3}
              className="w-full resize-none rounded-[4px] border border-[#030303]/15 bg-white px-3 py-2 text-[13px] leading-snug text-[#030303] placeholder:text-[#030303]/40 focus:outline-none focus:ring-1 focus:ring-[#030303]/25"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setDraft("");
                }}
                className="flex items-center gap-1 rounded px-2.5 py-1.5 text-[12px] text-[#030303]/50 hover:bg-[#030303]/10"
              >
                <X size={12} /> 취소
              </button>
              <button
                type="button"
                onClick={submitMemo}
                disabled={!draft.trim() || saving}
                className="rounded px-3 py-1.5 text-[12px] font-medium text-[#030303] transition-colors hover:bg-[#030303]/10 disabled:opacity-40"
              >
                {saving ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex shrink-0 items-center gap-1.5 self-start rounded-[5px] border border-[#030303]/15 bg-white px-3 py-1.5 text-[12.5px] text-[#030303]/60 transition-colors hover:border-[#030303]/30 hover:text-[#030303]"
          >
            <Plus size={13} /> 메모 추가
          </button>
        )}

        <div className="min-h-0 flex-1">
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
                    title={m.artifact_id ? "노드로 이동" : undefined}
                    className={`rounded-[5px] border border-[#030303]/10 bg-[#ffffff] px-3 py-2 text-left transition-colors hover:border-[#030303]/25 hover:bg-[#030303]/[0.03] ${!m.artifact_id ? "cursor-default" : ""}`}
                  >
                    <div className="mb-1 truncate font-mono text-[10px] uppercase tracking-wider text-[#030303]/55">
                      {m.artifact_id
                        ? cleanTitle(m.artifacts?.title)
                        : "메모"}
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
      </div>
    </Modal>
  );
};
