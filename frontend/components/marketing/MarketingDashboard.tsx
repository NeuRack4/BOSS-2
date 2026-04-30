// frontend/components/marketing/MarketingDashboard.tsx
"use client";

import { useCallback, useState } from "react";
import { BarChart2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useMarketingData } from "./hooks/useMarketingData";
import { OverviewTab } from "./tabs/OverviewTab";
import { InstagramTab } from "./tabs/InstagramTab";
import { YoutubeTab } from "./tabs/YoutubeTab";
import { ActionsTab } from "./tabs/ActionsTab";
import { createClient } from "@/lib/supabase/client";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const fmt = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1)}만` : n.toLocaleString();

type Tab = "overview" | "instagram" | "youtube" | "actions";
const TABS: { key: Tab; label: string; activeClass: string }[] = [
  { key: "overview", label: "개요", activeClass: "bg-slate-700 text-white" },
  { key: "instagram", label: "인스타", activeClass: "bg-pink-500 text-white" },
  { key: "youtube", label: "유튜브", activeClass: "bg-red-500 text-white" },
  { key: "actions", label: "할 일", activeClass: "bg-orange-400 text-white" },
];

type Props = {
  accountId: string;
  onChatMessage?: (msg: string) => void;
};

export function MarketingDashboard({ accountId, onChatMessage }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [ytConnecting, setYtConnecting] = useState(false);
  const { state, refresh, fetchActions, fetchAnalysis } =
    useMarketingData(accountId);

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === "actions") fetchActions();
  };

  const handleConnectInstagram = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("boss:open-integrations-modal", {
        detail: { tab: "instagram" },
      }),
    );
  }, []);

  const handleConnectYoutube = useCallback(async () => {
    setYtConnecting(true);
    try {
      const sb = createClient();
      const { data } = await sb.auth.getUser();
      const aid = data.user?.id ?? accountId;
      const res = await fetch(
        `${API}/api/marketing/youtube/oauth/start?account_id=${aid}`,
      );
      const payload = await res.json();
      if (!res.ok || !payload.url) {
        throw new Error(payload.detail || payload.error || "YouTube connection failed.");
      }
      const popup = window.open(
        payload.url,
        "youtube_oauth",
        "popup=true,width=600,height=700",
      );
      if (!popup) {
        throw new Error("Popup was blocked. Please allow popups and try again.");
      }
      const onMsg = async (e: MessageEvent) => {
        if (e.data?.type !== "youtube_connected") return;
        window.removeEventListener("message", onMsg);
        popup?.close();
        if (e.data.success) {
          refresh();
          setActiveTab("youtube");
        } else {
          alert(`YouTube 연결 실패: ${e.data.error ?? "알 수 없는 오류"}`);
        }
        setYtConnecting(false);
      };
      window.addEventListener("message", onMsg);
    } catch (error) {
      alert(error instanceof Error ? error.message : "YouTube connection failed.");
      setYtConnecting(false);
    }
  }, [accountId, refresh]);

  const handleChatMessage = (msg: string) => {
    if (onChatMessage) {
      onChatMessage(msg);
    } else {
      navigator.clipboard.writeText(msg).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = msg;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      });
    }
  };

  // ── 접힌 상태 미니바 ───────────────────────────────────────────────────────
  if (collapsed) {
    const ig = state.data?.instagram;
    const yt = state.data?.youtube;
    const followers = ig?.account?.followers_count ?? 0;
    const reach = ig?.account?.reach ?? 0;
    const netSubs = yt?.channel?.net_subscribers ?? null;

    return (
      <div
        className="mb-4 flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm transition hover:border-rose-200 hover:shadow-md"
        onClick={() => setCollapsed(false)}
      >
        <div className="flex items-center gap-5 text-sm">
          <BarChart2 className="h-4 w-4 text-rose-400" />
          {followers > 0 && (
            <span className="font-semibold text-slate-700">
              팔로워 {fmt(followers)}
            </span>
          )}
          {reach > 0 && (
            <span className="text-xs text-slate-500">도달 {fmt(reach)}</span>
          )}
          {netSubs !== null && (
            <span
              className={`text-xs ${netSubs >= 0 ? "text-green-600" : "text-red-500"}`}
            >
              구독자 {netSubs >= 0 ? "+" : ""}
              {fmt(netSubs)}
            </span>
          )}
          {followers === 0 && reach === 0 && netSubs === null && (
            <span className="text-xs text-slate-400">마케팅 대시보드</span>
          )}
        </div>
        <button className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-500 transition hover:border-rose-300 hover:text-rose-500">
          펼치기 <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // ── 펼쳐진 상태 ───────────────────────────────────────────────────────────
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* 헤더: 탭 + 접기 버튼 */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === tab.key
                  ? tab.activeClass
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
            className="rounded-lg p-1.5 text-slate-400 transition hover:text-rose-500"
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

      {/* 로딩 스켈레톤 */}
      {state.loading && (
        <div className="animate-pulse space-y-3 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-100" />
            ))}
          </div>
          <div className="h-12 rounded-xl bg-slate-100" />
        </div>
      )}

      {/* 에러 */}
      {!state.loading && state.error && (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-400">{state.error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-rose-500 underline"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 탭 콘텐츠 */}
      {!state.loading && !state.error && state.data && (
        <>
          {activeTab === "overview" && (
            <OverviewTab
              data={state.data}
              onConnectInstagram={handleConnectInstagram}
              onConnectYoutube={handleConnectYoutube}
              analysis={state.analysis}
              analysisLoading={state.analysisLoading}
              analysisLoaded={state.analysisLoaded}
              onRequestAnalysis={fetchAnalysis}
            />
          )}
          {activeTab === "instagram" && (
            <InstagramTab
              ig={state.data.instagram}
              periodDays={state.data.period_days}
              onConnect={handleConnectInstagram}
            />
          )}
          {activeTab === "youtube" && (
            <YoutubeTab
              yt={state.data.youtube}
              periodDays={state.data.period_days}
              onConnect={handleConnectYoutube}
              connecting={ytConnecting}
            />
          )}
          {activeTab === "actions" && (
            <ActionsTab
              accountId={accountId}
              actions={state.actions}
              loading={state.actionsLoading}
              loaded={state.actionsLoaded}
            />
          )}
        </>
      )}
    </div>
  );
}
