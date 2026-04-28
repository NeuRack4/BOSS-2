// frontend/components/sales/dashboard/tabs/RevenueDetailTab.tsx
"use client"

import { useState } from "react"
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

// ── 이번달 예상 마감 카드 ──────────────────────────────────────────────────────
function MonthProjectionCard({ categories }: { categories: CategoryItem[] }) {
  const now = new Date()
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const elapsedDays = now.getDate()
  const remainingDays = totalDays - elapsedDays
  const currentTotal = categories.reduce((sum, c) => sum + c.amount, 0)

  if (currentTotal === 0) return null

  const dailyAvg = Math.round(currentTotal / elapsedDays)
  const projected = Math.round(dailyAvg * totalDays)
  const progressPct = Math.min(Math.round((elapsedDays / totalDays) * 100), 100)
  const pacePct = Math.round((currentTotal / projected) * 100)

  const paceLabel =
    pacePct >= 110 ? "🚀 목표 초과 페이스" :
    pacePct >= 95  ? "✅ 순조로운 페이스" :
    pacePct >= 80  ? "⚠️ 다소 느린 페이스" : "🔴 주의 필요"

  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4 shadow-sm">
      <p className="mb-3 text-xs font-bold text-indigo-700">📅 이번달 예상 마감 매출</p>

      {/* 현재 vs 예상 */}
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] text-indigo-500">지금까지 ({elapsedDays}일 경과)</p>
          <p className="text-xl font-bold text-indigo-900">{fmt(currentTotal)}원</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-500">현재 페이스 마감 예상</p>
          <p className="text-2xl font-extrabold text-indigo-700">{fmt(projected)}원</p>
        </div>
      </div>

      {/* 진행 바 */}
      <div className="relative mb-1 h-3 w-full overflow-hidden rounded-full bg-indigo-100">
        <div
          className="h-full rounded-full bg-indigo-400 transition-all duration-700"
          style={{ width: `${progressPct}%` }}
        />
        {/* 현재 위치 마커 */}
        <div
          className="absolute top-0 h-full w-0.5 bg-indigo-700"
          style={{ left: `${progressPct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-indigo-400">
        <span>1일</span>
        <span className="font-medium text-indigo-600">{elapsedDays}일째 ↑ {remainingDays}일 남음</span>
        <span>{totalDays}일</span>
      </div>

      {/* 일평균 + 페이스 */}
      <div className="mt-3 flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
        <div>
          <p className="text-[10px] text-slate-500">일평균 매출</p>
          <p className="text-sm font-bold text-slate-700">{fmt(dailyAvg)}원/일</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-indigo-600">{paceLabel}</p>
        </div>
      </div>
    </div>
  )
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

// ── 주간 상세 뷰 ───────────────────────────────────────────────────────────────
function WeekDetailView({ data }: { data: DailyData[] }) {
  const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"]
  const todayStr = new Date().toISOString().split("T")[0]
  const maxAmount = Math.max(...data.map(d => d.amount), 1)
  const realDays = data.filter(d => !d.isEstimated)
  const recordedCount = realDays.length

  // 최고 매출 요일
  const bestEntry = [...data].sort((a, b) => b.amount - a.amount)[0]

  // 추세: 전반부(처음 3일) vs 후반부(마지막 3일) 평균 비교
  const firstHalf = data.slice(0, 3).reduce((s, d) => s + d.amount, 0) / 3
  const lastHalf = data.slice(4, 7).reduce((s, d) => s + d.amount, 0) / 3
  const trend = lastHalf > firstHalf * 1.05 ? "up" : lastHalf < firstHalf * 0.95 ? "down" : "flat"

  return (
    <div className="space-y-3">
      {/* 요일별 테이블 */}
      <div className="space-y-1.5">
        {data.map(d => {
          const dayIdx = new Date(d.date).getDay()
          const label = DAY_LABELS[(dayIdx + 6) % 7]
          const mmdd = d.date.slice(5).replace("-", "/")
          const isToday = d.date === todayStr
          const isBest = d.date === bestEntry?.date && d.amount > 0
          const barPct = (d.amount / maxAmount) * 100

          return (
            <div
              key={d.date}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                isToday ? "bg-blue-50" : "bg-slate-50"
              }`}
            >
              {/* 요일 + 날짜 */}
              <div className="w-14 shrink-0">
                <span className={`text-xs font-bold ${isToday ? "text-blue-600" : "text-slate-600"}`}>
                  {label}
                </span>
                <span className="ml-1 text-[10px] text-slate-400">{mmdd}</span>
              </div>

              {/* 인라인 바 */}
              <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${barPct}%`,
                    backgroundColor: d.isEstimated ? "#94a3b8" : isToday ? "#3b82f6" : "#60a5fa",
                    opacity: d.isEstimated ? 0.5 : 1,
                  }}
                />
              </div>

              {/* 금액 */}
              <div className="w-20 shrink-0 text-right">
                <span className={`text-xs font-semibold ${
                  d.isEstimated ? "text-slate-400" : isToday ? "text-blue-700" : "text-slate-700"
                }`}>
                  {d.amount > 0 ? `${fmt(d.amount)}원` : "—"}
                </span>
              </div>

              {/* 배지 */}
              <div className="w-10 shrink-0 text-right">
                {isBest && <span className="text-yellow-400 text-xs">★</span>}
                {isToday && !isBest && <span className="text-[9px] text-blue-500 font-bold">오늘</span>}
                {d.isEstimated && !isToday && (
                  <span className="text-[9px] text-slate-400">추정</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 기록 현황 */}
      <div className="rounded-lg bg-slate-50 px-3 py-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-slate-600">이번주 기록 현황</span>
          <span className="text-xs font-bold text-blue-600">{recordedCount}/7일</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-400 transition-all duration-500"
            style={{ width: `${(recordedCount / 7) * 100}%` }}
          />
        </div>
        {recordedCount < 7 && (
          <p className="mt-1.5 text-[10px] text-slate-400">
            {7 - recordedCount}일 더 기록하면 완주 — 매일 기록할수록 AI 분석이 정확해져요
          </p>
        )}
      </div>

      {/* 추세 */}
      {recordedCount >= 3 && (
        <div className={`rounded-lg px-3 py-2 text-xs font-medium ${
          trend === "up" ? "bg-blue-50 text-blue-700" :
          trend === "down" ? "bg-orange-50 text-orange-600" :
          "bg-slate-50 text-slate-600"
        }`}>
          {trend === "up" && "📈 이번주 후반으로 갈수록 매출이 오르고 있어요"}
          {trend === "down" && "📉 이번주 후반으로 갈수록 매출이 줄고 있어요"}
          {trend === "flat" && "➡️ 이번주 매출이 안정적으로 유지되고 있어요"}
        </div>
      )}

      {/* 최고 요일 */}
      {bestEntry && bestEntry.amount > 0 && !bestEntry.isEstimated && (
        <div className="flex items-center gap-2 rounded-lg bg-yellow-50 px-3 py-2">
          <span className="text-yellow-500">★</span>
          <span className="text-xs text-yellow-700">
            이번주 최고 매출: {DAY_LABELS[(new Date(bestEntry.date).getDay() + 6) % 7]}요일{" "}
            <strong>{fmt(bestEntry.amount)}원</strong>
          </span>
        </div>
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
  const [period, setPeriod] = useState<"today" | "week" | "month">("month")
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
          {weeklyData.length > 0 ? (
            <>
              {/* 요약 수치 */}
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-blue-50 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-blue-500">이번주 총 매출</p>
                  <p className="mt-0.5 text-lg font-bold text-blue-800">{fmt(weekTotal)}원</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-slate-500">일평균</p>
                  <p className="mt-0.5 text-lg font-bold text-slate-700">{fmt(weekAvg)}원</p>
                </div>
              </div>
              {/* 요일별 상세 */}
              <WeekDetailView data={weeklyData} />
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

      {/* 이번달 뷰 — 예상 마감 카드 + 카테고리 브레이크다운 */}
      {period === "month" && (
        <>
          {/* 예상 월 마감 매출 카드 */}
          <MonthProjectionCard categories={categories} />

          {/* 카테고리별 비중 */}
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
