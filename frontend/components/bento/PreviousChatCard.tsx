"use client";

import { useMemo, type KeyboardEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { useChat } from "@/components/chat/ChatContext";

const cleanTitle = (t: string | null | undefined) =>
  (t ?? "").replace(/^\[MOCK\]\s*/, "").trim() || "New chat";

export const PreviousChatCard = ({ bgColor }: { bgColor?: string }) => {
  const { sessions, requestLoadSession } = useChat();
  const shown = useMemo(
    () =>
      [...sessions]
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        .slice(0, 4),
    [sessions],
  );

  const openModal = () =>
    window.dispatchEvent(new CustomEvent("boss:open-chat-history-modal"));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openModal();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openModal}
      onKeyDown={onKey}
      style={{ backgroundColor: bgColor ?? "#d9d4e6" }}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-base font-semibold tracking-tight text-[#030303]">
          Chat History
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/50">
          Nothing here yet
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {shown.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  requestLoadSession(it.id);
                }}
                className="w-full rounded-[5px] bg-[#fcfcfc]/50 px-3 py-2 text-left text-sm text-[#030303] transition-colors hover:bg-[#fcfcfc]/80"
              >
                · {cleanTitle(it.title)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
