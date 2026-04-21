"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowUp } from "lucide-react";
import { useChat } from "@/components/chat/ChatContext";

const SUGGESTED = [
  "이번 주 마케팅 캠페인 뽑아줘",
  "이번 달 매출 요약 정리해줘",
  "공고 새로 올려야 할 거 있어?",
  "어제 업로드한 계약서 다시 분석해줘",
];

export const ChatCenterCard = () => {
  const { send, openChat } = useChat();
  const [input, setInput] = useState("");

  const submit = (text?: string) => {
    const t = (text ?? input).trim();
    if (!t) return;
    send(t);
    setInput("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[5px] bg-[#ffffff] p-6 text-[#030303] shadow-lg">
      <div className="relative flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-tight text-[#030303]">
            I'm BOSS
          </div>
        </div>
        <button
          type="button"
          onClick={() => openChat()}
          className="ml-auto rounded-lg bg-[#f39f7e]/15 px-3 py-1.5 text-xs text-[#030303] transition-colors hover:bg-[#f39f7e]/30"
        >
          전체 열기
        </button>
      </div>

      <div className="relative mt-auto space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {SUGGESTED.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => submit(s)}
              className="truncate rounded-xl bg-[#f39f7e]/15 px-3 py-2.5 text-left text-xs text-[#030303] transition-all hover:-translate-y-0.5 hover:bg-[#f39f7e]/30"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-end gap-2 rounded-lg border border-[#030303]/10 bg-white p-2 focus-within:border-[#476f65]"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="메시지를 입력하세요..."
            rows={2}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-[#030303] placeholder:text-[#030303]/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#476f65] text-[#fcfcfc] transition-colors hover:bg-[#2f5049] disabled:opacity-40"
            aria-label="보내기"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
