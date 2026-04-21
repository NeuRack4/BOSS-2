"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KanbanColumn } from "./KanbanColumn";
import type { KanbanCardData } from "./KanbanCard";
import type { DomainKey } from "./types";

type SubHub = {
  id: string;
  title: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type BoardData = {
  sub_hubs: SubHub[];
  cards: Record<string, KanbanCardData[]>;
  unassigned: KanbanCardData[];
};

type Props = {
  accountId: string;
  domain: DomainKey;
};

export const KanbanBoard = ({ accountId, domain }: Props) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const draggingRef = useRef<{ id: string; from: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `${apiBase}/api/kanban/${domain}?account_id=${accountId}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setBoard(json?.data ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로딩 실패");
    } finally {
      setLoading(false);
    }
  }, [apiBase, accountId, domain]);

  useEffect(() => {
    load();
  }, [load]);

  const movingIdsRef = useRef<Set<string>>(new Set());

  const moveCard = useCallback(
    async (artifactId: string, fromSubHubId: string, toSubHubId: string) => {
      if (fromSubHubId === toSubHubId) return;
      if (movingIdsRef.current.has(artifactId)) return;
      movingIdsRef.current.add(artifactId);

      setBoard((prev) => {
        if (!prev) return prev;
        let card: KanbanCardData | undefined;
        const nextCards: Record<string, KanbanCardData[]> = {};
        for (const [sid, cards] of Object.entries(prev.cards)) {
          nextCards[sid] = cards.filter((c) => {
            if (c.id === artifactId) {
              card = c;
              return false;
            }
            return true;
          });
        }
        const nextUnassigned = prev.unassigned.filter((c) => {
          if (c.id === artifactId) {
            card ??= c;
            return false;
          }
          return true;
        });
        if (card && nextCards[toSubHubId]) {
          nextCards[toSubHubId] = [card, ...nextCards[toSubHubId]];
        }
        return { ...prev, cards: nextCards, unassigned: nextUnassigned };
      });

      try {
        const res = await fetch(`${apiBase}/api/kanban/move`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            artifact_id: artifactId,
            to_sub_hub_id: toSubHubId,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
      } catch {
        await load();
      } finally {
        movingIdsRef.current.delete(artifactId);
      }
    },
    [apiBase, accountId, load],
  );

  const onCardDragStart = useCallback((id: string, from: string) => {
    draggingRef.current = { id, from };
    setDraggingId(id);
  }, []);

  const onCardDragEnd = useCallback(() => {
    draggingRef.current = null;
    setDraggingId(null);
  }, []);

  const onCardDrop = useCallback(
    (toSubHubId: string) => {
      const d = draggingRef.current;
      if (!d) return;
      moveCard(d.id, d.from, toSubHubId);
    },
    [moveCard],
  );

  if (loading && !board) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-xs text-white/50">
        칸반 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[#E85D4E]/40 bg-[#E85D4E]/10 p-4 text-center text-xs text-[#E85D4E]">
        불러오지 못했어요: {error}
      </div>
    );
  }

  if (!board || board.sub_hubs.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-xs text-white/50">
        서브허브가 없어요.
      </div>
    );
  }

  return (
    <div className="relative">
      {board.unassigned.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-[11px] text-amber-200/80">
          아직 서브허브에 배정되지 않은 항목 {board.unassigned.length}개. 아래
          컬럼으로 끌어 놓아 배정하세요.
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {board.unassigned.length > 0 && (
          <KanbanColumn
            title="미분류"
            subHubId="__unassigned__"
            domain={domain}
            cards={board.unassigned}
            draggingId={draggingId}
            onCardDragStart={onCardDragStart}
            onCardDragEnd={onCardDragEnd}
            onCardDrop={onCardDrop}
          />
        )}
        {board.sub_hubs.map((h) => (
          <KanbanColumn
            key={h.id}
            title={h.title}
            subHubId={h.id}
            domain={domain}
            cards={board.cards[h.id] ?? []}
            draggingId={draggingId}
            onCardDragStart={onCardDragStart}
            onCardDragEnd={onCardDragEnd}
            onCardDrop={onCardDrop}
          />
        ))}
      </div>
    </div>
  );
};
