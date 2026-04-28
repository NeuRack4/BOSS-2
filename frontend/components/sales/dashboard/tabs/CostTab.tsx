// frontend/components/sales/dashboard/tabs/CostTab.tsx
"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import type { OverviewData } from "../types";

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString();

// ── 전월 비교 바 ───────────────────────────────────────────────────────────────
function CompareBar({
  label,
  current,
  prev,
  higherIsBetter,
}: {
  label: string;
  current: number;
  prev: number;
  higherIsBetter: boolean;
}) {
  if (prev === 0) return null;
  const max = Math.max(current, prev, 1);
  const currentPct = (current / max) * 100;
  const prevPct = (prev / max) * 100;
  const changeRate = Math.round(((current - prev) / prev) * 100);
  const isGood = higherIsBetter ? changeRate >= 0 : changeRate <= 0;

  const insight =
    changeRate === 0
      ? `지난달과 동일한 ${label}이에요`
      : isGood
        ? `지난달보다 ${label}이 ${Math.abs(changeRate)}% ${higherIsBetter ? "늘었어요 👏" : "줄었어요 👏"}`
        : `지난달보다 ${label}이 ${Math.abs(changeRate)}% ${higherIsBetter ? "줄었어요 ⚠️" : "늘었어요 ⚠️"}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">
          {label} 전월 비교
        </span>
        <span
          className={`text-xs font-bold ${isGood ? "text-green-600" : "text-red-500"}`}
        >
          {changeRate >= 0 ? "+" : ""}
          {changeRate}%
        </span>
      </div>

      {/* 이번달 */}
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-right text-[10px] text-slate-500">
          이번달
        </span>
        <div className="flex-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isGood ? "bg-green-400" : "bg-red-400"}`}
            style={{ width: `${currentPct}%` }}
          />
        </div>
        <span className="w-16 shrink-0 text-[10px] font-medium text-slate-700">
          {fmt(current)}원
        </span>
      </div>

      {/* 지난달 */}
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-right text-[10px] text-slate-400">
          지난달
        </span>
        <div className="flex-1 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-slate-300 transition-all duration-500"
            style={{ width: `${prevPct}%` }}
          />
        </div>
        <span className="w-16 shrink-0 text-[10px] text-slate-400">
          {fmt(prev)}원
        </span>
      </div>

      {/* 인사이트 문장 */}
      <p
        className={`rounded-lg px-3 py-2 text-xs font-medium ${
          isGood ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}
      >
        {insight}
      </p>
    </div>
  );
}

// ── 수익률 바 ──────────────────────────────────────────────────────────────────
function ProfitRateBar({
  salesTotal,
  costsTotal,
}: {
  salesTotal: number;
  costsTotal: number;
}) {
  if (salesTotal === 0) return null;
  const profitRate = Math.round(((salesTotal - costsTotal) / salesTotal) * 100);
  const safeRate = Math.max(0, Math.min(100, profitRate));

  const rateLabel =
    profitRate >= 40
      ? "우수한 수익률이에요 🎯"
      : profitRate >= 25
        ? "양호한 수익률이에요"
        : profitRate >= 10
          ? "수익률 개선 여지가 있어요"
          : profitRate >= 0
            ? "수익률이 낮아요 — 비용 점검이 필요해요"
            : "이번달 적자 상태예요 ⚠️";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
      <div className="flex justify-between">
        <span className="text-xs font-semibold text-slate-600">
          이번달 수익률
        </span>
        <span
          className={`text-lg font-extrabold ${profitRate >= 0 ? "text-green-600" : "text-red-500"}`}
        >
          {profitRate}%
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-500 ${profitRate >= 25 ? "bg-green-400" : profitRate >= 0 ? "bg-yellow-400" : "bg-red-400"}`}
          style={{ width: `${safeRate}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>매출 {fmt(salesTotal)}원</span>
        <span>비용 {fmt(costsTotal)}원</span>
      </div>
      <p className="text-xs text-slate-500">{rateLabel}</p>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
type Props = {
  overview: OverviewData | null;
  onChatMessage?: (msg: string) => void;
};

export function CostTab({ overview, onChatMessage }: Props) {
  const [copied, setCopied] = useState(false);
  const handleCTA = (msg: string) => {
    onChatMessage?.(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!overview) {
    return (
      <div className="p-8 text-center">
        <p className="text-2xl">💰</p>
        <p className="mt-2 text-sm font-medium text-slate-600">
          비용 데이터가 없어요
        </p>
        <p className="mt-1 text-xs text-slate-400">
          챗봇으로 원자재·인건비 등을 기록하면 수익률 분석이 가능해요
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* 수익률 */}
      <ProfitRateBar
        salesTotal={overview.sales.total}
        costsTotal={overview.costs.total}
      />

      {/* 비용 전월 비교 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <CompareBar
          label="비용"
          current={overview.costs.total}
          prev={overview.costs.prev_total}
          higherIsBetter={false}
        />
        {overview.costs.total > 0 && overview.profit.total !== undefined && (
          <>
            <div className="border-t border-slate-100" />
            <CompareBar
              label="순이익"
              current={overview.profit.total}
              prev={overview.profit.prev_total}
              higherIsBetter={true}
            />
          </>
        )}
      </div>

      {/* 챗 CTA */}
      <button
        onClick={() => handleCTA("비용을 줄일 수 있는 방법을 알려줘")}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${
          copied
            ? "border-green-400 bg-green-500 text-white"
            : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        {copied
          ? "✓ 복사됨 — 대시보드 채팅창에 붙여넣기하세요"
          : "비용 절감 방법 물어보기"}
      </button>
    </div>
  );
}
