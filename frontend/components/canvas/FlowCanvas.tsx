"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
  type Node,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AnchorNode } from "./AnchorNode";
import { DomainNode } from "./DomainNode";
import { ArtifactChipNode } from "./ArtifactChipNode";
import { NebulaBackground } from "./NebulaBackground";
import { HoverInfoPanel } from "./HoverInfoPanel";
import { clearStoredPositions, updateStoredPosition } from "./layout";
import { NodeContextMenu, type MenuItem } from "./NodeContextMenu";
import { ScheduleModal } from "./modals/ScheduleModal";
import { HistoryModal } from "./modals/HistoryModal";
import { SummaryModal } from "./modals/SummaryModal";
import { LogDetailModal } from "./modals/LogDetailModal";
import { ConfirmModal } from "./modals/ConfirmModal";
import { DateRangeModal, type DateRangeValue } from "./modals/DateRangeModal";
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
  anchor: { w: 872, h: 176 },
  domain: { w: 266, h: 64 },
  chip: { w: 218, h: 44 },
  chip_schedule: { w: 218, h: 70 },
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

type QuadrantConfig = { sign_x: 1 | -1; sign_y: 1 | -1 };

const QUADRANT_BY_DOMAIN: Record<Domain, QuadrantConfig> = {
  recruitment: { sign_x: -1, sign_y: -1 }, // TL
  marketing: { sign_x: +1, sign_y: -1 }, // TR
  documents: { sign_x: -1, sign_y: +1 }, // BL
  sales: { sign_x: +1, sign_y: +1 }, // BR
};

// Radial "planetary orbit" layout constants
const RADIAL_BASE_RADIUS = 900; // hub → first-gen children
const RADIAL_DECAY = 0.82; // multiplier per deeper generation
const RADIAL_MIN_RADIUS = 320; // floor so deep descendants don't collapse
// Minimum angular spread each parent gives its children, so leaf-heavy parents
// can fan their artifacts wide even if their own slice was narrow.
const RADIAL_SPREAD_FLOOR = Math.PI * 0.7; // ~126°
const COLLISION_ITERS = 320;
const COLLISION_PAD = 110;

const layoutRadial = (
  hub: ArtifactRow,
  subArtifacts: ArtifactRow[],
  subEdges: EdgeRow[],
  config: QuadrantConfig,
  positions: Record<string, { x: number; y: number }>,
) => {
  const hubCX = config.sign_x * QUADRANT_HUB_OFFSET;
  const hubCY = config.sign_y * QUADRANT_HUB_OFFSET;
  const { w: hubW, h: hubH } = sizeFor(hub.kind);
  positions[hub.id] = { x: hubCX - hubW / 2, y: hubCY - hubH / 2 };

  const childMap = new Map<string, string[]>();
  for (const e of subEdges) {
    const arr = childMap.get(e.parent_id) ?? [];
    arr.push(e.child_id);
    childMap.set(e.parent_id, arr);
  }
  const byId = new Map(subArtifacts.map((a) => [a.id, a]));

  // Subtree weight (self + descendants) for proportional angular slice
  const weight = new Map<string, number>();
  const computeWeight = (id: string): number => {
    const cached = weight.get(id);
    if (cached !== undefined) return cached;
    const kids = childMap.get(id) ?? [];
    let w = 1;
    for (const c of kids) w += computeWeight(c);
    weight.set(id, w);
    return w;
  };
  computeWeight(hub.id);

  const place = (
    parentId: string,
    parentCX: number,
    parentCY: number,
    centerAngle: number,
    spread: number,
    radius: number,
  ): void => {
    const kids = childMap.get(parentId) ?? [];
    if (kids.length === 0) return;

    const totalW = kids.reduce((acc, c) => acc + (weight.get(c) ?? 1), 0) || 1;

    let cursor = centerAngle - spread / 2;
    for (const id of kids) {
      const art = byId.get(id);
      if (!art) continue;
      const slice = ((weight.get(id) ?? 1) / totalW) * spread;
      const angle = cursor + slice / 2;
      cursor += slice;

      const cx = parentCX + radius * Math.cos(angle);
      const cy = parentCY + radius * Math.sin(angle);
      const { w, h } = sizeFor(art.kind);

      const meta = art.metadata as Record<string, unknown> | null;
      const pinned = meta?.pinned;
      const stored = meta?.position as { x?: number; y?: number } | undefined;
      if (
        pinned &&
        stored &&
        typeof stored.x === "number" &&
        typeof stored.y === "number"
      ) {
        positions[id] = { x: stored.x, y: stored.y };
      } else {
        positions[id] = { x: cx - w / 2, y: cy - h / 2 };
      }

      const nextRadius = Math.max(radius * RADIAL_DECAY, RADIAL_MIN_RADIUS);
      // Allow deep descendants more breathing room than the parent's slice,
      // so leaf-heavy artifact clusters fan out instead of piling up.
      const nextSpread = Math.max(slice, RADIAL_SPREAD_FLOOR);
      place(id, cx, cy, angle, nextSpread, nextRadius);
    }
  };

  // Main hub: keep children within their quadrant (180° outward cone).
  // Deeper generations recurse inside their own slice — sub-clusters stay in-domain.
  const outwardAngle = Math.atan2(config.sign_y, config.sign_x);
  place(hub.id, hubCX, hubCY, outwardAngle, Math.PI, RADIAL_BASE_RADIUS);
};

const relaxCollisions = (
  artifacts: ArtifactRow[],
  positions: Record<string, { x: number; y: number }>,
  fixedIds: Set<string>,
) => {
  const entries = artifacts.filter((a) => positions[a.id]);
  const sizes = new Map(entries.map((a) => [a.id, sizeFor(a.kind)]));

  for (let iter = 0; iter < COLLISION_ITERS; iter++) {
    let moved = false;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i].id;
        const b = entries[j].id;
        const pa = positions[a];
        const pb = positions[b];
        const sa = sizes.get(a)!;
        const sb = sizes.get(b)!;
        const ax = pa.x + sa.w / 2;
        const ay = pa.y + sa.h / 2;
        const bx = pb.x + sb.w / 2;
        const by = pb.y + sb.h / 2;
        const dx = bx - ax;
        const dy = by - ay;
        const minX = (sa.w + sb.w) / 2 + COLLISION_PAD;
        const minY = (sa.h + sb.h) / 2 + COLLISION_PAD;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        let pushX = 0;
        let pushY = 0;
        if (overlapX < overlapY) {
          pushX = (overlapX / 2) * (dx < 0 ? 1 : -1);
        } else {
          pushY = (overlapY / 2) * (dy < 0 ? 1 : -1);
        }
        const aFixed = fixedIds.has(a);
        const bFixed = fixedIds.has(b);
        if (!aFixed && !bFixed) {
          pa.x += pushX;
          pa.y += pushY;
          pb.x -= pushX;
          pb.y -= pushY;
        } else if (!aFixed) {
          pa.x += pushX * 2;
          pa.y += pushY * 2;
        } else if (!bFixed) {
          pb.x -= pushX * 2;
          pb.y -= pushY * 2;
        } else {
          continue;
        }
        moved = true;
      }
    }
    if (!moved) break;
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
    layoutRadial(hub, subArtifacts, subEdges, config, positions);
  }

  for (const a of artifacts) {
    if (!positions[a.id]) positions[a.id] = { x: 0, y: 0 };
  }

  // Force-relax overlaps. Anchor + main hubs stay pinned.
  const fixedIds = new Set<string>();
  if (anchor) fixedIds.add(anchor.id);
  for (const h of mainHubs) fixedIds.add(h.id);
  relaxCollisions(artifacts, positions, fixedIds);

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
    stroke: "#5a5040",
    strokeDasharray: "8 6",
    opacity: 0.75,
    strokeWidth: 1.8,
  },
  derives_from: {
    stroke: "#5a5040",
    strokeDasharray: "8 6",
    opacity: 0.65,
    strokeWidth: 1.3,
  },
  scheduled_by: {
    stroke: "#a87620",
    strokeDasharray: "4 4",
    opacity: 0.9,
    strokeWidth: 1.5,
  },
  revises: {
    stroke: "#764463",
    strokeDasharray: "6 4",
    opacity: 0.9,
    strokeWidth: 1.5,
  },
  logged_from: {
    stroke: "#6a7843",
    strokeDasharray: "2 4",
    opacity: 0.9,
    strokeWidth: 1.3,
  },
};

const nodeTypes: NodeTypes = {
  anchor: AnchorNode,
  domain: DomainNode,
  chip: ArtifactChipNode,
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
  | { type: "confirm-delete"; artifactId: string; title: string }
  | {
      type: "date-range";
      artifactId: string;
      title: string;
      initial: DateRangeValue;
    };

export const FlowCanvas = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<MenuState>(null);
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [stickyHoveredId, setStickyHoveredId] = useState<string | null>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const nodeOpRef = useRef<Map<string, number>>(new Map());
  const { send: sendChat } = useChat();
  const { timeRangeDays, selectedDomains, showArchive } = useFilter();
  const filterRef = useRef({ timeRangeDays, selectedDomains });
  useEffect(() => {
    filterRef.current = { timeRangeDays, selectedDomains };
  }, [timeRangeDays, selectedDomains]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const resetLayout = useCallback(() => {
    clearStoredPositions();
    setRefreshKey((k) => k + 1);
    flowRef.current?.setCenter(0, 0, { zoom: 1.2, duration: 300 });
  }, []);

  useEffect(() => {
    const handler = () => resetLayout();
    window.addEventListener("boss:reset-layout", handler);
    return () => window.removeEventListener("boss:reset-layout", handler);
  }, [resetLayout]);

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

      const fetchedArtifacts = (artifactsRes.data ?? []) as ArtifactRow[];
      const fetchedEdges = (edgesRes.data ?? []) as EdgeRow[];
      const evals = (evalsRes.data ?? []) as Array<{
        artifact_id: string;
        rating: "up" | "down";
        feedback: string;
      }>;

      // 1) Log 24h rolling window — drop logs older than 24h
      const logCutoff = Date.now() - 24 * 60 * 60 * 1000;
      const droppedLogIds = new Set<string>();
      for (const a of fetchedArtifacts) {
        if (a.kind === "log" && new Date(a.created_at).getTime() < logCutoff) {
          droppedLogIds.add(a.id);
        }
      }
      let allArtifacts =
        droppedLogIds.size > 0
          ? fetchedArtifacts.filter((a) => !droppedLogIds.has(a.id))
          : fetchedArtifacts;
      let allEdges =
        droppedLogIds.size > 0
          ? fetchedEdges.filter(
              (e) =>
                !droppedLogIds.has(e.parent_id) &&
                !droppedLogIds.has(e.child_id),
            )
          : fetchedEdges;

      // 2) 100-cap on kind='artifact' (schedule-linked + already-archived exempt)
      //    Overflow moves to the matching sub-domain archive via contains edge.
      const VISIBLE_ARTIFACT_CAP = 60;
      const archiveNodeIds = new Set(
        allArtifacts.filter((a) => a.type === "archive").map((a) => a.id),
      );
      const alreadyArchived = new Set<string>();
      for (const e of allEdges) {
        if (archiveNodeIds.has(e.parent_id) && e.relation === "contains") {
          alreadyArchived.add(e.child_id);
        }
      }
      const scheduleIds = new Set(
        allArtifacts.filter((a) => a.kind === "schedule").map((a) => a.id),
      );
      const artifactsWithSchedule = new Set<string>();
      for (const e of allEdges) {
        if (e.relation !== "scheduled_by") continue;
        if (scheduleIds.has(e.parent_id)) artifactsWithSchedule.add(e.child_id);
        if (scheduleIds.has(e.child_id)) artifactsWithSchedule.add(e.parent_id);
      }
      const candidates = allArtifacts
        .filter(
          (a) =>
            a.kind === "artifact" &&
            a.type !== "archive" &&
            !alreadyArchived.has(a.id) &&
            !artifactsWithSchedule.has(a.id),
        )
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      const overflow = candidates.slice(VISIBLE_ARTIFACT_CAP);

      if (overflow.length > 0) {
        // sub-domain (kind='domain' type='category') id → archive node id
        const archiveBySubDomain = new Map<string, string>();
        const archiveNodes = allArtifacts.filter((a) => a.type === "archive");
        for (const arch of archiveNodes) {
          const parentEdge = allEdges.find(
            (e) => e.child_id === arch.id && e.relation === "contains",
          );
          if (parentEdge) archiveBySubDomain.set(parentEdge.parent_id, arch.id);
        }
        const newEdges: Array<Omit<EdgeRow, "id">> = [];
        for (const art of overflow) {
          const parentContainsEdges = allEdges.filter(
            (e) => e.child_id === art.id && e.relation === "contains",
          );
          let targetArchiveId: string | undefined;
          for (const pe of parentContainsEdges) {
            const p = allArtifacts.find((x) => x.id === pe.parent_id);
            if (p?.kind === "domain" && p.type === "category") {
              targetArchiveId = archiveBySubDomain.get(p.id);
              if (targetArchiveId) break;
            }
          }
          if (targetArchiveId) {
            newEdges.push({
              parent_id: targetArchiveId,
              child_id: art.id,
              relation: "contains",
            });
          }
        }
        if (newEdges.length > 0) {
          const { data: inserted, error } = await supabase
            .from("artifact_edges")
            .insert(newEdges)
            .select("id,parent_id,child_id,relation");
          if (!error && inserted) {
            allEdges = [...allEdges, ...(inserted as EdgeRow[])];
          }
        }
      }

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
        const isLocked =
          a.kind === "anchor" || (a.kind === "domain" && a.type !== "category");
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

      // Pick handles based on actual relative position: use the side of the
      // target that faces the source (and vice versa). With the radial layout
      // children can sit anywhere around a parent; fixed L↔R handles produce
      // long unnatural arcs.
      const pickHandles = (parentId: string, childId: string) => {
        const p = positions[parentId];
        const c = positions[childId];
        const parent = artifactById.get(parentId);
        const child = artifactById.get(childId);
        if (!p || !c || !parent || !child) {
          return { sourceHandle: "r", targetHandle: "l" };
        }
        const ps = sizeFor(parent.kind);
        const cs = sizeFor(child.kind);
        const pCenterX = p.x + ps.w / 2;
        const cCenterX = c.x + cs.w / 2;
        return cCenterX >= pCenterX
          ? { sourceHandle: "r", targetHandle: "l" }
          : { sourceHandle: "l-s", targetHandle: "r-t" };
      };

      const flowEdges: Edge[] = edgeRows
        .filter((e) => e.parent_id !== anchorId)
        .map((e) => {
          const src = nodeOpacity.get(e.parent_id) ?? 1;
          const tgt = nodeOpacity.get(e.child_id) ?? 1;
          const factor = Math.min(src, tgt);
          const base = RELATION_STYLE[e.relation];
          const { sourceHandle, targetHandle } = pickHandles(
            e.parent_id,
            e.child_id,
          );
          return {
            id: e.id,
            source: e.parent_id,
            sourceHandle,
            target: e.child_id,
            targetHandle,
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

  // Filter reactivity: update node opacity only when filter changes.
  // Hover does NOT recompute nodes — that caused lag on every mouse-move.
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
        const prevOp = (n.style as React.CSSProperties | undefined)?.opacity;
        if (prevOp === op) return n;
        return { ...n, style: { ...(n.style ?? {}), opacity: op } };
      }),
    );
    nodeOpRef.current = nodeOp;
  }, [timeRangeDays, selectedDomains, setNodes]);

  // Edge reactivity: update edges on filter OR hover change. Skip edges whose
  // opacity/strokeWidth didn't change so React Flow doesn't re-render them.
  useEffect(() => {
    setEdges((es) =>
      es.map((e) => {
        const nodeOp = nodeOpRef.current;
        const src = nodeOp.get(e.source) ?? 1;
        const tgt = nodeOp.get(e.target) ?? 1;
        const visibilityFactor = Math.min(src, tgt);
        const relation = (e.data as { relation?: Relation } | undefined)
          ?.relation;
        const base = relation ? RELATION_STYLE[relation] : {};
        const baseOpacity = (base.opacity as number) ?? 1;
        const isIncident =
          hoveredId !== null &&
          (e.source === hoveredId || e.target === hoveredId);
        // Radial layout: edges hidden unless hovering an incident node.
        const hoverFactor = hoveredId === null ? 0 : isIncident ? 1 : 0;
        const baseStroke = (base.strokeWidth as number) ?? 1;
        const strokeWidth = isIncident ? baseStroke + 1 : baseStroke;
        const opacity = baseOpacity * visibilityFactor * hoverFactor;
        const prev = e.style as React.CSSProperties | undefined;
        if (
          prev &&
          prev.opacity === opacity &&
          prev.strokeWidth === strokeWidth
        ) {
          return e;
        }
        return {
          ...e,
          style: {
            ...base,
            strokeWidth,
            opacity,
          } as React.CSSProperties,
        };
      }),
    );
  }, [timeRangeDays, selectedDomains, hoveredId, setEdges]);

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

  const handleSetDateRange = useCallback(
    async (artifactId: string, value: DateRangeValue) => {
      const supabase = createClient();
      const node = nodes.find((n) => n.id === artifactId);
      const existing = (node?.data?.metadata ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...existing };
      for (const key of ["start_date", "end_date", "due_date"] as const) {
        const v = value[key];
        if (v === null || v === "") delete merged[key];
        else if (typeof v === "string") merged[key] = v;
      }
      await supabase
        .from("artifacts")
        .update({ metadata: merged })
        .eq("id", artifactId);
      setNodes((ns) =>
        ns.map((n) =>
          n.id === artifactId
            ? { ...n, data: { ...n.data, metadata: merged } }
            : n,
        ),
      );
    },
    [nodes, setNodes],
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
        const md = (data.metadata ?? {}) as Record<string, unknown>;
        const hasDates = !!md.start_date || !!md.end_date || !!md.due_date;
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
            key: "date-range",
            label: hasDates ? "기간 편집" : "기간 설정",
            onClick: () =>
              setModal({
                type: "date-range",
                artifactId: nodeId,
                title: data.title,
                initial: {
                  start_date: (md.start_date as string) ?? null,
                  end_date: (md.end_date as string) ?? null,
                  due_date: (md.due_date as string) ?? null,
                },
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

  const ZOOM_FOCUS_THRESHOLD = 0.7;

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const flow = flowRef.current;
    if (!flow) return;
    const currentZoom = flow.getZoom();
    if (currentZoom >= ZOOM_FOCUS_THRESHOLD) return;
    flow.fitView({
      nodes: [{ id: node.id }],
      padding: 0.2,
      duration: 600,
      maxZoom: 4,
    });
  }, []);

  const menuItems = useMemo(
    () => (menu ? buildMenuItems(menu) : []),
    [menu, buildMenuItems],
  );

  const hoveredData = useMemo(() => {
    if (!stickyHoveredId) return null;
    const node = nodes.find((n) => n.id === stickyHoveredId);
    if (!node) return null;
    const d = node.data as unknown as ArtifactRow;

    const dataById = new Map(
      nodes.map((n) => [n.id, n.data as unknown as ArtifactRow]),
    );
    const parents: Array<{
      id: string;
      title: string;
      kind: Kind;
      relation: string;
    }> = [];
    const children: Array<{
      id: string;
      title: string;
      kind: Kind;
      relation: string;
    }> = [];
    for (const e of edges) {
      const relation =
        (e.data as { relation?: Relation } | undefined)?.relation ?? "contains";
      if (e.target === stickyHoveredId) {
        const p = dataById.get(e.source);
        if (p)
          parents.push({
            id: p.id,
            title: p.title,
            kind: p.kind,
            relation,
          });
      }
      if (e.source === stickyHoveredId) {
        const c = dataById.get(e.target);
        if (c)
          children.push({
            id: c.id,
            title: c.title,
            kind: c.kind,
            relation,
          });
      }
    }

    const containsParents = new Map<string, string[]>();
    for (const e of edges) {
      const rel = (e.data as { relation?: Relation } | undefined)?.relation;
      if (rel !== "contains") continue;
      const arr = containsParents.get(e.target) ?? [];
      arr.push(e.source);
      containsParents.set(e.target, arr);
    }
    const findSubDomain = (
      start: string,
    ): { id: string; title: string } | null => {
      const queue: string[] = [start];
      const seen = new Set<string>();
      while (queue.length) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const data = dataById.get(id);
        if (data?.kind === "domain" && data.type === "category") {
          return { id: data.id, title: data.title };
        }
        for (const p of containsParents.get(id) ?? []) {
          if (!seen.has(p)) queue.push(p);
        }
      }
      return null;
    };
    const subDomain = findSubDomain(stickyHoveredId);

    return {
      id: d.id,
      kind: d.kind,
      type: d.type,
      title: d.title,
      content: d.content,
      status: d.status,
      domains: d.domains,
      subDomain,
      metadata: d.metadata,
      created_at: d.created_at,
      parents,
      children,
    };
  }, [stickyHoveredId, nodes, edges]);

  return (
    <div className="relative flex-1 h-full overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_, node) => {
          setHoveredId(node.id);
          setStickyHoveredId(node.id);
        }}
        onNodeMouseLeave={() => setHoveredId(null)}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        onInit={(instance) => {
          flowRef.current = instance;
          instance.setCenter(0, 0, { zoom: 1.2 });
        }}
        colorMode="light"
        minZoom={0.2}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
      >
        <NebulaBackground />
      </ReactFlow>

      <HoverInfoPanel node={hoveredData} />

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
      {modal.type === "date-range" && (
        <DateRangeModal
          open
          title={`기간 설정: ${modal.title}`}
          initial={modal.initial}
          onClose={() => setModal({ type: "none" })}
          onSubmit={(value) => handleSetDateRange(modal.artifactId, value)}
        />
      )}
    </div>
  );
};
