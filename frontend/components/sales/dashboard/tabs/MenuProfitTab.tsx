// frontend/components/sales/dashboard/tabs/MenuProfitTab.tsx
"use client"

import { MessageCircle } from "lucide-react"
import type { CategoryItem } from "../types"

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString()

type Props = {
  categories: CategoryItem[]
  onChatMessage?: (msg: string) => void
}

export function MenuProfitTab({ categories, onChatMessage }: Props) {
  if (categories.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center">
          <p className="text-sm text-slate-400">메뉴 수익성 데이터가 없어요</p>
          <p className="mt-1 text-xs text-slate-300">메뉴를 등록하고 매출을 기록하면 분석이 가능해요</p>
          <button
            onClick={() => onChatMessage?.("메뉴별 수익성을 분석해줘")}
            className="mt-4 rounded-lg bg-green-500 px-4 py-2 text-sm text-white hover:bg-green-600 transition"
          >
            메뉴 수익성 분석 요청하기
          </button>
        </div>
      </div>
    )
  }

  const maxAmount = Math.max(...categories.map(c => c.amount), 1)

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-4 text-xs font-semibold text-slate-600">카테고리별 수익 비교</p>
        <div className="space-y-3">
          {[...categories].sort((a, b) => b.amount - a.amount).map((item, idx) => (
            <div key={item.category} className="space-y-1">
              <div className="flex justify-between text-xs text-slate-600">
                <span className="flex items-center gap-1.5">
                  {idx === 0 && <span className="text-yellow-400">★</span>}
                  {item.category}
                </span>
                <span className="font-medium">{fmt(item.amount)}원</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-green-400 transition-all duration-500"
                  style={{ width: `${(item.amount / maxAmount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => onChatMessage?.("수익성 개선 전략을 알려줘")}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-3 text-sm font-medium text-green-700 transition hover:bg-green-100"
      >
        <MessageCircle className="h-4 w-4" />
        수익성 개선 전략 물어보기
      </button>
    </div>
  )
}
