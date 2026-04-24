"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type CommentItem = {
  id: string;
  platform: "youtube" | "instagram";
  media_id: string;
  media_title: string;
  comment_id: string;
  commenter_name: string;
  comment_text: string;
  ai_reply: string;
  status: "pending" | "posted" | "ignored";
  created_at: string;
  posted_at: string | null;
};

type StatusFilter = "pending" | "posted" | "ignored" | "all";

const PLATFORM_STYLE = {
  youtube: {
    bg: "bg-[#ff0000]/10 text-[#cc0000]",
    label: "YouTube",
  },
  instagram: {
    bg: "bg-[#e1306c]/10 text-[#b5264f]",
    label: "Instagram",
  },
};

const STATUS_LABEL: Record<StatusFilter, string> = {
  pending: "Pending",
  posted: "Posted",
  ignored: "Ignored",
  all: "All",
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

type Props = {
  open: boolean;
  onClose: () => void;
};

export const CommentManagerModal = ({ open, onClose }: Props) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  const [accountId, setAccountId] = useState("");
  const [items, setItems] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [postingId, setPostingId] = useState<string | null>(null);

  const getAccountId = useCallback(async () => {
    if (accountId) return accountId;
    const sb = createClient();
    const { data } = await sb.auth.getUser();
    const id = data.user?.id ?? "";
    setAccountId(id);
    return id;
  }, [accountId]);

  const loadComments = useCallback(async () => {
    const aid = await getAccountId();
    if (!aid) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/api/comments/?account_id=${aid}&status=${statusFilter}&limit=100`,
        { cache: "no-store" },
      );
      const json = await res.json();
      setItems(json?.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, getAccountId, statusFilter]);

  useEffect(() => {
    if (open) loadComments();
  }, [open, loadComments]);

  const handleScan = async () => {
    const aid = await getAccountId();
    if (!aid) return;
    setScanning(true);
    try {
      await fetch(`${apiBase}/api/comments/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: aid }),
      });
      await loadComments();
      window.dispatchEvent(new CustomEvent("boss:comments-changed"));
    } catch {
      // silently fail
    } finally {
      setScanning(false);
    }
  };

  const handlePost = async (item: CommentItem) => {
    const aid = await getAccountId();
    if (!aid) return;
    setPostingId(item.id);
    try {
      const res = await fetch(
        `${apiBase}/api/comments/${item.id}/post?account_id=${aid}`,
        { method: "POST" },
      );
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setItems((prev) =>
        prev.map((c) => (c.id === item.id ? { ...c, status: "posted" } : c)),
      );
      window.dispatchEvent(new CustomEvent("boss:comments-changed"));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Post failed");
    } finally {
      setPostingId(null);
    }
  };

  const handleIgnore = async (item: CommentItem) => {
    const aid = await getAccountId();
    if (!aid) return;
    await fetch(`${apiBase}/api/comments/${item.id}/ignore?account_id=${aid}`, {
      method: "POST",
    });
    setItems((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, status: "ignored" } : c)),
    );
    window.dispatchEvent(new CustomEvent("boss:comments-changed"));
  };

  const handleEditSave = async (item: CommentItem) => {
    const aid = await getAccountId();
    if (!aid) return;
    await fetch(`${apiBase}/api/comments/${item.id}/reply`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: aid, ai_reply: editText }),
    });
    setItems((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, ai_reply: editText } : c)),
    );
    setEditingId(null);
  };

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Comment Manager"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="h-[560px] flex flex-col gap-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="flex gap-1">
            {(["pending", "posted", "ignored", "all"] as StatusFilter[]).map(
              (s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-[#7c4daa] text-white"
                      : "bg-[#f0ece4] text-[#5a5040] hover:bg-[#e5ddd0]"
                  }`}
                >
                  {s === "pending"
                    ? `Pending${pendingCount > 0 && statusFilter !== "pending" ? ` (${pendingCount})` : ""}`
                    : STATUS_LABEL[s]}
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            onClick={handleScan}
            disabled={scanning}
            className="rounded-md bg-[#f0ece4] px-3 py-1.5 text-[12px] font-medium text-[#5a5040] hover:bg-[#e5ddd0] disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Refresh"}
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/50">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[#030303]/50">
            <p className="text-sm">Nothing here yet</p>
            <p className="text-[12px]">Click Refresh to fetch comments.</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 pr-1">
            <div className="space-y-0">
              {items.map((item, i) => {
                const pstyle = PLATFORM_STYLE[item.platform];
                const isEditing = editingId === item.id;
                const isPosting = postingId === item.id;

                return (
                  <div key={item.id}>
                    <div className="py-3 space-y-2">
                      {/* Header row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${pstyle.bg}`}
                        >
                          {pstyle.label}
                        </span>
                        {item.media_title && (
                          <span className="truncate max-w-[180px] text-[11px] text-[#030303]/50">
                            {item.media_title}
                          </span>
                        )}
                        <span className="ml-auto text-[11px] text-[#030303]/40 shrink-0">
                          {formatTime(item.created_at)}
                        </span>
                        {item.status === "posted" && (
                          <span className="rounded bg-[#cfe3d0] px-1.5 py-0.5 text-[10px] font-semibold text-[#2e5a3a]">
                            Posted
                          </span>
                        )}
                        {item.status === "ignored" && (
                          <span className="rounded bg-[#f0ece4] px-1.5 py-0.5 text-[10px] text-[#8c7e66]">
                            Ignored
                          </span>
                        )}
                      </div>

                      {/* Comment */}
                      <div className="rounded-[5px] bg-[#f8f4ee] px-3 py-2">
                        <div className="text-[11px] font-semibold text-[#5a5040] mb-0.5">
                          {item.commenter_name || "Anonymous"}
                        </div>
                        <div className="text-[13px] text-[#030303]">
                          {item.comment_text}
                        </div>
                      </div>

                      {/* AI Reply */}
                      <div className="rounded-[5px] border border-[#7c4daa]/20 bg-[#f7f0ff] px-3 py-2">
                        <div className="text-[11px] font-semibold text-[#7c4daa] mb-1">
                          AI Reply Draft
                        </div>
                        {isEditing ? (
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={2}
                            className="w-full resize-none rounded border border-[#7c4daa]/30 bg-white px-2 py-1 text-[13px] outline-none focus:border-[#7c4daa]"
                          />
                        ) : (
                          <div className="text-[13px] text-[#030303] whitespace-pre-wrap">
                            {item.ai_reply || "(no reply)"}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      {item.status === "pending" && (
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEditSave(item)}
                                className="rounded-md bg-[#7c4daa] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-md border border-[#ddd0b4] px-3 py-1.5 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handlePost(item)}
                                disabled={isPosting}
                                className="rounded-md bg-[#7c4daa] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                              >
                                {isPosting ? "Posting…" : "Post"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(item.id);
                                  setEditText(item.ai_reply);
                                }}
                                className="rounded-md border border-[#ddd0b4] px-3 py-1.5 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleIgnore(item)}
                                className="rounded-md border border-[#ddd0b4] px-3 py-1.5 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
                              >
                                Ignore
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {i < items.length - 1 && <Separator />}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
