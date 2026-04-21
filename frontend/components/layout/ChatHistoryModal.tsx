"use client";

import { useEffect, useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChat } from "@/components/chat/ChatContext";

type SessionRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const API = process.env.NEXT_PUBLIC_API_URL;

const cleanTitle = (t: string | null | undefined) =>
  (t ?? "").replace(/^\[MOCK\]\s*/, "").trim() || "(untitled)";

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

export const ChatHistoryModal = ({ open, onClose }: Props) => {
  const { requestLoadSession, currentSessionId, requestNewSession } = useChat();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
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
          setSessions([]);
          setLoading(false);
        }
        return;
      }
      const res = await fetch(
        `${API}/api/chat/sessions?account_id=${user.id}&limit=200`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (cancelled) return;
      setAccountId(user.id);
      setSessions((json?.data as SessionRow[] | null) ?? []);
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handlePick = (id: string) => {
    requestLoadSession(id);
    onClose();
  };

  const handleDelete = async (id: string) => {
    if (!accountId || deletingId) return;
    if (!window.confirm("Delete this chat? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/api/chat/sessions/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === currentSessionId) requestNewSession();
    } catch (e) {
      window.alert(
        `Delete failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chat History"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="h-[560px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/60">
            Loading…
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[#030303]/50">
            <MessageSquare className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nothing here yet</p>
          </div>
        ) : (
          <ScrollArea className="h-full pr-1">
            <ul className="space-y-1">
              {sessions.map((s) => {
                const deleting = deletingId === s.id;
                return (
                  <li
                    key={s.id}
                    className="group relative rounded-[5px] border border-transparent transition-colors hover:border-[#030303]/10 hover:bg-[#030303]/[0.03]"
                  >
                    <button
                      type="button"
                      onClick={() => handlePick(s.id)}
                      disabled={deleting}
                      className="block w-full px-3 py-2 pr-10 text-left disabled:opacity-50"
                    >
                      <div className="truncate text-[13px] font-medium text-[#030303]">
                        {cleanTitle(s.title)}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-[#030303]/50">
                        {formatRelative(s.updated_at)}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(s.id);
                      }}
                      disabled={deleting}
                      aria-label="Delete chat"
                      title="Delete chat"
                      className="absolute right-2 top-2 rounded p-1 text-[#030303]/40 opacity-0 transition-opacity hover:bg-[#030303]/[0.08] hover:text-[#c7422f] group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
