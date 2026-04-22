"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Download, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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
  target: string | null;
  description: string | null;
  hashtags: string[] | null;
  start_date: string | null;
  end_date: string | null;
  period_raw: string | null;
  is_ongoing: boolean;
  detail_url: string | null;
  external_url: string | null;
  form_files: FormFile[];
};

const formatPeriod = (item: SubsidyItem): string => {
  if (item.is_ongoing) return "상시";
  if (item.end_date) return `~${item.end_date.slice(5).replace("-", "/")}`;
  if (item.period_raw) return item.period_raw.slice(0, 20);
  return "기간 미정";
};

const POLL_INTERVAL_MS = 3000;

export const SubsidyMatchCard = ({ accountId }: { accountId: string }) => {
  const [items, setItems] = useState<SubsidyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SubsidyItem | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    let cancel = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/subsidies/cache?account_id=${accountId}`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (cancel) return;

        if (json?.is_computing) {
          // 아직 계산 중 — 폴링
          setLoading(true);
          pollTimer = setTimeout(load, POLL_INTERVAL_MS);
        } else {
          setItems(json?.data ?? []);
          setLoading(false);
        }
      } catch {
        if (!cancel) {
          setItems([]);
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancel = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [apiBase, accountId]);

  const openModal = () =>
    window.dispatchEvent(new CustomEvent("boss:open-subsidy-modal"));

  const handleDownload = (e: React.MouseEvent, item: SubsidyItem) => {
    e.stopPropagation();
    if (item.form_files?.length > 0) {
      window.open(item.form_files[0].storage_url, "_blank");
    } else if (item.detail_url) {
      window.open(item.detail_url, "_blank");
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openModal}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openModal();
        }
      }}
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] bg-[#e8f0e4] p-5 text-left text-[#030303] shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold tracking-tight text-[#030303]">
            Subsidy Matches
          </span>
          {items.length > 0 && (
            <span className="rounded-full bg-[#4a7c59] px-2 py-0.5 text-[11px] font-semibold text-white">
              {items.length}
            </span>
          )}
        </div>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/40">
          Loading…
        </div>
      ) : selected ? (
        /* 상세 뷰 */
        <div className="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(null);
            }}
            className="mb-2 flex items-center gap-1 text-[11px] text-[#030303]/50 hover:text-[#030303] transition-colors"
          >
            ← Back
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto space-y-1.5">
            <div className="text-[12.5px] font-semibold text-[#030303] leading-snug">
              {selected.title}
            </div>
            <div className="flex flex-wrap gap-2 text-[10.5px] text-[#030303]/60">
              {selected.organization && <span>{selected.organization}</span>}
              {selected.region && (
                <span className="rounded bg-[#e8f0e4] px-1.5 py-0.5 text-[#4a7c59] font-medium">
                  {selected.region}
                </span>
              )}
              <span className="font-semibold text-[#4a7c59]">
                {formatPeriod(selected)}
              </span>
            </div>
            {selected.target && (
              <div className="text-[11px] text-[#030303]/60">
                <span className="font-medium">대상 </span>
                {selected.target}
              </div>
            )}
            {selected.description && (
              <p className="text-[11.5px] leading-relaxed text-[#030303]/80">
                {selected.description}
              </p>
            )}
            {Array.isArray(selected.hashtags) &&
              selected.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {selected.hashtags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-[#e8f0e4] px-2 py-0.5 text-[10px] text-[#4a7c59]"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            <div className="flex gap-1.5 pt-1">
              {selected.form_files?.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(selected.form_files[0].storage_url, "_blank");
                  }}
                  className="flex items-center gap-1 rounded-[5px] bg-[#4a7c59] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#3d6a4a] transition-colors"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              )}
              {selected.external_url && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(selected.external_url!, "_blank");
                  }}
                  className="flex items-center gap-1 rounded-[5px] border border-[#4a7c59]/50 bg-white px-2.5 py-1 text-[11px] font-medium text-[#4a7c59] hover:bg-[#e8f0e4] transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> Apply
                </button>
              )}
            </div>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[#030303]/40">
          Nothing here yet
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(item);
                }}
                className="flex w-full items-start gap-2 rounded-[5px] bg-white/60 px-3 py-2 text-left transition-colors hover:bg-white/90"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-[#030303]">
                    {item.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.organization && (
                      <span className="truncate text-[11px] text-[#030303]/60">
                        {item.organization}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] font-semibold text-[#4a7c59]">
                      {formatPeriod(item)}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
