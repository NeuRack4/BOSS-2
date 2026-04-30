"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type MemoRow = {
  id: string;
  content: string;
  updated_at: string;
  artifacts?: { title: string | null } | null;
};

const cleanTitle = (t: string | null | undefined) =>
  (t ?? "").replace(/^\[MOCK\]\s*/, "").trim() || "(제목 없음)";

const formatRelative = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
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

export const MemosWidget = ({ bgColor }: { bgColor?: string }) => {
  const [items, setItems] = useState<MemoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchMemos = async () => {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await sb
      .from("memos")
      .select("id, content, updated_at, artifacts(title)")
      .eq("account_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    setItems((data as unknown as MemoRow[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const sb = createClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await sb
        .from("memos")
        .select("id, content, updated_at, artifacts(title)")
        .eq("account_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setItems((data as unknown as MemoRow[] | null) ?? []);
        setLoading(false);
      }
    };
    run();
    const refresh = () => run();
    window.addEventListener("boss:artifacts-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("boss:artifacts-changed", refresh);
    };
  }, []);

  useEffect(() => {
    if (adding) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [adding]);

  const openAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft("");
    setAdding(true);
  };

  const cancelAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAdding(false);
    setDraft("");
  };

  const submitMemo = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const sb = createClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
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

  const shown = items.slice(0, 3);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() =>
        !adding &&
        window.dispatchEvent(new CustomEvent("boss:open-memos-modal"))
      }
      onKeyDown={(e) => {
        if (!adding && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("boss:open-memos-modal"));
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] p-5 text-left shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
      style={{ backgroundColor: bgColor ?? "#c6dad1" }}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <span className="text-base font-semibold tracking-tight text-[#030303]">
          Memos
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openAdd}
            className="rounded p-0.5 text-[#030303]/60 transition-colors hover:bg-[#030303]/10 hover:text-[#030303]"
            title="메모 추가"
          >
            <Plus size={15} />
          </button>
          <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
        </div>
      </div>

      {adding && (
        <div
          className="mb-2 flex shrink-0 flex-col gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitMemo(e);
              if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
                setDraft("");
              }
            }}
            placeholder="메모 입력… (Cmd+Enter 저장)"
            rows={3}
            className="w-full resize-none rounded-[5px] border border-[#030303]/20 bg-white/70 px-2.5 py-2 text-[12.5px] leading-snug text-[#030303] placeholder:text-[#030303]/40 focus:outline-none focus:ring-1 focus:ring-[#030303]/30"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={cancelAdd}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-[11px] text-[#030303]/50 hover:bg-[#030303]/10"
            >
              <X size={11} /> 취소
            </button>
            <button
              type="button"
              onClick={submitMemo}
              disabled={!draft.trim() || saving}
              className="rounded px-2.5 py-1 text-[11px] font-medium text-[#030303] transition-colors hover:bg-[#030303]/15 disabled:opacity-40"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-[#030303]/50">
            불러오는 중…
          </div>
        ) : shown.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/50">
            Nothing here yet
          </div>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(
                      new CustomEvent("boss:open-memos-modal"),
                    );
                  }}
                  className="block w-full rounded-[5px] bg-[#fcfcfc]/50 px-3 py-2 text-left text-[#030303] transition-colors hover:bg-[#fcfcfc]/80"
                >
                  <div className="mb-0.5 truncate text-[11px] font-semibold uppercase tracking-wider text-[#030303]/55">
                    {m.artifacts?.title ? cleanTitle(m.artifacts.title) : "메모"}
                  </div>
                  <p className="text-[13px] leading-snug line-clamp-2">
                    {m.content}
                  </p>
                  <div className="mt-1 font-mono text-[10.5px] tabular-nums text-[#030303]/55">
                    {formatRelative(m.updated_at)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
