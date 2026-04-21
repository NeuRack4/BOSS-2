"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DomainKey } from "./types";
import { DOMAIN_META } from "./types";
import { KanbanCard, type KanbanCardData } from "./KanbanCard";

type Props = {
  title: string;
  subHubId: string;
  domain: DomainKey;
  cards: KanbanCardData[];
  draggingId: string | null;
  onCardDragStart: (id: string, fromSubHubId: string) => void;
  onCardDragEnd: () => void;
  onCardDrop: (toSubHubId: string) => void;
};

export const KanbanColumn = ({
  title,
  subHubId,
  domain,
  cards,
  draggingId,
  onCardDragStart,
  onCardDragEnd,
  onCardDrop,
}: Props) => {
  const meta = DOMAIN_META[domain];
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!isOver) setIsOver(true);
      }}
      onDragLeave={(e) => {
        if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))
          return;
        setIsOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        if (draggingId) onCardDrop(subHubId);
      }}
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] transition-colors",
        isOver && "border-white/30 bg-white/[0.06]",
      )}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: meta.accent }}
            aria-hidden
          />
          <span className="text-[13px] font-semibold tracking-tight text-white/90">
            {title}
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-white/40">
          {cards.length}
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-white/10 text-[11px] text-white/30">
            비어있음
          </div>
        ) : (
          cards.map((c) => (
            <KanbanCard
              key={c.id}
              card={c}
              domain={domain}
              dragging={draggingId === c.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", c.id);
                onCardDragStart(c.id, subHubId);
              }}
              onDragEnd={onCardDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
};
