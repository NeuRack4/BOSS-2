// frontend/components/sales/dashboard/tabs/CostTab.tsx
"use client"

import { MessageCircle } from "lucide-react"
import type { OverviewData } from "../types"

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString()

function StatCard({ label, value, changeRate }: { label: string; value: number; changeRate: number | null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-800">{fmt(value)}원</p>
      {changeRate != null && (
        <p className={`mt-1 text-xs ${changeRate >= 0 ? "text-red-500" : "text-green-600"}`}>
          {changeRate >= 0 ? "+" : ""}{changeRate.toFixed(1)}% 전월 대비
        </p>
      )}
    </div>
  )
}

function ProfitRateBar({ salesTotal, costsTotal }: { salesTotal: number; costsTotal: number }) {
  if (salesTotal === 0) return null
  const profitRate = Math.round(((salesTotal - costsTotal) / salesTotal) * 100)
  const safeRate = Math.max(0, Math.min(100, profitRate))

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex justify-between text-xs text-slate-600 mb-2">
        <span className="font-semibold">이번달 수익률</span>
        <span className={`font-bold ${profitRate >= 0 ? "text-green-600" : "text-red-500"}`}>
          {profitRate}%
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-green-400 transition-all duration-500"
          style={{ width: `${safeRate}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
        <span>매출 {fmt(salesTotal)}원</span>
        <span>비용 {fmt(costsTotal)}원</span>
      </div>
    </div>
  )
}

type Props = {
  overview: OverviewData | null
  onChatMessage?: (msg: string) => void
}

export function CostTab({ overview, onChatMessage }: Props) {
  if (!overview) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-slate-400">비용 데이터가 없어요</p>
        <p className="mt-1 text-xs text-slate-300">챗봇으로 원자재 비용을 입력해보세요</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="이번달 비용" value={overview.costs.total} changeRate={overview.costs.change_rate} />
        <StatCard label="이번달 순이익" value={overview.profit.total} changeRate={overview.profit.change_rate} />
      </div>

      <ProfitRateBar salesTotal={overview.sales.total} costsTotal={overview.costs.total} />

      <button
        onClick={() => onChatMessage?.("비용을 줄일 수 있는 방법을 알려줘")}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-3 text-sm font-medium text-green-700 transition hover:bg-green-100"
      >
        <MessageCircle className="h-4 w-4" />
        비용 절감 방법 물어보기
      </button>
    </div>
  )
}
