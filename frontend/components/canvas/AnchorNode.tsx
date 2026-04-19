"use client";

import { useState, type KeyboardEvent } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { ArrowUpIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChat } from "@/components/chat/ChatContext";

export const AnchorNode = (_: NodeProps) => {
  const { openChat } = useChat();
  const [value, setValue] = useState("");

  const expand = () => openChat(value);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      expand();
    }
  };

  return (
    <div className="relative">
      <div className="anchor-ring pointer-events-none absolute inset-0 rounded-xl bg-[#b85a4a]/20" />
      <div className="anchor-ring anchor-ring-delay pointer-events-none absolute inset-0 rounded-xl bg-[#b85a4a]/20" />

      <div
        className="relative w-[980px] overflow-hidden rounded-3xl border border-[#b85a4a]/50 bg-[#fbf6eb]/95 backdrop-blur transition-all hover:shadow-lg hover:shadow-[#b85a4a]/15 nodrag nopan"
        role="article"
        aria-label="BOSS"
      >
        <div className="flex items-center gap-6 px-7 py-7">
          <div
            className="flex h-[77px] w-[77px] shrink-0 items-center justify-center rounded-2xl border border-[#b85a4a]/50 bg-[#ebe0ca] text-[#b85a4a]"
            aria-hidden="true"
          >
            <Sparkles className="h-10 w-10" />
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              const wasEmpty = value.length === 0;
              setValue(next);
              // 첫 글자 입력 순간에만 채팅창 오픈 (focus만으로는 열지 않음)
              if (wasEmpty && next.length > 0) openChat(next);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            placeholder="BOSS에게 무엇이든 시켜보세요..."
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[28px] text-[#2e2719]",
              "placeholder:text-[#8c7e66]",
              "focus:outline-none",
            )}
            aria-label="orchestrator 입력"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              expand();
            }}
            className={cn(
              "flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-2xl border transition-colors",
              value.trim()
                ? "border-[#b85a4a]/50 bg-[#b85a4a]/15 text-[#b85a4a] hover:bg-[#b85a4a]/25"
                : "border-[#ddd0b4] text-[#8c7e66] hover:border-[#bfae8a] hover:text-[#2e2719]",
            )}
            aria-label="채팅 열기"
          >
            <ArrowUpIcon className="h-[29px] w-[29px]" />
          </button>
          <div className="relative shrink-0" aria-hidden="true">
            <div className="h-3 w-3 rounded-full bg-[#6b9a7a]" />
            <div className="absolute inset-0 h-3 w-3 animate-ping rounded-full bg-[#6b9a7a]" />
          </div>
        </div>
      </div>

      <Handle
        id="l"
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-2 !border-[#f2e9d5] !bg-[#b85a4a]"
      />
      <Handle
        id="l-s"
        type="source"
        position={Position.Left}
        className="!h-2 !w-2 !border-2 !border-[#f2e9d5] !bg-[#b85a4a]"
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-2 !border-[#f2e9d5] !bg-[#b85a4a]"
      />
      <Handle
        id="r-t"
        type="target"
        position={Position.Right}
        className="!h-2 !w-2 !border-2 !border-[#f2e9d5] !bg-[#b85a4a]"
      />
    </div>
  );
};
