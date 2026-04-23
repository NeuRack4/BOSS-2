"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type LongMemoryRow = {
  id: string;
  content: string;
  importance: number | null;
  created_at: string;
};

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

export const LongMemoryWidget = () => {
  const [items, setItems] = useState<LongMemoryRow[]>([]);
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
        .from("memory_long")
        .select("id, content, importance, created_at")
        .eq("account_id", user.id)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setItems((data as LongMemoryRow[] | null) ?? []);
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
        window.dispatchEvent(new CustomEvent("boss:open-longmem-modal"))
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("boss:open-longmem-modal"));
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] p-5 text-left shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
      style={{ backgroundColor: "#eee3c4" }}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <span className="text-base font-semibold tracking-tight text-[#030303]">
          Long-term Memory
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
              <li
                key={m.id}
                className="rounded-[5px] bg-[#fcfcfc]/50 px-3 py-2 text-[#030303]"
              >
                <p className="text-[13px] leading-snug line-clamp-2">
                  {m.content}
                </p>
                <div className="mt-1 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[#030303]/55">
                  <span>{formatRelative(m.created_at)}</span>
                  {typeof m.importance === "number" && (
                    <span>★ {m.importance.toFixed(1)}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
