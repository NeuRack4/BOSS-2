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
  onCardClick?: (card: KanbanCardData) => void;
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
  onCardClick,
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
        "flex h-full min-w-[200px] flex-1 flex-col rounded-[5px] border bg-[color:var(--kb-surface)] transition-colors",
        "border-[color:var(--kb-border)]",
        isOver &&
          "border-[color:var(--kb-border-strong)] bg-[color:var(--kb-surface-hover)]",
      )}
    >
      <div className="flex items-center justify-between border-b border-[color:var(--kb-border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: meta.accent }}
            aria-hidden
          />
          <span className="text-[13px] font-semibold tracking-tight text-[color:var(--kb-fg-strong)]">
            {title}
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-[color:var(--kb-fg-subtle)]">
          {cards.length}
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-[5px] border border-dashed border-[color:var(--kb-border)] text-[11px] text-[color:var(--kb-fg-faint)]">
            Nothing here yet
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
              onClick={onCardClick ? () => onCardClick(c) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
};
