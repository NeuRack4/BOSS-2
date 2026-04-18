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
      <div className="anchor-ring pointer-events-none absolute inset-0 rounded-xl bg-rose-400/15" />
      <div className="anchor-ring anchor-ring-delay pointer-events-none absolute inset-0 rounded-xl bg-rose-400/15" />

      <div
        className="relative w-[720px] overflow-hidden rounded-3xl border border-rose-400/40 bg-neutral-900/95 backdrop-blur transition-all hover:shadow-lg hover:shadow-rose-500/10 nodrag nopan"
        role="article"
        aria-label="BOSS"
      >
        <div className="flex items-center gap-5 px-6 py-5">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-rose-400/40 bg-zinc-950 text-rose-400"
            aria-hidden="true"
          >
            <Sparkles className="h-8 w-8" />
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={expand}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={handleKeyDown}
            placeholder="BOSS에게 무엇이든 시켜보세요..."
            className={cn(
              "min-w-0 flex-1 bg-transparent text-lg text-zinc-100",
              "placeholder:text-zinc-500",
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
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border transition-colors",
              value.trim()
                ? "border-rose-400/60 bg-rose-400/15 text-rose-300 hover:bg-rose-400/25"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
            )}
            aria-label="채팅 열기"
          >
            <ArrowUpIcon className="h-6 w-6" />
          </button>
          <div className="relative shrink-0" aria-hidden="true">
            <div className="h-3 w-3 rounded-full bg-emerald-500" />
            <div className="absolute inset-0 h-3 w-3 animate-ping rounded-full bg-emerald-500" />
          </div>
        </div>
      </div>

      <Handle
        id="l"
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-2 !border-zinc-950 !bg-rose-400"
      />
      <Handle
        id="l-s"
        type="source"
        position={Position.Left}
        className="!h-2 !w-2 !border-2 !border-zinc-950 !bg-rose-400"
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-2 !border-zinc-950 !bg-rose-400"
      />
      <Handle
        id="r-t"
        type="target"
        position={Position.Right}
        className="!h-2 !w-2 !border-2 !border-zinc-950 !bg-rose-400"
      />
    </div>
  );
};
