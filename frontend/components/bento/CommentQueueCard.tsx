"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type CommentItem = {
  id: string;
  platform: "youtube" | "instagram";
  media_title: string;
  commenter_name: string;
  comment_text: string;
  ai_reply: string;
  status: "pending" | "posted" | "ignored";
  created_at: string;
};

const PLATFORM_BADGE = {
  youtube: {
    bg: "bg-[#ff0000]/10 text-[#cc0000]",
    icon: <Play className="h-3 w-3" />,
    label: "YouTube",
  },
  instagram: {
    bg: "bg-[#e1306c]/10 text-[#b5264f]",
    icon: <span className="text-[10px]">📸</span>,
    label: "Instagram",
  },
};

type Props = { accountId: string; bgColor?: string };

export const CommentQueueCard = ({ accountId, bgColor }: Props) => {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/comments/?account_id=${accountId}&status=pending&limit=6`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (!cancel) setItems(json?.data ?? []);
      } catch {
        if (!cancel) setItems([]);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();

    const onChange = () => load();
    window.addEventListener("boss:comments-changed", onChange);
    return () => {
      cancel = true;
      window.removeEventListener("boss:comments-changed", onChange);
    };
  }, [apiBase, accountId]);

  const openModal = () =>
    window.dispatchEvent(new CustomEvent("boss:open-comment-modal"));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openModal}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openModal();
        }
      }}
      style={{ backgroundColor: bgColor ?? "#f4dbd9" }}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold tracking-tight text-[#030303]">
            Comment Queue
          </span>
          {items.length > 0 && (
            <span className="rounded-full bg-[#7c4daa] px-2 py-0.5 text-[11px] font-semibold text-white">
              {items.length}
            </span>
          )}
        </div>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/40">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/40">
          Nothing here yet
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {items.map((item) => {
            const badge = PLATFORM_BADGE[item.platform];
            return (
              <li key={item.id}>
                <div className="flex w-full items-start gap-2 rounded-[5px] bg-white/60 px-3 py-2">
                  <span
                    className={`mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.bg}`}
                  >
                    {badge.icon}
                    {badge.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-[#030303]">
                      {item.commenter_name}
                    </div>
                    <div className="truncate text-[11px] text-[#030303]/60">
                      {item.comment_text}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
