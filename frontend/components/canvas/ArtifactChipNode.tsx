"use client";

import { useEffect, useState } from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import {
  ChevronDown,
  Clock,
  Play,
  FileText,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Circle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Domain = "recruitment" | "marketing" | "sales" | "documents";
type Kind = "artifact" | "schedule" | "log";
type Status = "active" | "draft" | "paused" | "success" | "failed" | "running";
type Rating = "up" | "down";
type ScheduleDisplay = "waiting" | "running" | "paused" | "delayed";

const SCHEDULE_LABEL: Record<ScheduleDisplay, string> = {
  waiting: "대기",
  running: "실행 중",
  paused: "일시정지",
  delayed: "지연",
};

const SCHEDULE_STYLES: Record<ScheduleDisplay, string> = {
  waiting:
    "border-cyan-500/40 bg-cyan-500/5 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.18)] hover:bg-cyan-500/10",
  running:
    "border-emerald-400/60 bg-emerald-500/10 text-emerald-300 shadow-[0_0_14px_rgba(52,211,153,0.35)] animate-pulse hover:bg-emerald-500/15",
  paused:
    "border-zinc-700 bg-zinc-900/60 text-zinc-500 opacity-70 hover:opacity-90 hover:border-zinc-600",
  delayed:
    "border-zinc-700 bg-zinc-900/50 text-zinc-500 opacity-60 animate-pulse hover:opacity-90 hover:border-amber-500/40",
};

const SCHEDULE_DOT: Record<ScheduleDisplay, string> = {
  waiting: "bg-cyan-400",
  running: "bg-emerald-400",
  paused: "bg-zinc-600",
  delayed: "bg-zinc-700",
};

const deriveScheduleDisplay = (
  status: Status,
  nextRun: string | undefined,
): ScheduleDisplay => {
  if (status === "paused") return "paused";
  if (status === "running") return "running";
  if (status === "active" && nextRun) {
    const next = new Date(nextRun).getTime();
    if (!Number.isNaN(next) && next <= Date.now()) return "delayed";
  }
  return "waiting";
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  draft: "bg-zinc-400",
  paused: "bg-amber-500",
  success: "bg-emerald-500",
  failed: "bg-rose-500",
  running: "bg-sky-500 animate-pulse",
};

const KIND_ICON: Record<Kind, React.ComponentType<{ className?: string }>> = {
  artifact: FileText,
  schedule: Clock,
  log: Play,
};

const KIND_BADGE: Record<Kind, string> = {
  artifact: "ARTIFACT",
  schedule: "SCHEDULE",
  log: "LOG",
};

const DOMAIN_COLOR: Record<
  Domain,
  { hex: string; border: string; handle: string; icon: string }
> = {
  recruitment: {
    hex: "#60a5fa",
    border: "border-blue-400/40",
    handle: "!bg-blue-400",
    icon: "text-blue-500",
  },
  marketing: {
    hex: "#c084fc",
    border: "border-purple-400/40",
    handle: "!bg-purple-400",
    icon: "text-purple-500",
  },
  sales: {
    hex: "#34d399",
    border: "border-emerald-400/40",
    handle: "!bg-emerald-400",
    icon: "text-emerald-500",
  },
  documents: {
    hex: "#fbbf24",
    border: "border-amber-400/40",
    handle: "!bg-amber-400",
    icon: "text-amber-500",
  },
};

export const ArtifactChipNode = ({ data, selected, id }: NodeProps) => {
  const [expanded, setExpanded] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localStatus, setLocalStatus] = useState<Status | null>(null);
  const [localExecutedAt, setLocalExecutedAt] = useState<string | null>(null);
  const [localNextRun, setLocalNextRun] = useState<string | null>(null);
  const [runConfirmOpen, setRunConfirmOpen] = useState(false);
  const [runPending, setRunPending] = useState(false);

  const title = (data?.title as string) ?? "Untitled";
  const type = (data?.type as string) ?? "";
  const serverStatus = (data?.status as Status) ?? "draft";
  const status: Status = localStatus ?? serverStatus;
  const content = (data?.content as string) ?? "";
  const kind = (data?.kind as Kind) ?? "artifact";
  const isArchive = type === "archive";
  const metadata = (data?.metadata as Record<string, unknown>) ?? {};

  const domains = ((data?.domains as Domain[] | null) ?? []).filter(
    (d): d is Domain => d in DOMAIN_COLOR,
  );
  const primary = domains[0] ?? "recruitment";
  const isCross = domains.length > 1;
  const colors = domains.map((d) => DOMAIN_COLOR[d].hex);
  const primaryColor = DOMAIN_COLOR[primary];

  // Archive chips get dashed border for visual hint
  const shapeBorder = isArchive ? "border-dashed" : "";

  // 평가 상태 (데이터 + 로컬 오버라이드)
  const isExecuted = !!data?.isExecuted;
  const serverEvaluated = !!data?.isEvaluated;
  const serverRating = (data?.currentRating as Rating | null) ?? null;
  const serverFeedback = (data?.currentFeedback as string | undefined) ?? "";

  const [localRating, setLocalRating] = useState<Rating | null>(serverRating);
  const [localFeedback, setLocalFeedback] = useState<string>(serverFeedback);
  const [localEvaluated, setLocalEvaluated] = useState(serverEvaluated);
  const evaluated = localEvaluated || serverEvaluated;
  const shouldPulse = isExecuted && !evaluated;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string }>).detail;
      if (detail?.id === id) {
        setPopoverOpen(true);
        setLocalEvaluated(false);
      }
    };
    window.addEventListener("boss:open-evaluate", handler);
    return () => window.removeEventListener("boss:open-evaluate", handler);
  }, [id]);

  const Icon = KIND_ICON[kind];
  const cron = metadata.cron as string | undefined;
  const nextRun = localNextRun ?? (metadata.next_run as string | undefined);
  const executedAt =
    localExecutedAt ?? (metadata.executed_at as string | undefined);
  const isSchedule = kind === "schedule";
  const scheduleDisplay = isSchedule
    ? deriveScheduleDisplay(status, nextRun)
    : null;

  const gradientBg =
    colors.length > 1
      ? `linear-gradient(135deg, ${colors.join(", ")})`
      : undefined;

  const handleSave = async () => {
    if (!localRating || saving) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/evaluations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: user.id,
          artifact_id: id,
          rating: localRating,
          feedback: localFeedback,
        }),
      });
      setLocalEvaluated(true);
      setPopoverOpen(false);
    } catch {
      // fail silently; popover stays open
    } finally {
      setSaving(false);
    }
  };

  const toggleSchedulePaused = async (next: "active" | "paused") => {
    const prev = status;
    setLocalStatus(next);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/schedules/${id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: user.id, status: next }),
        },
      );
      if (!res.ok) throw new Error("status update failed");
    } catch {
      setLocalStatus(prev);
    }
  };

  const runScheduleNow = async () => {
    if (runPending) return;
    setRunPending(true);
    setLocalStatus("running");
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("no user");
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/schedules/${id}/run-now`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: user.id }),
        },
      );
      if (!res.ok) throw new Error("run failed");
      const json = (await res.json()) as {
        data: { executed_at?: string; next_run?: string };
      };
      setLocalStatus("active");
      if (json.data?.executed_at) setLocalExecutedAt(json.data.executed_at);
      if (json.data?.next_run) setLocalNextRun(json.data.next_run);
      setRunConfirmOpen(false);
    } catch {
      setLocalStatus("paused");
    } finally {
      setRunPending(false);
    }
  };

  const handleScheduleBoxClick = (
    e: React.MouseEvent | React.KeyboardEvent,
  ) => {
    e.stopPropagation();
    if (!scheduleDisplay) return;
    if (scheduleDisplay === "waiting" || scheduleDisplay === "running") {
      toggleSchedulePaused("paused");
    } else {
      setRunConfirmOpen(true);
    }
  };

  const rateButtonIcon =
    localRating === "up" ? (
      <ThumbsUp className="h-3 w-3 text-emerald-400" />
    ) : localRating === "down" ? (
      <ThumbsDown className="h-3 w-3 text-rose-400" />
    ) : (
      <Circle className="h-3 w-3 text-zinc-500" />
    );

  const shortTitle = title.replace(/^\[MOCK\]\s*/, "").trim() || title;

  const detailPanel = expanded ? (
    <div className="absolute left-1/2 top-full z-40 mt-2 w-[220px] -translate-x-1/2 space-y-1.5 rounded-md border border-zinc-800 bg-zinc-950/95 px-2.5 py-2 shadow-2xl">
      <p className="text-[11px] font-semibold leading-tight text-zinc-100">
        {shortTitle}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className="rounded-full border-zinc-700 bg-zinc-900 px-1.5 py-0 text-[9px] uppercase tracking-[0.15em] text-zinc-400"
        >
          {KIND_BADGE[kind]}
        </Badge>
        {isCross &&
          domains.map((d) => (
            <span
              key={d}
              className="rounded-full px-1.5 py-0 text-[9px] font-mono uppercase tracking-wider"
              style={{
                color: DOMAIN_COLOR[d].hex,
                border: `1px solid ${DOMAIN_COLOR[d].hex}66`,
                background: `${DOMAIN_COLOR[d].hex}11`,
              }}
            >
              {d}
            </span>
          ))}
        {!isCross && type && (
          <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
            {type}
          </span>
        )}
      </div>
      {cron && (
        <p className="font-mono text-[10px] text-zinc-400">
          cron: <span className="text-zinc-100">{cron}</span>
          {nextRun && <span className="text-zinc-500"> · next: {nextRun}</span>}
        </p>
      )}
      {executedAt && (
        <p className="font-mono text-[10px] text-zinc-400">
          executed: <span className="text-zinc-100">{executedAt}</span>
        </p>
      )}
      {content && (
        <p className="whitespace-pre-wrap break-words text-[10px] leading-snug text-zinc-300">
          {content}
        </p>
      )}
    </div>
  ) : null;

  const evalPopover = popoverOpen ? (
    <div
      className="nodrag absolute left-1/2 top-full z-50 mt-1 w-[220px] -translate-x-1/2 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-400">
          평가
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setLocalRating("up")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded border transition-colors",
              localRating === "up"
                ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                : "border-zinc-700 text-zinc-400 hover:bg-zinc-800",
            )}
            aria-label="thumbs up"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setLocalRating("down")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded border transition-colors",
              localRating === "down"
                ? "border-rose-400 bg-rose-500/20 text-rose-300"
                : "border-zinc-700 text-zinc-400 hover:bg-zinc-800",
            )}
            aria-label="thumbs down"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <textarea
        value={localFeedback}
        onChange={(e) => setLocalFeedback(e.target.value)}
        placeholder="피드백 (선택) — 다음 실행에 반영돼요"
        className="h-16 w-full resize-none rounded border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-[11px] placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setPopoverOpen(false)}
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!localRating || saving}
          className="flex-1 rounded bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-900 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="mx-auto h-3 w-3 animate-spin" />
          ) : (
            "저장"
          )}
        </button>
      </div>
    </div>
  ) : null;

  const card = (
    <div
      className={cn(
        "group/node relative w-[180px] overflow-visible rounded-[11px] bg-zinc-900/90 backdrop-blur transition-all hover:shadow-lg",
        !isCross && "border " + primaryColor.border,
        shapeBorder,
        selected && "ring-2 ring-primary/40",
        shouldPulse && "glow-pulse",
      )}
      role="article"
      aria-label={`${kind}: ${title}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-800/40"
      >
        <div
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            STATUS_DOT[status] ?? "bg-zinc-300",
          )}
        />
        <div className="flex shrink-0 items-center -space-x-1">
          {(isCross ? domains : [primary]).map((d) => (
            <Icon key={d} className={cn("h-3 w-3", DOMAIN_COLOR[d].icon)} />
          ))}
        </div>
        <p className="flex-1 truncate text-[11px] font-medium leading-tight text-zinc-100">
          {shortTitle}
        </p>
        <div
          role="button"
          tabIndex={0}
          aria-label="Evaluate"
          onClick={(e) => {
            e.stopPropagation();
            setPopoverOpen((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setPopoverOpen((v) => !v);
            }
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-zinc-700/60"
        >
          {rateButtonIcon}
        </div>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-zinc-500 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </div>

      {/* Schedule status — integrated 2nd row */}
      {isSchedule && scheduleDisplay && (
        <div
          role="button"
          tabIndex={0}
          aria-label={`schedule status: ${SCHEDULE_LABEL[scheduleDisplay]}`}
          onClick={handleScheduleBoxClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleScheduleBoxClick(e);
            }
          }}
          className={cn(
            "nodrag flex cursor-pointer items-center justify-center gap-1.5 border-t px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] transition-all",
            SCHEDULE_STYLES[scheduleDisplay],
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              SCHEDULE_DOT[scheduleDisplay],
            )}
          />
          <span>{SCHEDULE_LABEL[scheduleDisplay]}</span>
        </div>
      )}

      {detailPanel}
      {evalPopover}

      <Handle
        id="l"
        type="target"
        position={Position.Left}
        className={cn(
          "!h-1.5 !w-1.5 !border-2 !border-zinc-950",
          primaryColor.handle,
        )}
      />
      <Handle
        id="l-s"
        type="source"
        position={Position.Left}
        className={cn(
          "!h-1.5 !w-1.5 !border-2 !border-zinc-950",
          primaryColor.handle,
        )}
      />
      <Handle
        id="r-t"
        type="target"
        position={Position.Right}
        className={cn(
          "!h-1.5 !w-1.5 !border-2 !border-zinc-950",
          primaryColor.handle,
        )}
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className={cn(
          "!h-1.5 !w-1.5 !border-2 !border-zinc-950",
          primaryColor.handle,
        )}
      />
    </div>
  );

  const wrappedCard = gradientBg ? (
    <div
      className={cn("rounded-xl", shouldPulse && "glow-pulse")}
      style={{ background: gradientBg, padding: 1 }}
    >
      {card}
    </div>
  ) : (
    card
  );

  const confirmPopup =
    isSchedule && runConfirmOpen ? (
      <div
        className="nodrag absolute left-0 top-full z-50 mt-1 w-[220px] space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] leading-snug text-zinc-200">
          지금 바로 1회 실행할까요?
        </p>
        {nextRun && (
          <p className="font-mono text-[9px] text-zinc-500">
            다음 예정: {nextRun}
          </p>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setRunConfirmOpen(false)}
            className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800"
          >
            아니오
          </button>
          <button
            type="button"
            onClick={runScheduleNow}
            disabled={runPending}
            className="flex-1 rounded bg-emerald-500 px-2 py-1 text-[10px] font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {runPending ? (
              <Loader2 className="mx-auto h-3 w-3 animate-spin" />
            ) : (
              "지금 실행"
            )}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="relative w-[180px]">
      {wrappedCard}
      {confirmPopup}
    </div>
  );
};
