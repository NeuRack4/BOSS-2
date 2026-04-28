// frontend/components/sales/dashboard/tabs/RevenueDetailTab.tsx
"use client"

import { useRef, useEffect, useState } from "react"
import { MessageCircle } from "lucide-react"
import type { CategoryItem, DailyData, PeriodActivation } from "../types"

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString()

const CATEGORY_COLORS: Record<string, string> = {
  음료: "#22c55e",
  음식: "#3b82f6",
  디저트: "#f59e0b",
  기타: "#94a3b8",
}

// ── 카테고리 바 ────────────────────────────────────────────────────────────────
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

// ── 주간 미니 바 차트 ──────────────────────────────────────────────────────────
function WeekMiniChart({ data }: { data: DailyData[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(300)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const maxAmount = Math.max(...data.map(d => d.amount), 1)
  const chartH = 60
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"]
  const barW = (width - 16) / Math.max(data.length, 1)

  return (
    <div ref={containerRef} className="w-full">
      <svg width={width} height={chartH + 20}>
        {data.map((d, i) => {
          const barH = Math.max((d.amount / maxAmount) * chartH, d.amount > 0 ? 3 : 0)
          const x = 8 + i * barW + barW * 0.1
          const y = chartH - barH
          const dayIdx = new Date(d.date).getDay()
          const label = dayLabels[(dayIdx + 6) % 7]
          const isToday = d.date === new Date().toISOString().split("T")[0]

          return (
            <g key={d.date}>
              <rect
                x={x} y={y}
                width={barW * 0.8} height={barH}
                rx={3}
                fill={isToday ? "#3b82f6" : d.isEstimated ? "#94a3b8" : "#60a5fa"}
                opacity={d.isEstimated ? 0.45 : 1}
              />
              <text
                x={x + (barW * 0.8) / 2} y={chartH + 14}
                textAnchor="middle" fontSize={9}
                fill={isToday ? "#3b82f6" : "#94a3b8"}
                fontWeight={isToday ? "bold" : "normal"}
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
      {data.some(d => d.isEstimated) && (
        <p className="text-[10px] text-slate-400">🔵 회색 막대는 추정치 — 매일 기록할수록 정확해져요</p>
      )}
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
type Props = {
  categories: CategoryItem[]
  weeklyData: DailyData[]
  periodActivation: PeriodActivation
  onChatMessage?: (msg: string) => void
}

export function RevenueDetailTab({ categories, weeklyData, periodActivation, onChatMessage }: Props) {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today")
  const [copied, setCopied] = useState(false)
  const handleCTA = (msg: string) => {
    onChatMessage?.(msg)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const todayStr = new Date().toISOString().split("T")[0]
  const todayEntry = weeklyData.find(d => d.date === todayStr)
  const todayTotal = todayEntry?.amount ?? 0
  const weekTotal = weeklyData.reduce((sum, d) => sum + d.amount, 0)
  const weekAvg = weeklyData.length > 0 ? Math.round(weekTotal / weeklyData.length) : 0

  const maxPct = Math.max(...categories.map(c => c.pct), 1)

  const periods = [
    { key: "today" as const, label: "오늘", active: periodActivation.today, tooltip: "" },
    { key: "week" as const, label: "이번주", active: periodActivation.week, tooltip: periodActivation.weekTooltip },
    { key: "month" as const, label: "이번달", active: periodActivation.month, tooltip: periodActivation.monthTooltip },
  ]

  return (
    <div className="space-y-4 p-4">
      {/* 기간 선택 — 파란색 계열로 탭과 구분 */}
      <div className="flex gap-2">
        {periods.map(p => (
          <div key={p.key} className="relative group">
            <button
              disabled={!p.active}
              onClick={() => p.active && setPeriod(p.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                period === p.key
                  ? "bg-blue-500 text-white shadow-sm"
                  : p.active
                  ? "border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
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

      {/* 오늘 뷰 */}
      {period === "today" && (
        <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
          {todayTotal > 0 ? (
            <>
              <p className="text-xs font-medium text-slate-500">오늘 총 매출</p>
              <p className="mt-1 text-2xl font-bold text-slate-800">{fmt(todayTotal)}원</p>
              {weekAvg > 0 && (
                <p className={`mt-1 text-xs font-medium ${todayTotal >= weekAvg ? "text-blue-600" : "text-orange-500"}`}>
                  이번주 일평균 {fmt(weekAvg)}원 대비{" "}
                  {todayTotal >= weekAvg
                    ? `+${fmt(todayTotal - weekAvg)}원 🔼`
                    : `-${fmt(weekAvg - todayTotal)}원 🔽`}
                </p>
              )}
            </>
          ) : (
            <div className="py-4 text-center">
              <p className="text-2xl">☀️</p>
              <p className="mt-2 text-sm font-medium text-slate-600">오늘 아직 매출 기록이 없어요</p>
              <p className="mt-1 text-xs text-slate-400">대시보드 채팅창에서 오늘 매출을 입력해보세요</p>
              {weekAvg > 0 && (
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-600">
                  이번주 일평균 {fmt(weekAvg)}원 — 오늘도 기록하면 추이를 볼 수 있어요
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 이번주 뷰 */}
      {period === "week" && (
        <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
          {weekTotal > 0 ? (
            <>
              <div className="mb-3 flex justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-500">이번 주 총 매출</p>
                  <p className="mt-0.5 text-2xl font-bold text-slate-800">{fmt(weekTotal)}원</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-slate-500">일평균</p>
                  <p className="mt-0.5 text-lg font-semibold text-blue-600">{fmt(weekAvg)}원</p>
                </div>
              </div>
              <WeekMiniChart data={weeklyData} />
              {weeklyData.filter(d => !d.isEstimated).length < 7 && (
                <p className="mt-2 text-[10px] text-slate-400">
                  실제 기록 {weeklyData.filter(d => !d.isEstimated).length}일 / 회색 막대는 평균 추정치
                </p>
              )}
            </>
          ) : (
            <div className="py-4 text-center">
              <p className="text-2xl">📊</p>
              <p className="mt-2 text-sm font-medium text-slate-600">이번주 매출 기록이 없어요</p>
              <p className="mt-1 text-xs text-slate-400">매일 매출을 기록하면 주간 추이를 분석할 수 있어요</p>
            </div>
          )}
        </div>
      )}

      {/* 이번달 뷰 — 카테고리 브레이크다운 */}
      {period === "month" && (
        <>
          {categories.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-3 text-xs font-semibold text-slate-600">이번달 카테고리별 매출 비중</p>
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
        </>
      )}

      {/* 챗 CTA */}
      <button
        onClick={() => handleCTA("매출 데이터를 자세히 분석해줘")}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${
          copied
            ? "border-blue-400 bg-blue-500 text-white"
            : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        {copied ? "✓ 복사됨 — 대시보드 채팅창에 붙여넣기하세요" : "이 데이터 분석 요청하기"}
      </button>
    </div>
  )
}
