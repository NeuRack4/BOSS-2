// frontend/components/sales/dashboard/tabs/OverviewTab.tsx
"use client"

import { useRef, useEffect, useState } from "react"
import { MessageCircle } from "lucide-react"
import type { DashboardState } from "../types"

// ── 숫자 포맷 유틸 ─────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n >= 10_000_000
    ? `${(n / 10_000_000).toFixed(1)}천만`
    : n >= 10_000
    ? `${(n / 10_000).toFixed(1)}만`
    : n.toLocaleString()

// ── 주간 바 차트 ───────────────────────────────────────────────────────────────
function WeeklyBarChart({ data }: { data: { date: string; amount: number; isEstimated: boolean }[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(300)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const maxAmount = Math.max(...data.map(d => d.amount), 1)
  const chartH = 72
  const dayLabels = ["월", "화", "수", "목", "금", "토", "일"]
  const barW = (width - 32) / Math.max(data.length, 1)

  return (
    <div ref={containerRef} className="w-full">
      <svg width={width} height={chartH + 34}>
        {data.map((d, i) => {
          const barH = Math.max((d.amount / maxAmount) * chartH, d.amount > 0 ? 3 : 0)
          const x = 16 + i * barW + barW * 0.15
          const y = chartH - barH
          const dayIdx = new Date(d.date).getDay()
          const label = dayLabels[(dayIdx + 6) % 7]

          const amountLabel = d.amount >= 10_000
            ? `${(d.amount / 10_000).toFixed(1)}만`
            : d.amount > 0 ? `${d.amount.toLocaleString()}` : ""

          return (
            <g key={d.date}>
              <rect
                x={x} y={y}
                width={barW * 0.7} height={barH}
                rx={3}
                fill={d.isEstimated ? "#94a3b8" : "#22c55e"}
                opacity={d.isEstimated ? 0.45 : 1}
              />
              {/* 금액 레이블 — 막대 위 */}
              {d.amount > 0 && (
                <text
                  x={x + (barW * 0.7) / 2}
                  y={Math.max(y - 3, 8)}
                  textAnchor="middle"
                  fontSize={8}
                  fill={d.isEstimated ? "#94a3b8" : "#15803d"}
                >
                  {amountLabel}
                </text>
              )}
              {/* 요일 레이블 — 막대 아래 */}
              <text
                x={x + (barW * 0.7) / 2} y={chartH + 16}
                textAnchor="middle"
                fontSize={10}
                fill="#94a3b8"
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
      {data.some(d => d.isEstimated) && (
        <p className="mt-1 text-[10px] text-slate-400">
          🔵 추정 데이터 포함 — 내 기록 기반 평균치
        </p>
      )}
    </div>
  )
}

// ── 목표 달성률 링 ─────────────────────────────────────────────────────────────
function GoalRing({ percent, hasGoal }: { percent: number; hasGoal: boolean }) {
  const r = 38
  const circumference = 2 * Math.PI * r
  const safePercent = Math.min(Math.max(percent, 0), 100)
  const dashoffset = circumference - (safePercent / 100) * circumference

  if (!hasGoal) {
    return (
      <svg width={96} height={96} viewBox="0 0 96 96">
        <circle
          cx={48} cy={48} r={r}
          fill="none" stroke="#e2e8f0" strokeWidth={8}
          strokeDasharray="6 4"
        />
        <text x={48} y={44} textAnchor="middle" fontSize={11} fill="#94a3b8">목표</text>
        <text x={48} y={60} textAnchor="middle" fontSize={10} fill="#94a3b8">미설정</text>
      </svg>
    )
  }

  return (
    <svg width={96} height={96} viewBox="0 0 96 96">
      <circle cx={48} cy={48} r={r} fill="none" stroke="#e2e8f0" strokeWidth={8} />
      <circle
        cx={48} cy={48} r={r}
        fill="none"
        stroke="#22c55e"
        strokeWidth={8}
        strokeDasharray={circumference}
        strokeDashoffset={dashoffset}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
      />
      <text x={48} y={44} textAnchor="middle" fontSize={15} fontWeight="bold" fill="#1e293b">
        {safePercent}%
      </text>
      <text x={48} y={60} textAnchor="middle" fontSize={9} fill="#94a3b8">
        달성
      </text>
    </svg>
  )
}

// ── 온보딩 체크리스트 (Stage 0) ────────────────────────────────────────────────
function OnboardingChecklist({ onChatClick }: { onChatClick: (msg: string) => void }) {
  const items = [
    { label: "첫 매출 기록하기", msg: "오늘 매출을 입력하고 싶어요" },
    { label: "메뉴 등록하기", msg: "메뉴를 등록하고 싶어요" },
    { label: "이번달 목표 설정하기", msg: "이번달 매출 목표를 설정하고 싶어요" },
  ]

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-slate-700">시작해볼까요? 🌱</p>
      {items.map(item => (
        <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-sm text-slate-600">{item.label}</span>
          <button
            onClick={() => onChatClick(item.msg)}
            className="flex items-center gap-1.5 rounded-md bg-green-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-600"
          >
            <MessageCircle className="h-3 w-3" />
            입력하기
          </button>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
        <GoalRing percent={0} hasGoal={false} />
        <span>이번달 목표: 미설정</span>
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
type Props = {
  state: DashboardState
  onChatMessage?: (msg: string) => void
}

export function OverviewTab({ state, onChatMessage }: Props) {
  const [copied, setCopied] = useState(false)

  const handleChat = (msg: string) => {
    onChatMessage?.(msg)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Stage 0: 온보딩
  if (state.stage === 0) {
    return (
      <div className="p-4">
        <OnboardingChecklist onChatClick={handleChat} />
      </div>
    )
  }

  const goalPercent = state.goal?.achievement_rate != null
    ? Math.round(state.goal.achievement_rate)
    : 0

  const changeRateText = state.todayChangeRate != null
    ? `${state.todayChangeRate >= 0 ? "+" : ""}${state.todayChangeRate.toFixed(1)}%`
    : null

  const aiComment = state.aiInsight?.ai_result?.summary ?? null
  const isEarlyStage = state.stage === 1

  return (
    <div className="space-y-4 p-4">
      {/* 상단: 오늘 매출 + 목표 달성률 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 오늘 매출 카드 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">오늘 매출</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{fmt(state.todayRevenue)}원</p>
          {changeRateText && (
            <p className={`mt-1 text-xs font-medium ${state.todayChangeRate! >= 0 ? "text-green-600" : "text-red-500"}`}>
              {changeRateText} 전일 대비
            </p>
          )}
          {aiComment && !isEarlyStage && (
            <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 leading-relaxed">
              💬 {aiComment}
            </p>
          )}
          {isEarlyStage && (
            <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-600">
              📊 {5 - state.entryCount}건 더 기록하면 AI 분석이 시작돼요
            </p>
          )}
        </div>

        {/* 목표 달성률 카드 */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <GoalRing percent={goalPercent} hasGoal={!!state.goal?.monthly_goal} />
          {state.goal?.remaining != null && state.goal.remaining > 0 && (
            <p className="mt-2 text-center text-xs text-slate-500">
              목표까지 {fmt(state.goal.remaining)}원
            </p>
          )}
          {!state.goal?.monthly_goal && (
            <button
              onClick={() => handleChat("이번달 매출 목표를 설정하고 싶어요")}
              className="mt-2 text-xs text-green-600 underline"
            >
              목표 설정하기
            </button>
          )}
        </div>
      </div>

      {/* 중단: 주간 추이 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-semibold text-slate-600">이번 주 매출 추이</p>
        <WeeklyBarChart data={state.weeklyData} />
      </div>

      {/* 하단: 챗 CTA */}
      <button
        onClick={() => handleChat("오늘 매출 수치에 대해 분석해줘")}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${
          copied
            ? "border-green-400 bg-green-500 text-white"
            : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        {copied ? "✓ 클립보드에 복사됐어요 — 대시보드 채팅창에 붙여넣기하세요" : "이 수치에 대해 Sales AI에게 물어보기"}
      </button>
    </div>
  )
}
