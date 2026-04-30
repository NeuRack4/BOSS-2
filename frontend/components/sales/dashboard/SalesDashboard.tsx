// frontend/components/sales/dashboard/SalesDashboard.tsx
"use client";

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, RefreshCw, BarChart2 } from "lucide-react";
import { useDashboardData } from "./hooks/useDashboardData";
import { OverviewTab } from "./tabs/OverviewTab";
import { RevenueDetailTab } from "./tabs/RevenueDetailTab";
import { CostTab } from "./tabs/CostTab";
import { MenuProfitTab } from "./tabs/MenuProfitTab";
import { NotificationTab } from "./tabs/NotificationTab";
import { IntegrationsModal } from "@/components/layout/IntegrationsModal";

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString();

type Tab = "overview" | "revenue" | "cost" | "menu" | "notification";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "revenue", label: "매출 상세" },
  { key: "cost", label: "비용" },
  { key: "menu", label: "메뉴 수익성" },
  { key: "notification", label: "알림 설정" },
];

type Props = {
  accountId: string;
  onChatMessage?: (msg: string) => void;
};

export function SalesDashboard({ accountId, onChatMessage }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [slackConnected, setSlackConnected] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const { state, periodActivation, refresh } = useDashboardData(accountId);

  useEffect(() => {
    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${API}/api/slack/status?account_id=${accountId}`)
      .then((r) => r.json())
      .then((res) => setSlackConnected(res.connected ?? false));
  }, [accountId]);

  const goalPercent =
    state.goal?.achievement_rate != null
      ? Math.round(state.goal.achievement_rate)
      : 0;

  // ── 접힌 상태: 미니 바 ─────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        className="mb-4 flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm transition hover:border-green-300 hover:shadow-md"
        onClick={() => setCollapsed(false)}
      >
        <div className="flex items-center gap-5 text-sm">
          <BarChart2 className="h-4 w-4 text-green-500" />
          <span className="font-semibold text-slate-700">
            오늘 {fmt(state.todayRevenue)}원
          </span>
          {state.todayChangeRate != null && (
            <span
              className={`text-xs ${state.todayChangeRate >= 0 ? "text-green-600" : "text-red-500"}`}
            >
              {state.todayChangeRate >= 0 ? "+" : ""}
              {state.todayChangeRate.toFixed(1)}%
            </span>
          )}
          <span className="text-xs text-slate-400">목표 {goalPercent}%</span>
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition hover:border-green-300 hover:text-green-600"
        >
          펼치기 <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // ── 펼쳐진 상태 ───────────────────────────────────────────────────────────
  return (
    <>
    <IntegrationsModal
      open={connectOpen}
      onClose={() => setConnectOpen(false)}
      initialTab="slack"
    />
    <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* 헤더: 탭 + 접기 버튼 */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === tab.key
                  ? "bg-green-500 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="rounded-lg p-1.5 text-slate-400 transition hover:text-green-500"
            title="새로고침"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition hover:text-slate-600"
          >
            접기 <ChevronUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 로딩 — 스켈레톤 */}
      {state.loading && (
        <div className="space-y-3 p-4 animate-pulse">
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 rounded-xl bg-slate-100" />
            <div className="h-24 rounded-xl bg-slate-100" />
          </div>
          <div className="h-28 rounded-xl bg-slate-100" />
          <div className="h-10 rounded-xl bg-slate-100" />
        </div>
      )}

      {/* 에러 */}
      {!state.loading && state.error && (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-400">데이터를 불러오지 못했어요</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-green-600 underline"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 탭 콘텐츠 */}
      {!state.loading && !state.error && (
        <>
          {activeTab === "overview" && (
            <OverviewTab state={state} onChatMessage={onChatMessage} />
          )}
          {activeTab === "revenue" && (
            <RevenueDetailTab
              categories={state.categories}
              weeklyData={state.weeklyData}
              periodActivation={periodActivation}
              onChatMessage={onChatMessage}
            />
          )}
          {activeTab === "cost" && (
            <CostTab overview={state.overview} onChatMessage={onChatMessage} />
          )}
          {activeTab === "menu" && (
            <MenuProfitTab
              menus={state.menus}
              accountId={accountId}
              onChatMessage={onChatMessage}
            />
          )}
          {activeTab === "notification" && (
            <NotificationTab
              accountId={accountId}
              slackConnected={slackConnected}
              onOpenConnect={() => setConnectOpen(true)}
            />
          )}
        </>
      )}
    </div>
    </>
  );
}
