"use client";

import { MessageSquarePlus } from "lucide-react";
import { InlineChat } from "@/components/chat/InlineChat";
import { useChat } from "@/components/chat/ChatContext";

export const ChatCenterCard = () => {
  const { requestNewSession } = useChat();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[5px] bg-[#fefefe] text-[#030303] shadow-lg">
      <div className="flex shrink-0 items-center justify-between px-5 py-3">
        <div className="text-xl font-bold tracking-tight text-[#030303]">
          I&apos;m BOSS
        </div>
        <button
          type="button"
          onClick={requestNewSession}
          aria-label="새 대화"
          title="새 대화"
          className="flex items-center gap-1.5 rounded-[5px] border border-[#030303]/10 bg-[#fcfcfc] px-2.5 py-1 text-[11px] text-[#030303]/70 transition-colors hover:bg-[#030303]/[0.05] hover:text-[#030303]"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New Session
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <InlineChat />
      </div>
    </div>
  );
};
