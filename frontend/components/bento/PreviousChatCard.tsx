"use client";

import { ArrowUpRight } from "lucide-react";
import { useChat } from "@/components/chat/ChatContext";

type Item = {
  id: string;
  title: string;
};

type Props = {
  items?: Item[];
};

export const PreviousChatCard = ({ items }: Props) => {
  const { openChat } = useChat();
  const shown = (items ?? []).slice(0, 4);

  return (
    <button
      type="button"
      onClick={() => openChat()}
      className="group flex h-full w-full flex-col overflow-hidden rounded-[5px] bg-[#dfe6e7] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-[#030303]">
          Chat History
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-[#030303]/60">
          아직 대화 기록이 없어요
        </div>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto">
          {shown.map((it) => (
            <li
              key={it.id}
              className="rounded-lg bg-[#fcfcfc]/40 px-3 py-2 text-xs text-[#030303] transition-colors hover:bg-[#fcfcfc]/60"
            >
              · {it.title}
            </li>
          ))}
        </ul>
      )}
    </button>
  );
};
