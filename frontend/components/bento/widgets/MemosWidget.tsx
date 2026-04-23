"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

export const MemosWidget = () => {
  const [items, setItems] = useState<MemoRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  const shown = items.slice(0, 3);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() =>
        window.dispatchEvent(new CustomEvent("boss:open-memos-modal"))
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("boss:open-memos-modal"));
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] p-5 text-left shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
      style={{ backgroundColor: "#c6dad1" }}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <span className="text-base font-semibold tracking-tight text-[#030303]">
          Memos
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
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
                    {cleanTitle(m.artifacts?.title)}
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
