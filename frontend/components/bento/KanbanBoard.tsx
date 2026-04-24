"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { KanbanColumn } from "./KanbanColumn";
import type { KanbanCardData } from "./KanbanCard";
import type { DomainKey } from "./types";
import { useNodeDetail } from "@/components/detail/NodeDetailContext";
import {
  EmployeeManagingPanel,
  type EmployeeManagingHandle,
} from "@/components/employees/EmployeeManagingPanel";

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
  const managingPanelRef = useRef<EmployeeManagingHandle>(null);

  const { openDetail } = useNodeDetail();

  const handleCardClick = useCallback(
    (card: KanbanCardData) => {
      // 모든 타입(매출/비용 포함) 이 통합 NodeDetailModal 로 라우팅.
      openDetail(card.id);
    },
    [openDetail],
  );

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

  useEffect(() => {
    const handler = () => load();
    window.addEventListener("boss:artifacts-changed", handler);
    return () => window.removeEventListener("boss:artifacts-changed", handler);
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
      <div className="rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] p-8 text-center text-xs text-[color:var(--kb-fg-muted)]">
        칸반 불러오는 중...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[5px] border border-[#E85D4E]/40 bg-[#E85D4E]/10 p-4 text-center text-xs text-[#E85D4E]">
        불러오지 못했어요: {error}
      </div>
    );
  }

  if (!board || board.sub_hubs.length === 0) {
    return (
      <div className="rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] p-8 text-center text-xs text-[color:var(--kb-fg-muted)]">
        Nothing here yet
      </div>
    );
  }

  return (
    <div className="relative">
      {board.unassigned.length > 0 && (
        <div className="mb-4 rounded-[5px] border border-[color:var(--kb-warn-border)] bg-[color:var(--kb-warn-bg)] px-4 py-3 text-[11px] text-[color:var(--kb-warn-fg)]">
          아직 서브허브에 배정되지 않은 항목 {board.unassigned.length}개. 아래
          컬럼으로 끌어 놓아 배정하세요.
        </div>
      )}

      <div className="w-full overflow-x-auto pb-4">
        <div className="flex gap-3" style={{ minWidth: "max-content" }}>
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
              onCardClick={handleCardClick}
            />
          )}
          {board.sub_hubs.map((h) =>
            domain === "recruitment" && h.title === "Managing" ? (
              <div
                key={h.id}
                className="flex min-w-[260px] flex-1 flex-col rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)]"
              >
                <div className="flex items-center justify-between border-b border-[color:var(--kb-border)] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full bg-[#d4a588]"
                      aria-hidden
                    />
                    <span className="text-[13px] font-semibold tracking-tight text-[color:var(--kb-fg-strong)]">
                      Managing
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => managingPanelRef.current?.openNew()}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--kb-fg-subtle)] transition-colors hover:bg-[color:var(--kb-surface-hover)] hover:text-[color:var(--kb-fg-strong)]"
                  >
                    <Plus className="h-3 w-3" />
                    Add Employee
                  </button>
                </div>
                <div className="max-h-[600px] overflow-y-auto p-2">
                  <EmployeeManagingPanel
                    ref={managingPanelRef}
                    accountId={accountId}
                  />
                </div>
              </div>
            ) : (
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
                onCardClick={handleCardClick}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
};
