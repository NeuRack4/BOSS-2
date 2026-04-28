// frontend/components/marketing/tabs/ActionsTab.tsx
"use client";

import { useState } from "react";
import type { ActionItem } from "../types";

const PRIORITY_META: Record<
  string,
  { label: string; border: string; text: string }
> = {
  high: {
    label: "이번 주",
    border: "border-l-orange-400",
    text: "text-orange-500",
  },
  medium: {
    label: "이번 달",
    border: "border-l-slate-400",
    text: "text-slate-500",
  },
  low: {
    label: "여유 있을 때",
    border: "border-l-slate-300",
    text: "text-slate-400",
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  instagram: "인스타그램",
  youtube: "유튜브",
  content: "콘텐츠",
  general: "전반",
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 6 8 10 12 6" />
    </svg>
  );
}

function ActionCard({ item, index }: { item: ActionItem; index: number }) {
  const [open, setOpen] = useState(false);
  const priority = item.priority ?? "medium";
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;

  return (
    <div
      className={`overflow-hidden rounded-xl border border-slate-200 border-l-[3px] bg-white ${meta.border}`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50/70"
      >
        <span className="w-5 shrink-0 pt-px text-center text-xs font-semibold text-slate-300">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium ${meta.text}`}>
              {meta.label}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-xs text-slate-400">
              {CATEGORY_LABEL[item.category] ?? item.category}
            </span>
            {item.period && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-400">{item.period}</span>
              </>
            )}
          </div>
          <p className="text-sm font-semibold leading-snug text-slate-800">
            {item.title}
          </p>
          {item.target && (
            <p className="mt-1 text-xs text-slate-500">대상 · {item.target}</p>
          )}
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
          {item.idea && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                아이디어
              </p>
              <p className="text-sm leading-relaxed text-slate-700">
                {item.idea}
              </p>
            </div>
          )}
          {item.steps && item.steps.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                실행 방법
              </p>
              <ol className="space-y-2">
                {item.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-slate-700">
                      {step.replace(/^\d+[단계:.\s]+/, "")}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {item.expected && (
            <div className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
              <span className="shrink-0 text-xs font-medium text-slate-400">
                기대효과
              </span>
              <span className="text-sm text-slate-700">{item.expected}</span>
            </div>
          )}
          {item.why && (
            <p className="text-xs leading-relaxed text-slate-400">{item.why}</p>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  actions: ActionItem[];
  loading: boolean;
  loaded: boolean;
};

export function ActionsTab({ actions, loading, loaded }: Props) {
  if (loading) {
    return (
      <div className="space-y-3 p-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-slate-100" />
        ))}
        <p className="text-center text-xs text-slate-400">
          성과 데이터를 분석해 할 일을 생성하고 있어요…
        </p>
      </div>
    );
  }

  if (loaded && actions.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-slate-400">
        할 일 항목을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="py-12 text-center text-sm text-slate-400">
        탭을 클릭하면 AI가 할 일을 생성합니다.
      </div>
    );
  }

  const highItems = actions.filter((a) => a.priority === "high");
  const restItems = actions.filter((a) => a.priority !== "high");

  return (
    <div className="space-y-4 p-4">
      {highItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            이번 주 할 일
          </p>
          {highItems.map((item, i) => (
            <ActionCard key={i} item={item} index={i} />
          ))}
        </div>
      )}
      {restItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {highItems.length > 0 ? "그 다음" : "할 일"}
          </p>
          {restItems.map((item, i) => (
            <ActionCard key={i} item={item} index={highItems.length + i} />
          ))}
        </div>
      )}
    </div>
  );
}
