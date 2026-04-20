"use client";

import { useEffect, useState } from "react";
import { Handle, Position, NodeProps, useStoreApi } from "@xyflow/react";
import {
  ChevronDown,
  Clock,
  Play,
  FileText,
  Paperclip,
  Scale,
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
    "border-[#c47865]/40 bg-[#c47865]/8 text-[#a35c4a] hover:bg-[#c47865]/12",
  running:
    "border-[#7f8f54]/60 bg-[#7f8f54]/12 text-[#6a7843] shadow-[0_0_14px_rgba(127,143,84,0.25)] animate-pulse hover:bg-[#7f8f54]/18",
  paused:
    "border-[#ddd0b4] bg-[#ebe0ca]/60 text-[#8c7e66] opacity-80 hover:opacity-100 hover:border-[#bfae8a]",
  delayed:
    "border-[#c9801e]/55 bg-[#c9801e]/10 text-[#c9801e] opacity-85 animate-pulse hover:opacity-100 hover:border-[#c9801e]/80",
};

const SCHEDULE_DOT: Record<ScheduleDisplay, string> = {
  waiting: "bg-[#c47865]",
  running: "bg-[#7f8f54]",
  paused: "bg-[#bfae8a]",
  delayed: "bg-[#c9801e]",
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
  active: "bg-[#7f8f54]",
  draft: "bg-[#bfae8a]",
  paused: "bg-[#bfae8a]",
  success: "bg-[#7f8f54]",
  failed: "bg-[#b85a4a]",
  running: "bg-[#c47865] animate-pulse",
};

const KIND_ICON: Record<Kind, React.ComponentType<{ className?: string }>> = {
  artifact: FileText,
  schedule: Clock,
  log: Play,
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  uploaded_doc: Paperclip,
  analysis: Scale,
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
    hex: "#c47865",
    border: "border-[#c47865]/55",
    handle: "!bg-[#c47865]",
    icon: "text-[#a35c4a]",
  },
  marketing: {
    hex: "#d89a2b",
    border: "border-[#d89a2b]/55",
    handle: "!bg-[#d89a2b]",
    icon: "text-[#a87620]",
  },
  sales: {
    hex: "#7f8f54",
    border: "border-[#7f8f54]/55",
    handle: "!bg-[#7f8f54]",
    icon: "text-[#6a7843]",
  },
  documents: {
    hex: "#8e5572",
    border: "border-[#8e5572]/55",
    handle: "!bg-[#8e5572]",
    icon: "text-[#764463]",
  },
};

const ZOOM_FOCUS_THRESHOLD = 0.7;

export const ArtifactChipNode = ({ data, selected, id }: NodeProps) => {
  const store = useStoreApi();
  const [expanded, setExpanded] = useState(false);
  const toggleExpand = () => {
    const zoom = store.getState().transform[2];
    if (zoom < ZOOM_FOCUS_THRESHOLD) return;
    setExpanded((v) => !v);
  };
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

  const Icon = TYPE_ICON[type] ?? KIND_ICON[kind];
  const isAnalysis = type === "analysis";
  const gapRatio = isAnalysis
    ? (metadata.gap_ratio as number | undefined)
    : undefined;
  const eulRatio = isAnalysis
    ? (metadata.eul_ratio as number | undefined)
    : undefined;
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
      <ThumbsUp className="h-[14px] w-[14px] text-[#6a7843]" />
    ) : localRating === "down" ? (
      <ThumbsDown className="h-[14px] w-[14px] text-[#b85a4a]" />
    ) : (
      <Circle className="h-[14px] w-[14px] text-[#8c7e66]" />
    );

  const shortTitle = title.replace(/^\[MOCK\]\s*/, "").trim() || title;

  const detailPanel = expanded ? (
    <div className="absolute left-1/2 top-full z-40 mt-2 w-[220px] -translate-x-1/2 space-y-1.5 rounded-md border border-[#ddd0b4] bg-[#fffaf2]/97 px-2.5 py-2 shadow-xl">
      <p className="text-[13px] font-semibold leading-tight text-[#2e2719]">
        {shortTitle}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className="rounded-full border-[#ddd0b4] bg-[#ebe0ca] px-1.5 py-0 text-[11px] uppercase tracking-[0.15em] text-[#8c7e66]"
        >
          {KIND_BADGE[kind]}
        </Badge>
        {isCross &&
          domains.map((d) => (
            <span
              key={d}
              className="rounded-full px-1.5 py-0 text-[11px] font-mono uppercase tracking-wider"
              style={{
                color: DOMAIN_COLOR[d].hex,
                border: `1px solid ${DOMAIN_COLOR[d].hex}66`,
                background: `${DOMAIN_COLOR[d].hex}14`,
              }}
            >
              {d}
            </span>
          ))}
        {!isCross && type && (
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#8c7e66]">
            {type}
          </span>
        )}
      </div>
      {cron && (
        <p className="font-mono text-[12px] text-[#8c7e66]">
          cron: <span className="text-[#2e2719]">{cron}</span>
          {nextRun && (
            <span className="text-[#8c7e66]"> · next: {nextRun}</span>
          )}
        </p>
      )}
      {executedAt && (
        <p className="font-mono text-[12px] text-[#8c7e66]">
          executed: <span className="text-[#2e2719]">{executedAt}</span>
        </p>
      )}
      {content && (
        <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-[#5a5040]">
          {content}
        </p>
      )}
    </div>
  ) : null;

  const evalPopover = popoverOpen ? (
    <div
      className="nodrag absolute left-1/2 top-full z-50 mt-1 w-[220px] -translate-x-1/2 space-y-2 rounded-lg border border-[#ddd0b4] bg-[#fffaf2] p-2.5 shadow-xl"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8c7e66]">
          평가
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setLocalRating("up")}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded border transition-colors",
              localRating === "up"
                ? "border-[#7f8f54] bg-[#7f8f54]/20 text-[#6a7843]"
                : "border-[#ddd0b4] text-[#8c7e66] hover:bg-[#ebe0ca]",
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
                ? "border-[#b85a4a] bg-[#b85a4a]/20 text-[#b85a4a]"
                : "border-[#ddd0b4] text-[#8c7e66] hover:bg-[#ebe0ca]",
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
        className="h-16 w-full resize-none rounded border border-[#ddd0b4] bg-[#f2e9d5] text-[#2e2719] px-2 py-1.5 text-[13px] placeholder:text-[#8c7e66] focus:outline-none focus:ring-1 focus:ring-[#bfae8a]"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setPopoverOpen(false)}
          className="flex-1 rounded border border-[#ddd0b4] bg-[#ebe0ca] px-2 py-1 text-[12px] font-medium text-[#5a5040] hover:bg-[#ddd0b4]"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!localRating || saving}
          className="flex-1 rounded bg-[#2e2719] px-2 py-1 text-[12px] font-medium text-[#fbf6eb] hover:bg-[#3d3423] disabled:cursor-not-allowed disabled:opacity-50"
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
        "group/node relative w-[260px] overflow-visible rounded-[11px] bg-[#fffaf2]/95 backdrop-blur transition-all hover:shadow-lg",
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
        onClick={toggleExpand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleExpand();
          }
        }}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[#ebe0ca]/60"
      >
        <div
          className={cn(
            "h-[8px] w-[8px] shrink-0 rounded-full",
            STATUS_DOT[status] ?? "bg-[#bfae8a]",
          )}
        />
        <div className="flex shrink-0 items-center -space-x-1">
          {(isCross ? domains : [primary]).map((d) => (
            <Icon
              key={d}
              className={cn("h-[14px] w-[14px]", DOMAIN_COLOR[d].icon)}
            />
          ))}
        </div>
        <p className="flex-1 truncate text-[16px] font-medium leading-tight text-[#2e2719]">
          {shortTitle}
        </p>
        {isAnalysis &&
          typeof gapRatio === "number" &&
          typeof eulRatio === "number" && (
            <span
              className="shrink-0 rounded-md border border-[#ddd0b4] bg-[#fbf6eb] px-1.5 py-0 font-mono text-[10px] tracking-tight text-[#5a5040]"
              title={`갑에게 ${gapRatio}% / 을에게 ${eulRatio}% 유리`}
            >
              <span className="text-[#a35c4a]">갑{gapRatio}</span>
              <span className="px-0.5 text-[#8c7e66]">:</span>
              <span className="text-[#6a7843]">을{eulRatio}</span>
            </span>
          )}
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
          className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded hover:bg-[#ddd0b4]/80"
        >
          {rateButtonIcon}
        </div>
        <ChevronDown
          className={cn(
            "h-[14px] w-[14px] shrink-0 text-[#8c7e66] transition-transform",
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
            "nodrag flex cursor-pointer items-center justify-center gap-2 border-t px-2 py-2 font-mono text-[13px] uppercase tracking-[0.18em] transition-all",
            SCHEDULE_STYLES[scheduleDisplay],
          )}
        >
          <span
            className={cn(
              "h-[8px] w-[8px] rounded-full",
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
          "!h-1.5 !w-1.5 !border-2 !border-[#fbf6eb]",
          primaryColor.handle,
        )}
      />
      <Handle
        id="l-s"
        type="source"
        position={Position.Left}
        className={cn(
          "!h-1.5 !w-1.5 !border-2 !border-[#fbf6eb]",
          primaryColor.handle,
        )}
      />
      <Handle
        id="r-t"
        type="target"
        position={Position.Right}
        className={cn(
          "!h-1.5 !w-1.5 !border-2 !border-[#fbf6eb]",
          primaryColor.handle,
        )}
      />
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className={cn(
          "!h-1.5 !w-1.5 !border-2 !border-[#fbf6eb]",
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
        className="nodrag absolute left-0 top-full z-50 mt-1 w-[220px] space-y-2 rounded-lg border border-[#ddd0b4] bg-[#fffaf2] p-2.5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="text-[13px] leading-snug text-[#2e2719]">
          지금 바로 1회 실행할까요?
        </p>
        {nextRun && (
          <p className="font-mono text-[11px] text-[#8c7e66]">
            다음 예정: {nextRun}
          </p>
        )}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setRunConfirmOpen(false)}
            className="flex-1 rounded border border-[#ddd0b4] bg-[#ebe0ca] px-2 py-1 text-[12px] font-medium text-[#5a5040] hover:bg-[#ddd0b4]"
          >
            아니오
          </button>
          <button
            type="button"
            onClick={runScheduleNow}
            disabled={runPending}
            className="flex-1 rounded bg-[#7f8f54] px-2 py-1 text-[12px] font-medium text-[#fbf6eb] hover:bg-[#6a7843] disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="relative w-[260px]">
      {wrappedCard}
      {confirmPopup}
    </div>
  );
};
