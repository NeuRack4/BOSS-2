// frontend/components/sales/dashboard/tabs/MenuProfitTab.tsx
"use client"

import { useState } from "react"
import { MessageCircle } from "lucide-react"
import type { MenuItem } from "../types"

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString()

const MARGIN_COLOR = (rate: number) =>
  rate >= 60 ? { bar: "#22c55e", text: "text-green-600", bg: "bg-green-50" } :
  rate >= 40 ? { bar: "#f59e0b", text: "text-yellow-600", bg: "bg-yellow-50" } :
               { bar: "#ef4444", text: "text-red-500",    bg: "bg-red-50"   }

const CATEGORY_COLORS: Record<string, string> = {
  음료: "#3b82f6", 음식: "#f97316", 디저트: "#ec4899", 기타: "#94a3b8",
}

// ── 메뉴 마진 행 ───────────────────────────────────────────────────────────────
function MenuRow({ menu, maxMargin }: { menu: MenuItem; maxMargin: number }) {
  const rate = menu.margin_rate ?? 0
  const color = MARGIN_COLOR(rate)
  const barPct = maxMargin > 0 ? (rate / maxMargin) * 100 : 0

  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
      {/* 카테고리 도트 */}
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: CATEGORY_COLORS[menu.category] ?? "#94a3b8" }}
      />

      {/* 메뉴명 */}
      <div className="w-24 shrink-0 truncate text-xs font-medium text-slate-700">
        {menu.name}
      </div>

      {/* 마진율 바 */}
      <div className="flex-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barPct}%`, backgroundColor: color.bar }}
        />
      </div>

      {/* 마진율 % */}
      <div className={`w-10 shrink-0 text-right text-xs font-bold ${color.text}`}>
        {rate.toFixed(0)}%
      </div>

      {/* 가격 */}
      <div className="w-16 shrink-0 text-right text-[10px] text-slate-400">
        {fmt(menu.price)}원
      </div>
    </div>
  )
}

// ── 4사분면 평가 ───────────────────────────────────────────────────────────────
function QuadrantBadge({ menu, avgPrice, avgMargin }: {
  menu: MenuItem; avgPrice: number; avgMargin: number
}) {
  const rate = menu.margin_rate ?? 0
  const isHighMargin = rate >= avgMargin
  const isHighPrice = menu.price >= avgPrice

  const label =
    isHighMargin && isHighPrice  ? { text: "프리미엄", color: "bg-purple-100 text-purple-700" } :
    isHighMargin && !isHighPrice ? { text: "효자 메뉴", color: "bg-green-100 text-green-700"  } :
    !isHighMargin && isHighPrice ? { text: "재검토 필요", color: "bg-red-100 text-red-600"    } :
                                   { text: "볼륨 메뉴", color: "bg-blue-100 text-blue-700"   }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${label.color}`}>
      {label.text}
    </span>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────
type Props = {
  menus: MenuItem[]
  onChatMessage?: (msg: string) => void
}

export function MenuProfitTab({ menus, onChatMessage }: Props) {
  const [copied, setCopied] = useState(false)
  const [view, setView] = useState<"margin" | "quadrant">("margin")

  const handleCTA = (msg: string) => {
    onChatMessage?.(msg)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (menus.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-2xl">🍽️</p>
          <p className="mt-2 text-sm font-medium text-slate-600">등록된 메뉴가 없어요</p>
          <p className="mt-1 text-xs text-slate-400">메뉴와 원가를 입력하면 수익성 분석이 가능해요</p>
          <button
            onClick={() => handleCTA("메뉴와 원가를 등록하고 싶어요")}
            className="mt-4 rounded-lg bg-green-500 px-4 py-2 text-sm text-white transition hover:bg-green-600"
          >
            메뉴 등록하러 가기
          </button>
        </div>
      </div>
    )
  }

  const menusWithMargin = menus.filter(m => m.margin_rate != null)
  const sorted = [...menusWithMargin].sort((a, b) => (b.margin_rate ?? 0) - (a.margin_rate ?? 0))
  const maxMargin = sorted[0]?.margin_rate ?? 100
  const avgMargin = menusWithMargin.length > 0
    ? menusWithMargin.reduce((s, m) => s + (m.margin_rate ?? 0), 0) / menusWithMargin.length
    : 0
  const avgPrice = menus.length > 0
    ? menus.reduce((s, m) => s + m.price, 0) / menus.length
    : 0

  // 카테고리별 평균 마진
  const categoryStats = Object.entries(
    menusWithMargin.reduce<Record<string, { sum: number; count: number }>>((acc, m) => {
      const cat = m.category
      if (!acc[cat]) acc[cat] = { sum: 0, count: 0 }
      acc[cat].sum += m.margin_rate ?? 0
      acc[cat].count += 1
      return acc
    }, {})
  ).map(([cat, { sum, count }]) => ({ cat, avg: Math.round(sum / count) }))
    .sort((a, b) => b.avg - a.avg)

  const lowMargin = sorted.filter(m => (m.margin_rate ?? 0) < 30)

  return (
    <div className="space-y-4 p-4">
      {/* 전체 요약 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center">
          <p className="text-[10px] text-slate-500">전체 메뉴</p>
          <p className="text-lg font-bold text-slate-800">{menus.length}개</p>
        </div>
        <div className="rounded-xl bg-green-50 px-3 py-2.5 text-center">
          <p className="text-[10px] text-green-600">평균 마진율</p>
          <p className="text-lg font-bold text-green-700">{avgMargin.toFixed(0)}%</p>
        </div>
        <div className={`rounded-xl px-3 py-2.5 text-center ${lowMargin.length > 0 ? "bg-red-50" : "bg-slate-50"}`}>
          <p className="text-[10px] text-slate-500">저마진 메뉴</p>
          <p className={`text-lg font-bold ${lowMargin.length > 0 ? "text-red-500" : "text-slate-400"}`}>
            {lowMargin.length}개
          </p>
        </div>
      </div>

      {/* 뷰 전환 */}
      <div className="flex gap-1">
        {(["margin", "quadrant"] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              view === v ? "bg-green-500 text-white" : "border border-slate-200 text-slate-500 hover:border-green-300"
            }`}
          >
            {v === "margin" ? "마진율 순위" : "4분면 분석"}
          </button>
        ))}
      </div>

      {/* 마진율 순위 뷰 */}
      {view === "margin" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {/* 헤더 */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-2">
            <div className="w-2 shrink-0" />
            <div className="w-24 text-[10px] font-semibold text-slate-400">메뉴명</div>
            <div className="flex-1 text-[10px] font-semibold text-slate-400">마진율</div>
            <div className="w-10 text-right text-[10px] font-semibold text-slate-400">%</div>
            <div className="w-16 text-right text-[10px] font-semibold text-slate-400">판매가</div>
          </div>

          {/* 메뉴 목록 */}
          <div className="divide-y divide-slate-50">
            {sorted.map(menu => (
              <MenuRow key={menu.id} menu={menu} maxMargin={maxMargin} />
            ))}
            {menusWithMargin.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-400">
                원가를 입력하면 마진율이 계산돼요
              </div>
            )}
          </div>

          {/* 카테고리별 평균 마진 */}
          {categoryStats.length > 0 && (
            <div className="border-t border-slate-100 p-3">
              <p className="mb-2 text-[10px] font-semibold text-slate-500">카테고리별 평균 마진</p>
              <div className="flex flex-wrap gap-2">
                {categoryStats.map(({ cat, avg }) => {
                  const color = MARGIN_COLOR(avg)
                  return (
                    <div key={cat} className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${color.bg} ${color.text}`}>
                      {cat} {avg}%
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4분면 분석 뷰 */}
      {view === "quadrant" && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
          <p className="text-[10px] text-slate-500 mb-3">
            평균 판매가 {fmt(Math.round(avgPrice))}원 / 평균 마진 {avgMargin.toFixed(0)}% 기준
          </p>
          {menusWithMargin.map(menu => (
            <div key={menu.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              {/* 배지 — 메뉴명 바로 옆 */}
              <QuadrantBadge menu={menu} avgPrice={avgPrice} avgMargin={avgMargin} />
              <span className="flex-1 truncate text-xs font-medium text-slate-700">{menu.name}</span>
              <span className="shrink-0 text-[10px] text-slate-400">
                {fmt(menu.price)}원 · {menu.margin_rate?.toFixed(0)}%
              </span>
            </div>
          ))}
          {menusWithMargin.length === 0 && (
            <p className="py-4 text-center text-xs text-slate-400">원가를 입력하면 분석이 가능해요</p>
          )}
        </div>
      )}

      {/* 저마진 경고 */}
      {lowMargin.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-600">⚠️ 마진 30% 미만 메뉴 {lowMargin.length}개</p>
          <p className="mt-0.5 text-[10px] text-red-500">
            {lowMargin.map(m => m.name).join(", ")} — 가격 인상 또는 원가 절감을 검토해보세요
          </p>
        </div>
      )}

      {/* 챗 CTA */}
      <button
        onClick={() => handleCTA("메뉴별 수익성을 분석하고 개선 전략을 알려줘")}
        className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition ${
          copied
            ? "border-green-400 bg-green-500 text-white"
            : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        {copied ? "✓ 복사됨 — 대시보드 채팅창에 붙여넣기하세요" : "수익성 개선 전략 물어보기"}
      </button>
    </div>
  )
}
