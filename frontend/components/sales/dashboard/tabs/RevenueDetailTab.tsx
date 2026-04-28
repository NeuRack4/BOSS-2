// frontend/components/sales/dashboard/tabs/RevenueDetailTab.tsx
"use client"

import { useState } from "react"
import { MessageCircle } from "lucide-react"
import type { CategoryItem, PeriodActivation } from "../types"

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString()

const CATEGORY_COLORS: Record<string, string> = {
  음료: "#22c55e",
  음식: "#3b82f6",
  디저트: "#f59e0b",
  기타: "#94a3b8",
}

function CategoryBar({ item, maxPct }: { item: CategoryItem; maxPct: number }) {
  const color = CATEGORY_COLORS[item.category] ?? "#94a3b8"
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-600">
        <span>{item.category}</span>
        <span className="font-medium">{fmt(item.amount)}원 ({item.pct.toFixed(1)}%)</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${(item.pct / maxPct) * 100}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

type Props = {
  categories: CategoryItem[]
  periodActivation: PeriodActivation
  onChatMessage?: (msg: string) => void
}

export function RevenueDetailTab({ categories, periodActivation, onChatMessage }: Props) {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today")
  const maxPct = Math.max(...categories.map(c => c.pct), 1)

  const periods = [
    { key: "today" as const, label: "오늘", active: periodActivation.today, tooltip: "" },
    { key: "week" as const, label: "이번주", active: periodActivation.week, tooltip: periodActivation.weekTooltip },
    { key: "month" as const, label: "이번달", active: periodActivation.month, tooltip: periodActivation.monthTooltip },
  ]

  return (
    <div className="space-y-4 p-4">
      {/* 기간 선택 */}
      <div className="flex gap-2">
        {periods.map(p => (
          <div key={p.key} className="relative group">
            <button
              disabled={!p.active}
              onClick={() => p.active && setPeriod(p.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                period === p.key
                  ? "bg-green-500 text-white"
                  : p.active
                  ? "border border-slate-200 bg-white text-slate-600 hover:border-green-300"
                  : "cursor-not-allowed border border-slate-100 bg-slate-50 text-slate-300"
              }`}
            >
              {p.label}
            </button>
            {!p.active && p.tooltip && (
              <div className="absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white shadow-lg group-hover:block">
                {p.tooltip}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 카테고리별 매출 비중 */}
      {categories.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-4 text-xs font-semibold text-slate-600">카테고리별 매출 비중</p>
          <div className="space-y-3">
            {categories.map(item => (
              <CategoryBar key={item.category} item={item} maxPct={maxPct} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-400">카테고리 데이터가 없어요</p>
          <p className="mt-1 text-xs text-slate-300">매출을 기록하면 자동으로 분석돼요</p>
        </div>
      )}

      {/* 챗 CTA */}
      <button
        onClick={() => onChatMessage?.("매출 데이터를 자세히 분석해줘")}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-3 text-sm font-medium text-green-700 transition hover:bg-green-100"
      >
        <MessageCircle className="h-4 w-4" />
        이 데이터 분석 요청하기
      </button>
    </div>
  )
}
