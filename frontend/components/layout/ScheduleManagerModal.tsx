"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List as ListIcon,
  Pause,
  Play,
  Clock,
  CircleSlash,
  CalendarClock,
  CalendarRange,
  AlarmClock,
} from "lucide-react";
import {
  ALL_DOMAINS,
  DOMAIN_LABEL,
  type DomainKey as Domain,
} from "@/components/bento/types";
import { useNodeDetail } from "@/components/detail/NodeDetailContext";

type RawRow = {
  id: string;
  title: string;
  kind: "artifact" | "domain" | "anchor" | "log";
  status: string;
  domains: Domain[] | null;
  metadata: {
    cron?: string;
    next_run?: string;
    start_date?: string;
    end_date?: string;
    due_date?: string;
    schedule_enabled?: boolean;
    schedule_status?: "active" | "paused";
    period_enabled?: boolean;
  } | null;
  created_at: string;
};

type ItemKind = "cron" | "window" | "due";

type ScheduleItem = RawRow & {
  itemKind: ItemKind;
  effectiveDate: Date | null;
};

type SortKey = "created_asc" | "created_desc" | "upcoming" | "ended_only";

type Props = {
  open: boolean;
  onClose: () => void;
};

const DOMAIN_DOT: Record<Domain, string> = {
  recruitment: "bg-[#c47865]",
  marketing: "bg-[#d89a2b]",
  sales: "bg-[#7f8f54]",
  documents: "bg-[#8e5572]",
};

const DOMAIN_TEXT: Record<Domain, string> = {
  recruitment: "text-[#a35c4a]",
  marketing: "text-[#a87620]",
  sales: "text-[#6a7843]",
  documents: "text-[#764463]",
};

const DOMAIN_RING: Record<Domain, string> = {
  recruitment: "border-[#c47865]/50 bg-[#c47865]/12 text-[#a35c4a]",
  marketing: "border-[#d89a2b]/50 bg-[#d89a2b]/12 text-[#a87620]",
  sales: "border-[#7f8f54]/50 bg-[#7f8f54]/12 text-[#6a7843]",
  documents: "border-[#8e5572]/50 bg-[#8e5572]/12 text-[#764463]",
};

const SORT_LABEL: Record<SortKey, string> = {
  created_asc: "Created (oldest)",
  created_desc: "Created (newest)",
  upcoming: "Upcoming",
  ended_only: "Ended only",
};

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtDate = (s: string) => {
  const d = parseDate(s);
  if (!d) return s;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" });
};

const parseDate = (s?: string): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const cronHuman = (expr?: string) => {
  if (!expr) return "";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [m, h, dom, mon, dow] = parts;
  if (dom === "*" && mon === "*" && dow === "*") {
    if (dow === "*") {
      return `Daily ${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
    }
  }
  return expr;
};

const classifyItem = (r: RawRow): ScheduleItem => {
  if (r.metadata?.schedule_enabled) {
    return {
      ...r,
      itemKind: "cron",
      effectiveDate: parseDate(r.metadata?.next_run),
    };
  }
  const md = r.metadata ?? {};
  if (md.due_date) {
    return { ...r, itemKind: "due", effectiveDate: parseDate(md.due_date) };
  }
  if (md.end_date || md.start_date) {
    const today = startOfToday();
    const s = parseDate(md.start_date);
    const e = parseDate(md.end_date);
    const eff = e && e.getTime() >= today.getTime() ? e : (s ?? e);
    return { ...r, itemKind: "window", effectiveDate: eff };
  }
  return { ...r, itemKind: "window", effectiveDate: null };
};

const isTimeExpired = (i: ScheduleItem): boolean => {
  const today = startOfToday();
  if (i.itemKind === "cron") {
    const nr = parseDate(i.metadata?.next_run);
    return !!nr && nr.getTime() < Date.now();
  }
  if (i.itemKind === "due") {
    const due = parseDate(i.metadata?.due_date);
    return !!due && due.getTime() < today.getTime();
  }
  const e = parseDate(i.metadata?.end_date);
  return !!e && e.getTime() < today.getTime();
};

const isPaused = (i: ScheduleItem): boolean => {
  if (i.itemKind === "cron") return i.metadata?.schedule_status === "paused";
  return i.status === "paused" || i.status === "archived";
};

const isEnded = (i: ScheduleItem): boolean => {
  if (isPaused(i)) return true;
  return isTimeExpired(i);
};

const primaryDomain = (i: ScheduleItem): Domain | null =>
  i.domains && i.domains.length > 0 ? i.domains[0] : null;

export const ScheduleManagerModal = ({ open, onClose }: Props) => {
  const [rows, setRows] = useState<RawRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("upcoming");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [selectedDomains, setSelectedDomains] = useState<Set<Domain>>(
    () => new Set(ALL_DOMAINS),
  );
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("artifacts")
        .select("id,title,kind,status,domains,metadata,created_at")
        .eq("kind", "artifact")
        .or(
          "metadata->>schedule_enabled.eq.true,metadata->>start_date.not.is.null,metadata->>end_date.not.is.null,metadata->>due_date.not.is.null",
        )
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setRows((data as RawRow[] | null) ?? []);
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const { openDetail } = useNodeDetail();

  const handleToggleStatus = async (item: ScheduleItem) => {
    if (pendingIds.has(item.id)) return;
    setPendingIds((prev) => new Set(prev).add(item.id));

    const supabase = createClient();
    try {
      if (item.itemKind === "cron") {
        const current: "active" | "paused" =
          item.metadata?.schedule_status ?? "active";
        const next: "active" | "paused" =
          current === "paused" ? "active" : "paused";
        const nextMeta: RawRow["metadata"] = {
          ...(item.metadata ?? {}),
          schedule_status: next,
        };
        setRows((prev) =>
          prev.map((r) =>
            r.id === item.id ? { ...r, metadata: nextMeta } : r,
          ),
        );
        const { error } = await supabase
          .from("artifacts")
          .update({ metadata: nextMeta })
          .eq("id", item.id);
        if (error) {
          setRows((prev) =>
            prev.map((r) =>
              r.id === item.id ? { ...r, metadata: item.metadata } : r,
            ),
          );
        }
      } else {
        const current = item.status;
        const next = current === "paused" ? "active" : "paused";
        setRows((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, status: next } : r)),
        );
        const { error } = await supabase
          .from("artifacts")
          .update({ status: next })
          .eq("id", item.id);
        if (error) {
          setRows((prev) =>
            prev.map((r) => (r.id === item.id ? { ...r, status: current } : r)),
          );
        }
      }
    } finally {
      setPendingIds((prev) => {
        const n = new Set(prev);
        n.delete(item.id);
        return n;
      });
    }
  };

  const items = useMemo(() => rows.map(classifyItem), [rows]);

  const domainFiltered = useMemo(
    () =>
      items.filter((i) => {
        if (selectedDomains.size === 0) return false;
        const doms = i.domains ?? [];
        if (doms.length === 0) return true;
        return doms.some((d) => selectedDomains.has(d));
      }),
    [items, selectedDomains],
  );

  const sorted = useMemo(() => {
    const list = [...domainFiltered];
    if (sortKey === "ended_only") {
      return list
        .filter(isEnded)
        .sort(
          (a, b) =>
            (b.effectiveDate?.getTime() ?? 0) -
            (a.effectiveDate?.getTime() ?? 0),
        );
    }
    if (sortKey === "upcoming") {
      return list
        .filter((i) => !isEnded(i) && i.effectiveDate)
        .sort(
          (a, b) => a.effectiveDate!.getTime() - b.effectiveDate!.getTime(),
        );
    }
    if (sortKey === "created_asc") {
      return list.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    }
    return list.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [domainFiltered, sortKey]);

  const toggleDomain = (d: Domain) => {
    setSelectedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule Manager"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex gap-1 rounded-md border border-[#030303]/10 p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs",
              view === "list"
                ? "bg-[#fcfcfc] text-[#030303]"
                : "text-[#030303]/60 hover:text-[#030303]",
            )}
          >
            <ListIcon className="h-3.5 w-3.5" />
            List
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs",
              view === "calendar"
                ? "bg-[#fcfcfc] text-[#030303]"
                : "text-[#030303]/60 hover:text-[#030303]",
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Calendar
          </button>
        </div>

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="h-7 rounded-md border border-[#030303]/10 bg-[#fcfcfc] px-2 text-xs text-[#030303] focus:outline-none focus:ring-1 focus:ring-[#030303]/30"
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[10px] font-mono uppercase tracking-[0.15em] text-[#030303]/60">
          Domain
        </span>
        {ALL_DOMAINS.map((d) => {
          const on = selectedDomains.has(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => toggleDomain(d)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                on
                  ? DOMAIN_RING[d]
                  : "border-[#030303]/10 bg-[#fcfcfc]/40 text-[#030303]/60 hover:border-[#030303]/25",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", DOMAIN_DOT[d])} />
              {DOMAIN_LABEL[d]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() =>
            setSelectedDomains(
              selectedDomains.size === ALL_DOMAINS.length
                ? new Set()
                : new Set(ALL_DOMAINS),
            )
          }
          className="ml-1 rounded border border-[#030303]/10 px-2 py-0.5 text-[10px] text-[#030303]/60 hover:text-[#030303]"
        >
          {selectedDomains.size === ALL_DOMAINS.length
            ? "Clear all"
            : "Select all"}
        </button>
      </div>

      <div className="h-[560px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/60">
            Loading…
          </div>
        ) : view === "list" ? (
          <ListView
            items={sorted}
            pendingIds={pendingIds}
            onToggle={handleToggleStatus}
            onNavigate={(id) => openDetail(id)}
          />
        ) : (
          <CalendarView
            items={domainFiltered}
            cursor={cursor}
            setCursor={setCursor}
            onNavigate={(id) => openDetail(id)}
          />
        )}
      </div>
    </Modal>
  );
};

const ItemKindIcon = ({ kind }: { kind: ItemKind }) => {
  const cls = "h-3 w-3";
  if (kind === "cron") return <CalendarClock className={cls} />;
  if (kind === "due") return <AlarmClock className={cls} />;
  return <CalendarRange className={cls} />;
};

const itemDateLine = (i: ScheduleItem): string => {
  if (i.itemKind === "cron") {
    const c = cronHuman(i.metadata?.cron);
    const nr = i.metadata?.next_run
      ? `Next: ${fmtDT(i.metadata.next_run)}`
      : "";
    return [c, nr].filter(Boolean).join(" · ");
  }
  if (i.itemKind === "due") {
    return i.metadata?.due_date ? `Due: ${fmtDate(i.metadata.due_date)}` : "";
  }
  const s = i.metadata?.start_date ? fmtDate(i.metadata.start_date) : "";
  const e = i.metadata?.end_date ? fmtDate(i.metadata.end_date) : "";
  if (s && e) return `${s} ~ ${e}`;
  return s || e || "";
};

const ListView = ({
  items,
  pendingIds,
  onToggle,
  onNavigate,
}: {
  items: ScheduleItem[];
  pendingIds: Set<string>;
  onToggle: (item: ScheduleItem) => void;
  onNavigate: (id: string) => void;
}) => {
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#030303]/60">
        Nothing here yet
      </div>
    );
  }
  return (
    <ScrollArea className="h-full pr-2">
      <ul className="space-y-1.5">
        {items.map((i) => {
          const dom = primaryDomain(i);
          return (
            <li
              key={i.id}
              className="flex items-center gap-3 rounded-md border border-[#030303]/10 bg-[#fcfcfc]/50 px-3 py-2 hover:border-[#030303]/25 hover:bg-[#fcfcfc]/80 transition-colors"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  dom ? DOMAIN_DOT[dom] : "bg-[#030303]/40",
                )}
                aria-hidden
              />
              <button
                type="button"
                onClick={() => onNavigate(i.id)}
                title="Open node"
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-[#030303]">
                    {i.title}
                  </span>
                  {dom && (
                    <Badge
                      variant="secondary"
                      className={cn("h-4 px-1.5 text-[10px]", DOMAIN_TEXT[dom])}
                    >
                      {DOMAIN_LABEL[dom]}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[#030303]/60">
                  <span className="flex items-center gap-1">
                    <ItemKindIcon kind={i.itemKind} />
                    {itemDateLine(i)}
                  </span>
                </div>
              </button>
              <StatusToggle
                item={i}
                pending={pendingIds.has(i.id)}
                onClick={() => onToggle(i)}
              />
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
};

const StatusToggle = ({
  item,
  pending,
  onClick,
}: {
  item: ScheduleItem;
  pending: boolean;
  onClick: () => void;
}) => {
  const paused = isPaused(item);
  const expired = !paused && isTimeExpired(item);

  const label = paused ? "Paused" : expired ? "Ended" : "Active";
  const nextLabel = paused ? "Activate" : "Pause";
  const Icon = paused ? Play : expired ? CircleSlash : Pause;

  const tone = paused
    ? "bg-[#030303]/10 text-[#030303]/80 hover:bg-[#030303]/20 hover:text-[#030303]"
    : expired
      ? "bg-[#fcfcfc] text-[#030303]/60 hover:bg-[#030303]/[0.08] hover:text-[#030303]"
      : "bg-[#7f8f54]/15 text-[#6a7843] hover:bg-[#7f8f54]/25 hover:text-[#3a5c46]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={`Click to ${nextLabel.toLowerCase()}`}
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors disabled:opacity-60",
        tone,
      )}
    >
      <Icon className="h-3 w-3" />
      {pending ? "Saving…" : label}
    </button>
  );
};

const CalendarView = ({
  items,
  cursor,
  setCursor,
  onNavigate,
}: {
  items: ScheduleItem[];
  cursor: Date;
  setCursor: (d: Date) => void;
  onNavigate: (id: string) => void;
}) => {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<number, ScheduleItem[]>();
    const pushOn = (d: Date, i: ScheduleItem) => {
      if (d.getFullYear() !== year || d.getMonth() !== month) return;
      const day = d.getDate();
      const arr = map.get(day) ?? [];
      if (!arr.some((x) => x.id === i.id)) arr.push(i);
      map.set(day, arr);
    };
    for (const i of items) {
      if (i.itemKind === "window") {
        const s = parseDate(i.metadata?.start_date);
        const e = parseDate(i.metadata?.end_date);
        if (s) pushOn(s, i);
        if (e) pushOn(e, i);
        if (!s && !e && i.effectiveDate) pushOn(i.effectiveDate, i);
      } else if (i.effectiveDate) {
        pushOn(i.effectiveDate, i);
      }
    }
    return map;
  }, [items, year, month]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  // Always pad to 6 rows (42 cells) so grid height stays constant across months
  while (cells.length < 42) cells.push(null);

  const selectedItems = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between px-1">
        <button
          type="button"
          onClick={() => {
            setCursor(new Date(year, month - 1, 1));
            setSelectedDay(null);
          }}
          className="rounded p-1 text-[#030303]/60 hover:bg-[#fcfcfc] hover:text-[#030303]"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-[#030303]">
          {new Date(year, month, 1).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </span>
        <button
          type="button"
          onClick={() => {
            setCursor(new Date(year, month + 1, 1));
            setSelectedDay(null);
          }}
          className="rounded p-1 text-[#030303]/60 hover:bg-[#fcfcfc] hover:text-[#030303]"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-7 gap-1 text-center text-[10px] text-[#030303]/60 mb-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid shrink-0 grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={i} className="h-12 rounded-md bg-transparent" />;
          }
          const dayItems = byDay.get(day) ?? [];
          const active = selectedDay === day;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedDay(day)}
              className={cn(
                "h-12 rounded-md border bg-[#fcfcfc]/50 p-1 text-left transition-colors",
                active
                  ? "border-[#030303]/25"
                  : "border-[#030303]/10 hover:border-[#030303]/25",
              )}
            >
              <div className="text-[11px] text-[#030303]">{day}</div>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {dayItems.slice(0, 4).map((r) => {
                  const dom = primaryDomain(r);
                  return (
                    <span
                      key={r.id}
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        dom ? DOMAIN_DOT[dom] : "bg-[#030303]/40",
                      )}
                    />
                  );
                })}
                {dayItems.length > 4 && (
                  <span className="text-[9px] text-[#030303]/60">
                    +{dayItems.length - 4}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-[#030303]/10 pt-3">
        {selectedDay === null ? (
          <p className="flex h-full items-center justify-center text-center text-xs text-[#030303]/60">
            Pick a date to see its schedules.
          </p>
        ) : selectedItems.length === 0 ? (
          <p className="flex h-full items-center justify-center text-center text-xs text-[#030303]/60">
            Nothing here yet
          </p>
        ) : (
          <>
            <div className="mb-1 shrink-0 text-[11px] text-[#030303]/80">
              {new Date(year, month, selectedDay).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}{" "}
              ({selectedItems.length})
            </div>
            <ScrollArea className="min-h-0 flex-1 pr-2">
              <ul className="space-y-1">
                {selectedItems.map((i) => {
                  const dom = primaryDomain(i);
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => onNavigate(i.id)}
                        title="Open node"
                        className="flex w-full items-center gap-2 rounded border border-[#030303]/10 bg-[#fcfcfc]/50 px-2 py-1.5 text-left hover:border-[#030303]/25 hover:bg-[#fcfcfc]/80 transition-colors"
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            dom ? DOMAIN_DOT[dom] : "bg-[#030303]/40",
                          )}
                        />
                        <span className="flex-1 truncate text-xs text-[#030303]">
                          {i.title}
                        </span>
                        <span className="text-[10px] text-[#030303]/60">
                          {itemDateLine(i).replace(/^.*?: /, "")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
};
