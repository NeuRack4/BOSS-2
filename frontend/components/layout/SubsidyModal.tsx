"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Search,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";

type FormFile = {
  filename: string;
  file_type: string;
  storage_url: string;
};

type SubsidyItem = {
  id: string;
  title: string;
  organization: string | null;
  region: string | null;
  program_kind: string | null;
  sub_kind: string | null;
  target: string | null;
  start_date: string | null;
  end_date: string | null;
  period_raw: string | null;
  is_ongoing: boolean;
  description: string | null;
  detail_url: string | null;
  external_url: string | null;
  form_files: FormFile[];
};

const formatPeriod = (item: SubsidyItem): string => {
  if (item.is_ongoing) return "상시";
  if (item.start_date && item.end_date)
    return `${item.start_date.slice(2)} ~ ${item.end_date.slice(2)}`;
  if (item.end_date) return `~ ${item.end_date}`;
  if (item.period_raw) return item.period_raw;
  return "기간 미정";
};

const getDdayLabel = (
  item: SubsidyItem,
): { label: string; tone: string } | null => {
  if (!item.end_date || item.is_ongoing) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil(
    (new Date(item.end_date).getTime() - today.getTime()) / 86400000,
  );
  if (diff < 0) return null;
  if (diff === 0)
    return { label: "D-Day", tone: "bg-[#e9c9c0] text-[#8a3a28]" };
  if (diff <= 3)
    return { label: `D-${diff}`, tone: "bg-[#efdfc8] text-[#8a6a2c]" };
  if (diff <= 7)
    return { label: `D-${diff}`, tone: "bg-[#eee5d0] text-[#6a5a36]" };
  return null;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export const SubsidyModal = ({ open, onClose }: Props) => {
  const [items, setItems] = useState<SubsidyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  const fetchItems = async (q: string) => {
    setLoading(true);
    try {
      const url = q.trim()
        ? `${apiBase}/api/subsidies/search?q=${encodeURIComponent(q)}&limit=200`
        : `${apiBase}/api/subsidies/search?limit=200`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setItems(json?.data ?? []);
      setTotal(json?.meta?.total ?? 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    fetchItems("");
    setQuery("");
    setKindFilter(null);
  }, [open]);

  const handleQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchItems(v), 300);
  };

  const handleDownload = (item: SubsidyItem, file?: FormFile) => {
    const target = file ?? item.form_files?.[0];
    if (target) window.open(target.storage_url, "_blank");
    else if (item.detail_url) window.open(item.detail_url, "_blank");
  };

  const kinds = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      if (i.program_kind) set.add(i.program_kind);
    });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(
    () =>
      kindFilter ? items.filter((i) => i.program_kind === kindFilter) : items,
    [items, kindFilter],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Government Subsidies"
      widthClass="w-[880px]"
      variant="dashboard"
    >
      {/* Fixed toolbar */}
      <div className="flex flex-col gap-2">
        {/* Row 1: search + filter dropdown */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#030303]/40" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search subsidies…"
              className="w-full rounded-[5px] border border-[#ddd0b4] bg-white/70 py-2 pl-9 pr-9 text-[13px] text-[#030303] placeholder:text-[#030303]/40 focus:outline-none focus:ring-1 focus:ring-[#4a7c59]"
            />
            {query && (
              <button
                type="button"
                onClick={() => handleQueryChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#030303]/40 hover:text-[#030303]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {kinds.length > 0 && (
            <select
              value={kindFilter ?? ""}
              onChange={(e) => setKindFilter(e.target.value || null)}
              className="shrink-0 rounded-[5px] border border-[#ddd0b4] bg-white/70 py-2 pl-3 pr-7 text-[12px] text-[#030303] focus:outline-none focus:ring-1 focus:ring-[#4a7c59] appearance-none cursor-pointer"
            >
              <option value="">All categories</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Row 2: count */}
        <div className="text-[11px] text-[#030303]/50">
          {loading ? "검색 중…" : `${filtered.length}개 공고`}
        </div>
      </div>

      {/* Scrollable list — explicit height so ScrollArea works */}
      <div className="mt-2 h-[490px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/40">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/40">
            Nothing here yet
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="space-y-2 pr-3">
              {filtered.map((item) => {
                const dday = getDdayLabel(item);
                const isExpanded = expandedId === item.id;
                return (
                  <div
                    key={item.id}
                    className="rounded-[5px] border border-[#ddd0b4]/60 bg-white/60"
                  >
                    {/* 헤더 — 클릭 시 토글 */}
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-[#030303]">
                            {item.title}
                          </span>
                          {dday && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${dday.tone}`}
                            >
                              {dday.label}
                            </span>
                          )}
                          {item.region && (
                            <span className="rounded bg-[#e8f0e4] px-1.5 py-0.5 text-[10px] font-medium text-[#4a7c59]">
                              {item.region}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[#030303]/60">
                          {item.organization && (
                            <span>{item.organization}</span>
                          )}
                          <span>{formatPeriod(item)}</span>
                          {!isExpanded && item.target && (
                            <span>대상: {item.target}</span>
                          )}
                        </div>
                        {!isExpanded && item.description && (
                          <p className="mt-1 line-clamp-1 text-[11px] text-[#030303]/60">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <div className="mt-0.5 shrink-0 text-[#030303]/40">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </div>
                    </button>

                    {/* 확장 패널 */}
                    {isExpanded && (
                      <div className="border-t border-[#ddd0b4]/40 px-4 pb-4 pt-3 space-y-2.5">
                        {item.target && (
                          <div className="text-[12px] text-[#030303]/70">
                            <span className="font-medium text-[#030303]">
                              지원 대상{" "}
                            </span>
                            {item.target}
                          </div>
                        )}
                        {item.description && (
                          <p className="text-[12.5px] leading-relaxed text-[#030303]/80">
                            {item.description}
                          </p>
                        )}
                        {Array.isArray(item.hashtags) &&
                          item.hashtags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {item.hashtags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded-full bg-[#e8f0e4] px-2 py-0.5 text-[10px] text-[#4a7c59]"
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}
                        {item.form_files?.length > 1 && (
                          <div className="flex flex-wrap gap-1.5">
                            {item.form_files.map((f) => (
                              <button
                                key={f.storage_url}
                                type="button"
                                onClick={() => handleDownload(item, f)}
                                className="flex items-center gap-1 rounded border border-[#4a7c59]/40 bg-[#e8f0e4] px-2 py-0.5 text-[10px] font-medium text-[#4a7c59] hover:bg-[#4a7c59]/20 transition-colors"
                              >
                                <Download className="h-2.5 w-2.5" />
                                {f.filename}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-1.5 pt-0.5">
                          {item.form_files?.length >= 1 && (
                            <button
                              type="button"
                              onClick={() => handleDownload(item)}
                              className="flex items-center gap-1.5 rounded-[5px] bg-[#4a7c59] px-3 py-1.5 text-[11px] font-medium text-white hover:bg-[#3d6a4a] transition-colors"
                            >
                              <Download className="h-3 w-3" /> Download
                            </button>
                          )}
                          {item.external_url ? (
                            <button
                              type="button"
                              onClick={() =>
                                window.open(item.external_url!, "_blank")
                              }
                              className="flex items-center gap-1.5 rounded-[5px] border border-[#4a7c59]/50 bg-white px-3 py-1.5 text-[11px] font-medium text-[#4a7c59] hover:bg-[#e8f0e4] transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" /> Apply
                            </button>
                          ) : item.detail_url ? (
                            <button
                              type="button"
                              onClick={() =>
                                window.open(item.detail_url!, "_blank")
                              }
                              className="flex items-center gap-1.5 rounded-[5px] border border-[#ddd0b4] bg-white px-3 py-1.5 text-[11px] font-medium text-[#030303]/70 hover:bg-[#f4f1ed] transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" /> View
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
