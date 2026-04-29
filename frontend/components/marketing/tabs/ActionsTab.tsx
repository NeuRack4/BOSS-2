// frontend/components/marketing/tabs/ActionsTab.tsx
"use client";

import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import {
  InstagramPostCard,
  type InstagramPayload,
} from "@/components/chat/InstagramPostCard";
import type { ActionItem } from "../types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const PRIORITY_META: Record<
  string,
  {
    label: string;
    border: string;
    text: string;
    chip: string;
    number: string;
    glow: string;
  }
> = {
  high: {
    label: "\uc774\ubc88 \uc8fc",
    border: "border-l-orange-400",
    text: "text-orange-500",
    chip: "border-orange-200 bg-orange-50 text-orange-600",
    number: "bg-orange-100 text-orange-600",
    glow: "hover:border-orange-200 hover:shadow-orange-100/80",
  },
  medium: {
    label: "\uc774\ubc88 \ub2ec",
    border: "border-l-slate-400",
    text: "text-slate-500",
    chip: "border-slate-200 bg-slate-100 text-slate-600",
    number: "bg-slate-100 text-slate-600",
    glow: "hover:border-slate-300 hover:shadow-slate-100",
  },
  low: {
    label: "\uc5ec\uc720 \uc788\uc744 \ub54c",
    border: "border-l-slate-300",
    text: "text-slate-400",
    chip: "border-slate-200 bg-white text-slate-500",
    number: "bg-slate-50 text-slate-400",
    glow: "hover:border-slate-300 hover:shadow-slate-100",
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  instagram: "\uc778\uc2a4\ud0c0\uadf8\ub7a8",
  youtube: "\uc720\ud29c\ube0c",
  content: "\ucf58\ud150\uce20",
  general: "\uc77c\ubc18",
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

function ActionCard({
  item,
  index,
  accountId,
}: {
  item: ActionItem;
  index: number;
  accountId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<InstagramPayload | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const priority = item.priority ?? "medium";
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;
  const actionText = [
    item.category,
    item.title,
    item.target,
    item.idea,
    ...(item.steps ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const canPreviewInstagram =
    item.category === "instagram" ||
    actionText.includes("instagram") ||
    actionText.includes("인스타");

  const handleInstagramPreview = async () => {
    if (generating) return;
    if (!accountId) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/marketing/instagram/example`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          title: item.title,
          target: item.target,
          idea: item.idea,
          steps: item.steps ?? [],
          expected: item.expected,
          period: item.period,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) {
        throw new Error(json?.error || "인스타그램 예시 생성에 실패했습니다.");
      }
      setPreview(json.data as InstagramPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "인스타그램 예시 생성에 실패했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className={`group overflow-hidden rounded-xl border border-slate-200 border-l-[4px] bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${meta.border} ${meta.glow}`}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-slate-50/70"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${meta.number}`}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}
            >
              {meta.label}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {CATEGORY_LABEL[item.category] ?? item.category}
            </span>
            {item.period && (
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                {item.period}
              </span>
            )}
          </div>
          <p className="text-[15px] font-semibold leading-snug text-slate-900">
            {item.title}
          </p>
          {item.target && (
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              <span className="font-semibold text-slate-600">{"\ub300\uc0c1"}</span>
              <span className="px-1 text-slate-300">/</span>
              {item.target}
            </p>
          )}
        </div>
        <span className="mt-1 rounded-full p-1 transition-colors group-hover:bg-slate-100">
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 bg-slate-50/40 px-4 pb-4 pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            {item.idea && (
              <section className="rounded-lg border border-slate-100 bg-white p-3">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {"\uc544\uc774\ub514\uc5b4"}
                </p>
                <p className="text-sm leading-relaxed text-slate-700">
                  {item.idea}
                </p>
              </section>
            )}
            {item.expected && (
              <section className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-600/70">
                  {"\uae30\ub300\ud6a8\uacfc"}
                </p>
                <p className="text-sm leading-relaxed text-slate-700">
                  {item.expected}
                </p>
              </section>
            )}
          </div>
          {item.steps && item.steps.length > 0 && (
            <section className="rounded-lg border border-slate-100 bg-white p-3">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {"\uc2e4\ud589 \ubc29\ubc95"}
              </p>
              <ol className="space-y-2.5">
                {item.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <span className="pt-0.5 text-sm leading-relaxed text-slate-700">
                      {step.replace(/^\d+[?④퀎:.\s]+/, "")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {item.why && (
            <p className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-500">
              {item.why}
            </p>
          )}
          {canPreviewInstagram && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleInstagramPreview}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Camera className="h-3.5 w-3.5" />
                )}
                {generating ? "예시 생성 중" : "인스타그램 예시보기"}
              </button>
              {error && <p className="text-xs text-red-500">{error}</p>}
              {preview && (
                <div className="flex justify-center rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <InstagramPostCard payload={preview} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  accountId?: string;
  actions: ActionItem[];
  loading: boolean;
  loaded: boolean;
};

export function ActionsTab({ accountId, actions, loading, loaded }: Props) {
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
    <div className="space-y-6 p-4">
      {highItems.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-orange-400" />
              <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
                {"\uc774\ubc88 \uc8fc \ud560 \uc77c"}
              </p>
            </div>
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-600">
              {highItems.length}
            </span>
          </div>
          <div className="space-y-3">
            {highItems.map((item, i) => (
              <ActionCard key={i} item={item} index={i} accountId={accountId} />
            ))}
          </div>
        </section>
      )}
      {restItems.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                {highItems.length > 0 ? "\uadf8 \ub2e4\uc74c" : "\ud560 \uc77c"}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              {restItems.length}
            </span>
          </div>
          <div className="space-y-3">
            {restItems.map((item, i) => (
              <ActionCard
                key={i}
                item={item}
                index={highItems.length + i}
                accountId={accountId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
