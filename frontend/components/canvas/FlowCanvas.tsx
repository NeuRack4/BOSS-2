"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  useViewport,
  addEdge,
  Connection,
  NodeTypes,
  type Node,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import { AnchorNode } from "./AnchorNode";
import { DomainNode } from "./DomainNode";
import { ArtifactChipNode } from "./ArtifactChipNode";
import { updateStoredPosition } from "./layout";
import { NodeContextMenu, type MenuItem } from "./NodeContextMenu";
import { ScheduleModal } from "./modals/ScheduleModal";
import { HistoryModal } from "./modals/HistoryModal";
import { SummaryModal } from "./modals/SummaryModal";
import { LogDetailModal } from "./modals/LogDetailModal";
import { ConfirmModal } from "./modals/ConfirmModal";
import { useChat } from "@/components/chat/ChatContext";
import { useFilter } from "./FilterContext";
import { createClient } from "@/lib/supabase/client";

type Domain = "recruitment" | "marketing" | "sales" | "documents";
type Kind = "anchor" | "domain" | "artifact" | "schedule" | "log";
type Relation =
  | "contains"
  | "derives_from"
  | "scheduled_by"
  | "revises"
  | "logged_from";

type ArtifactRow = {
  id: string;
  domains: Domain[] | null;
  kind: Kind;
  type: string;
  title: string;
  content: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

const DIM_OPACITY = 0.15;

const isNodeVisible = (
  data: {
    kind: Kind;
    type?: string;
    domains?: Domain[] | null;
    created_at?: string;
  },
  timeRangeDays: number | null,
  selectedDomains: Set<Domain>,
): boolean => {
  if (data.kind === "anchor") return true;
  const domains = data.domains ?? [];
  const domainOk =
    domains.length === 0 || domains.some((d) => selectedDomains.has(d));
  if (data.kind === "domain") return domainOk;
  if (data.type === "archive") return domainOk;
  if (!domainOk) return false;
  if (timeRangeDays === null) return true;
  if (!data.created_at) return true;
  const created = new Date(data.created_at).getTime();
  return created >= Date.now() - timeRangeDays * 86_400_000;
};

type EdgeRow = {
  id: string;
  parent_id: string;
  child_id: string;
  relation: Relation;
};

const NODE_SIZE: Record<
  "anchor" | "domain" | "chip" | "chip_schedule",
  { w: number; h: number }
> = {
  anchor: { w: 720, h: 144 },
  domain: { w: 220, h: 52 },
  chip: { w: 180, h: 36 },
  chip_schedule: { w: 180, h: 58 },
};

const sizeFor = (kind: Kind): { w: number; h: number } =>
  kind === "anchor"
    ? NODE_SIZE.anchor
    : kind === "domain"
      ? NODE_SIZE.domain
      : kind === "schedule"
        ? NODE_SIZE.chip_schedule
        : NODE_SIZE.chip;

const flowTypeFor = (kind: Kind) =>
  kind === "anchor" ? "anchor" : kind === "domain" ? "domain" : "chip";

const QUADRANT_HUB_OFFSET = 215;
const OUTWARD_GAP = 30;

type QuadrantConfig = { rankdir: "LR" | "RL"; sign_x: 1 | -1; sign_y: 1 | -1 };

const QUADRANT_BY_DOMAIN: Record<Domain, QuadrantConfig> = {
  recruitment: { rankdir: "RL", sign_x: -1, sign_y: -1 }, // TL
  marketing: { rankdir: "LR", sign_x: +1, sign_y: -1 }, // TR
  documents: { rankdir: "RL", sign_x: -1, sign_y: +1 }, // BL
  sales: { rankdir: "LR", sign_x: +1, sign_y: +1 }, // BR
};

const layoutSubtree = (
  hub: ArtifactRow,
  subArtifacts: ArtifactRow[],
  subEdges: EdgeRow[],
  config: QuadrantConfig,
  positions: Record<string, { x: number; y: number }>,
) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: config.rankdir,
    nodesep: 24,
    ranksep: 90,
    marginx: 10,
    marginy: 10,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const a of subArtifacts) {
    const { w, h } = sizeFor(a.kind);
    g.setNode(a.id, { width: w, height: h });
  }
  for (const e of subEdges) {
    if (g.hasNode(e.parent_id) && g.hasNode(e.child_id)) {
      g.setEdge(e.parent_id, e.child_id);
    }
  }
  dagre.layout(g);

  const hubNode = g.node(hub.id);
  if (!hubNode) return;

  const hubTargetX = config.sign_x * QUADRANT_HUB_OFFSET;
  const hubTargetY = config.sign_y * QUADRANT_HUB_OFFSET;

  const deltaX = hubTargetX - hubNode.x;
  const hubDeltaY = hubTargetY - hubNode.y;

  // Push children outward vertically so they don't straddle hub's y axis
  let childMinY = Infinity;
  let childMaxY = -Infinity;
  for (const a of subArtifacts) {
    if (a.id === hub.id) continue;
    const n = g.node(a.id);
    const { h } = sizeFor(a.kind);
    childMinY = Math.min(childMinY, n.y - h / 2);
    childMaxY = Math.max(childMaxY, n.y + h / 2);
  }

  let childDeltaY = hubDeltaY;
  if (Number.isFinite(childMinY) && Number.isFinite(childMaxY)) {
    const hubHalfH = sizeFor(hub.kind).h / 2;
    if (config.sign_y < 0) {
      // Top quadrants: children's bottom edge must stay above hub's top edge
      const cap = hubTargetY - hubHalfH - OUTWARD_GAP - childMaxY;
      if (childDeltaY > cap) childDeltaY = cap;
    } else {
      // Bottom quadrants: children's top edge must stay below hub's bottom edge
      const floor = hubTargetY + hubHalfH + OUTWARD_GAP - childMinY;
      if (childDeltaY < floor) childDeltaY = floor;
    }
  }

  for (const a of subArtifacts) {
    const n = g.node(a.id);
    const { w, h } = sizeFor(a.kind);
    const meta = a.metadata as Record<string, unknown> | null;
    const pinned = meta?.pinned;
    const stored = meta?.position as { x?: number; y?: number } | undefined;
    if (
      pinned &&
      stored &&
      typeof stored.x === "number" &&
      typeof stored.y === "number"
    ) {
      positions[a.id] = { x: stored.x, y: stored.y };
    } else {
      const dy = a.id === hub.id ? hubDeltaY : childDeltaY;
      positions[a.id] = {
        x: n.x + deltaX - w / 2,
        y: n.y + dy - h / 2,
      };
    }
  }
};

const computePositions = (
  artifacts: ArtifactRow[],
  edges: EdgeRow[],
): Record<string, { x: number; y: number }> => {
  const positions: Record<string, { x: number; y: number }> = {};

  const anchor = artifacts.find((a) => a.kind === "anchor");
  if (anchor) {
    const { w, h } = sizeFor(anchor.kind);
    positions[anchor.id] = { x: -w / 2, y: -h / 2 };
  }

  const mainHubs = artifacts.filter(
    (a) => a.kind === "domain" && a.type !== "category",
  );

  for (const hub of mainHubs) {
    const hubDomain = hub.domains?.[0] as Domain | undefined;
    if (!hubDomain) continue;
    const config = QUADRANT_BY_DOMAIN[hubDomain];
    if (!config) continue;

    const subtreeIds = new Set<string>([hub.id]);
    const queue: string[] = [hub.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const e of edges) {
        if (e.parent_id === id && !subtreeIds.has(e.child_id)) {
          subtreeIds.add(e.child_id);
          queue.push(e.child_id);
        }
      }
    }

    const subArtifacts = artifacts.filter((a) => subtreeIds.has(a.id));
    const subEdges = edges.filter(
      (e) => subtreeIds.has(e.parent_id) && subtreeIds.has(e.child_id),
    );
    layoutSubtree(hub, subArtifacts, subEdges, config, positions);
  }

  for (const a of artifacts) {
    if (!positions[a.id]) positions[a.id] = { x: 0, y: 0 };
  }

  return positions;
};

const latestArtifactPerDomain = (
  artifacts: ArtifactRow[],
  edges: EdgeRow[],
  domainNodeId: string,
): ArtifactRow | null => {
  const childIds = new Set(
    edges
      .filter((e) => e.parent_id === domainNodeId && e.relation === "contains")
      .map((e) => e.child_id),
  );
  const children = artifacts.filter(
    (a) => childIds.has(a.id) && a.kind === "artifact",
  );
  return children[0] ?? null;
};

const RELATION_STYLE: Record<Relation, React.CSSProperties> = {
  contains: {
    stroke: "#71717a",
    strokeDasharray: "8 6",
    opacity: 0.5,
    strokeWidth: 1.5,
  },
  derives_from: {
    stroke: "#71717a",
    strokeDasharray: "8 6",
    opacity: 0.45,
    strokeWidth: 1,
  },
  scheduled_by: {
    stroke: "#f59e0b",
    strokeDasharray: "4 4",
    opacity: 0.6,
    strokeWidth: 1.2,
  },
  revises: {
    stroke: "#ec4899",
    strokeDasharray: "6 4",
    opacity: 0.6,
    strokeWidth: 1.2,
  },
  logged_from: {
    stroke: "#10b981",
    strokeDasharray: "2 4",
    opacity: 0.6,
    strokeWidth: 1,
  },
};

const nodeTypes: NodeTypes = {
  anchor: AnchorNode,
  domain: DomainNode,
  chip: ArtifactChipNode,
};

const CrosshairOverlay = () => {
  const { x, y, zoom } = useViewport();
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 0 }}
    >
      <g transform={`translate(${x}, ${y}) scale(${zoom})`}>
        <line
          x1={-10000}
          y1={0}
          x2={10000}
          y2={0}
          stroke="#52525b"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={0.4}
        />
        <line
          x1={0}
          y1={-10000}
          x2={0}
          y2={10000}
          stroke="#52525b"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={0.4}
        />
      </g>
    </svg>
  );
};

type MenuState = {
  x: number;
  y: number;
  nodeId: string;
  kind: Kind;
  data: ArtifactRow;
} | null;

type ModalState =
  | { type: "none" }
  | { type: "schedule-create"; artifactId: string; title: string }
  | { type: "schedule-edit"; artifactId: string; title: string; cron: string }
  | { type: "history"; artifactId: string; title: string }
  | { type: "summary"; scope: "all" | Domain; title: string }
  | {
      type: "log-detail";
      title: string;
      content: string;
      metadata: Record<string, unknown>;
    }
  | { type: "confirm-delete"; artifactId: string; title: string };

export const FlowCanvas = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<MenuState>(null);
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { send: sendChat } = useChat();
  const { timeRangeDays, selectedDomains, showArchive } = useFilter();
  const filterRef = useRef({ timeRangeDays, selectedDomains });
  useEffect(() => {
    filterRef.current = { timeRangeDays, selectedDomains };
  }, [timeRangeDays, selectedDomains]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  // Persist node positions on drag
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      for (const ch of changes) {
        if (ch.type === "position" && !ch.dragging && ch.position) {
          const node = nodes.find((n) => n.id === ch.id);
          if (!node) continue;
          const data = node.data as unknown as { kind?: Kind; type?: string };
          if (data?.kind === "anchor") continue;
          const kind = (data?.kind ?? "artifact") as Kind;
          const { w, h } = sizeFor(kind);
          updateStoredPosition(ch.id, {
            x: ch.position.x + w / 2,
            y: ch.position.y + h / 2,
          });
        }
      }
    },
    [nodes, onNodesChange],
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    const load = async () => {
      const [artifactsRes, edgesRes, evalsRes] = await Promise.all([
        supabase
          .from("artifacts")
          .select(
            "id,domains,kind,type,title,content,status,metadata,created_at",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("artifact_edges")
          .select("id,parent_id,child_id,relation"),
        supabase.from("evaluations").select("artifact_id,rating,feedback"),
      ]);
      if (cancelled) return;

      const allArtifacts = (artifactsRes.data ?? []) as ArtifactRow[];
      const allEdges = (edgesRes.data ?? []) as EdgeRow[];
      const evals = (evalsRes.data ?? []) as Array<{
        artifact_id: string;
        rating: "up" | "down";
        feedback: string;
      }>;

      // Hide children of archive nodes when showArchive is off
      let artifacts = allArtifacts;
      let edgeRows = allEdges;
      if (!showArchive) {
        const archiveIds = new Set(
          allArtifacts.filter((a) => a.type === "archive").map((a) => a.id),
        );
        const hidden = new Set<string>();
        for (const e of allEdges) {
          if (archiveIds.has(e.parent_id) && e.relation === "contains") {
            hidden.add(e.child_id);
          }
        }
        if (hidden.size > 0) {
          artifacts = allArtifacts.filter((a) => !hidden.has(a.id));
          edgeRows = allEdges.filter(
            (e) => !hidden.has(e.parent_id) && !hidden.has(e.child_id),
          );
        }
      }

      if (artifacts.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
      }

      const positions = computePositions(artifacts, edgeRows);

      const domainStats: Record<
        string,
        { count: number; latest: ArtifactRow | null }
      > = {};
      for (const a of artifacts.filter((x) => x.kind === "domain")) {
        const childIds = edgeRows
          .filter((e) => e.parent_id === a.id && e.relation === "contains")
          .map((e) => e.child_id);
        const children = artifacts.filter(
          (x) => childIds.includes(x.id) && x.kind === "artifact",
        );
        domainStats[a.id] = {
          count: children.length,
          latest: latestArtifactPerDomain(artifacts, edgeRows, a.id),
        };
      }

      const evalMap = new Map(evals.map((e) => [e.artifact_id, e]));
      const childByParent = new Map<string, string[]>();
      for (const e of edgeRows) {
        const arr = childByParent.get(e.parent_id) ?? [];
        arr.push(e.child_id);
        childByParent.set(e.parent_id, arr);
      }
      const kindById = new Map(artifacts.map((a) => [a.id, a.kind]));
      const hasLogDescendant = (rootId: string): boolean => {
        const stack = [rootId];
        const seen = new Set<string>();
        while (stack.length) {
          const id = stack.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          for (const child of childByParent.get(id) ?? []) {
            if (kindById.get(child) === "log") return true;
            stack.push(child);
          }
        }
        return false;
      };

      const { timeRangeDays: tr, selectedDomains: sd } = filterRef.current;
      const nodeOpacity = new Map<string, number>();
      const next: Node[] = artifacts.map((a) => {
        const ev = evalMap.get(a.id);
        const isExecuted = a.kind === "log" || hasLogDescendant(a.id);
        const pinned = !!(a.metadata as Record<string, unknown>)?.pinned;
        const visible = isNodeVisible(a, tr, sd);
        const opacity = visible ? 1 : DIM_OPACITY;
        nodeOpacity.set(a.id, opacity);
        const isLocked = a.kind === "anchor" || a.kind === "domain";
        return {
          id: a.id,
          type: flowTypeFor(a.kind),
          position: positions[a.id],
          draggable: !isLocked && !pinned,
          style: { opacity },
          data: {
            ...a,
            ...(a.kind === "domain" ? domainStats[a.id] : {}),
            isExecuted,
            isEvaluated: !!ev,
            currentRating: ev?.rating ?? null,
            currentFeedback: ev?.feedback ?? "",
            pinned,
          },
        };
      });

      const anchorId = artifacts.find((a) => a.kind === "anchor")?.id;
      const artifactById = new Map(artifacts.map((a) => [a.id, a]));
      const LEFT_DOMAINS: ReadonlySet<string> = new Set([
        "recruitment",
        "documents",
      ]);
      const isSourceInLeftQuadrant = (parentId: string) => {
        const a = artifactById.get(parentId);
        const primary = a?.domains?.[0];
        return !!primary && LEFT_DOMAINS.has(primary);
      };

      const flowEdges: Edge[] = edgeRows
        .filter((e) => e.parent_id !== anchorId)
        .map((e) => {
          const src = nodeOpacity.get(e.parent_id) ?? 1;
          const tgt = nodeOpacity.get(e.child_id) ?? 1;
          const factor = Math.min(src, tgt);
          const base = RELATION_STYLE[e.relation];
          const leftSide = isSourceInLeftQuadrant(e.parent_id);
          return {
            id: e.id,
            source: e.parent_id,
            sourceHandle: leftSide ? "l-s" : "r",
            target: e.child_id,
            targetHandle: leftSide ? "r-t" : "l",
            type: "default",
            animated: false,
            style: {
              ...base,
              opacity: ((base.opacity as number) ?? 1) * factor,
            } as React.CSSProperties,
            data: { relation: e.relation },
          };
        });

      setNodes(next);
      setEdges(flowEdges);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [setNodes, setEdges, refreshKey, showArchive]);

  // Filter + hover reactivity: re-apply opacity when filter or hover changes (no refetch)
  useEffect(() => {
    const nodeOp = new Map<string, number>();
    setNodes((ns) =>
      ns.map((n) => {
        const data = n.data as unknown as {
          kind: Kind;
          type?: string;
          domains?: Domain[] | null;
          created_at?: string;
        };
        const visible = isNodeVisible(data, timeRangeDays, selectedDomains);
        const op = visible ? 1 : DIM_OPACITY;
        nodeOp.set(n.id, op);
        return { ...n, style: { ...(n.style ?? {}), opacity: op } };
      }),
    );
    setEdges((es) =>
      es.map((e) => {
        const src = nodeOp.get(e.source) ?? 1;
        const tgt = nodeOp.get(e.target) ?? 1;
        const visibilityFactor = Math.min(src, tgt);
        const relation = (e.data as { relation?: Relation } | undefined)
          ?.relation;
        const base = relation ? RELATION_STYLE[relation] : {};
        const baseOpacity = (base.opacity as number) ?? 1;
        // Hover: edges touching hovered node are full, others faded
        const isIncident =
          hoveredId !== null &&
          (e.source === hoveredId || e.target === hoveredId);
        // Default visible; hovered node's incident edges stay bright, others dim
        const hoverFactor = hoveredId === null ? 1 : isIncident ? 1 : 0.08;
        const strokeWidth = isIncident
          ? ((base.strokeWidth as number) ?? 1) + 1
          : ((base.strokeWidth as number) ?? 1);
        return {
          ...e,
          style: {
            ...base,
            strokeWidth,
            opacity: baseOpacity * visibilityFactor * hoverFactor,
          } as React.CSSProperties,
        };
      }),
    );
  }, [timeRangeDays, selectedDomains, hoveredId, setNodes, setEdges]);

  const getAccountId = useCallback(async (): Promise<string | null> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  }, []);

  const handleDelete = useCallback(
    async (artifactId: string) => {
      const accountId = await getAccountId();
      if (!accountId) return;
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/artifacts/${artifactId}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        },
      );
      reload();
    },
    [getAccountId, reload],
  );

  const handlePin = useCallback(
    async (artifactId: string, pinned: boolean) => {
      const accountId = await getAccountId();
      if (!accountId) return;
      const node = nodes.find((n) => n.id === artifactId);
      const position = pinned && node ? node.position : undefined;
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/artifacts/${artifactId}/pin`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: accountId,
            pinned,
            position: position ? { x: position.x, y: position.y } : null,
          }),
        },
      );
      setNodes((ns) =>
        ns.map((n) =>
          n.id === artifactId
            ? { ...n, draggable: !pinned, data: { ...n.data, pinned } }
            : n,
        ),
      );
    },
    [getAccountId, nodes, setNodes],
  );

  const handleCreateSchedule = useCallback(
    async (parentId: string, cron: string) => {
      const accountId = await getAccountId();
      if (!accountId) return;
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          artifact_id: parentId,
          cron,
        }),
      });
      reload();
    },
    [getAccountId, reload],
  );

  const handleUpdateSchedule = useCallback(
    async (artifactId: string, cron: string) => {
      const accountId = await getAccountId();
      if (!accountId) return;
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/schedules/${artifactId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId, cron }),
        },
      );
      reload();
    },
    [getAccountId, reload],
  );

  const handleRunNow = useCallback(
    async (artifactId: string) => {
      const accountId = await getAccountId();
      if (!accountId) return;
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/schedules/${artifactId}/run-now`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        },
      );
      reload();
    },
    [getAccountId, reload],
  );

  const handleReuse = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      sendChat(content);
    },
    [sendChat],
  );

  const handleOpenEvaluate = useCallback((artifactId: string) => {
    window.dispatchEvent(
      new CustomEvent("boss:open-evaluate", { detail: { id: artifactId } }),
    );
  }, []);

  const buildMenuItems = useCallback(
    (state: NonNullable<MenuState>): MenuItem[] => {
      const { kind, nodeId, data } = state;
      const closeMenu = () => setMenu(null);
      const pinned = !!(data.metadata as Record<string, unknown>)?.pinned;
      const pinLabel = pinned ? "핀 해제" : "핀 고정 (위치 저장)";
      const pinItem: MenuItem = {
        key: "pin",
        label: pinLabel,
        onClick: () => {
          handlePin(nodeId, !pinned);
          closeMenu();
        },
      };

      if (kind === "anchor") {
        return [
          {
            key: "summary",
            label: "활동 이력 + 현재 상황 요약",
            onClick: () =>
              setModal({
                type: "summary",
                scope: "all",
                title: "전체 상황 요약",
              }),
          },
          pinItem,
        ];
      }

      if (kind === "domain") {
        const domain = (data.domains?.[0] ?? "recruitment") as Domain;
        return [
          {
            key: "summary",
            label: "활동 이력 + 현재 상황 요약",
            onClick: () =>
              setModal({
                type: "summary",
                scope: domain,
                title: `${domain} 요약`,
              }),
          },
          pinItem,
        ];
      }

      if (kind === "artifact") {
        return [
          {
            key: "reuse",
            label: "재사용하기 (채팅에 주입)",
            onClick: () => handleReuse(data.content || data.title),
          },
          {
            key: "schedule",
            label: "스케줄 생성하기",
            onClick: () =>
              setModal({
                type: "schedule-create",
                artifactId: nodeId,
                title: data.title,
              }),
          },
          {
            key: "evaluate",
            label: "다시 평가하기",
            onClick: () => handleOpenEvaluate(nodeId),
          },
          pinItem,
          {
            key: "delete",
            label: "노드 삭제하기",
            destructive: true,
            onClick: () =>
              setModal({
                type: "confirm-delete",
                artifactId: nodeId,
                title: data.title,
              }),
          },
        ];
      }

      if (kind === "schedule") {
        const cron = (data.metadata as Record<string, unknown>)?.cron as
          | string
          | undefined;
        return [
          {
            key: "run",
            label: "지금 실행하기",
            onClick: () => handleRunNow(nodeId),
          },
          {
            key: "edit",
            label: "일정 편집",
            onClick: () =>
              setModal({
                type: "schedule-edit",
                artifactId: nodeId,
                title: data.title,
                cron: cron || "0 9 * * *",
              }),
          },
          {
            key: "history",
            label: "실행 이력 보기",
            onClick: () =>
              setModal({
                type: "history",
                artifactId: nodeId,
                title: data.title,
              }),
          },
          {
            key: "evaluate",
            label: "다시 평가하기",
            onClick: () => handleOpenEvaluate(nodeId),
          },
          pinItem,
          {
            key: "delete",
            label: "스케줄 삭제하기",
            destructive: true,
            onClick: () =>
              setModal({
                type: "confirm-delete",
                artifactId: nodeId,
                title: data.title,
              }),
          },
        ];
      }

      // log
      return [
        {
          key: "detail",
          label: "자세히 보기",
          onClick: () =>
            setModal({
              type: "log-detail",
              title: data.title,
              content: data.content,
              metadata: data.metadata,
            }),
        },
        pinItem,
        {
          key: "delete",
          label: "노드 삭제하기",
          destructive: true,
          onClick: () =>
            setModal({
              type: "confirm-delete",
              artifactId: nodeId,
              title: data.title,
            }),
        },
      ];
    },
    [handlePin, handleReuse, handleOpenEvaluate, handleRunNow],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const data = node.data as unknown as ArtifactRow;
      const kind = (data.kind || "artifact") as Kind;
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: node.id,
        kind,
        data,
      });
    },
    [],
  );

  const menuItems = useMemo(
    () => (menu ? buildMenuItems(menu) : []),
    [menu, buildMenuItems],
  );

  return (
    <div className="relative flex-1 h-full overflow-hidden bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        colorMode="dark"
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#3f3f46"
          className="opacity-60"
        />
        <CrosshairOverlay />
      </ReactFlow>

      {menu && (
        <NodeContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}

      {modal.type === "schedule-create" && (
        <ScheduleModal
          open
          mode="create"
          title={`스케줄 만들기: ${modal.title}`}
          onClose={() => setModal({ type: "none" })}
          onSubmit={(cron) => handleCreateSchedule(modal.artifactId, cron)}
        />
      )}
      {modal.type === "schedule-edit" && (
        <ScheduleModal
          open
          mode="edit"
          initialCron={modal.cron}
          title={`일정 편집: ${modal.title}`}
          onClose={() => setModal({ type: "none" })}
          onSubmit={(cron) => handleUpdateSchedule(modal.artifactId, cron)}
        />
      )}
      {modal.type === "history" && (
        <HistoryModal
          open
          artifactId={modal.artifactId}
          title={modal.title}
          onClose={() => setModal({ type: "none" })}
        />
      )}
      {modal.type === "summary" && (
        <SummaryModal
          open
          scope={modal.scope}
          title={modal.title}
          onClose={() => setModal({ type: "none" })}
        />
      )}
      {modal.type === "log-detail" && (
        <LogDetailModal
          open
          title={modal.title}
          content={modal.content}
          metadata={modal.metadata}
          onClose={() => setModal({ type: "none" })}
        />
      )}
      {modal.type === "confirm-delete" && (
        <ConfirmModal
          open
          title="노드 삭제"
          message={`"${modal.title}" 노드를 삭제할까요?\n자식 노드가 있으면 부모와 자동으로 다시 연결됩니다.`}
          confirmLabel="삭제"
          destructive
          onClose={() => setModal({ type: "none" })}
          onConfirm={() => handleDelete(modal.artifactId)}
        />
      )}
    </div>
  );
};
