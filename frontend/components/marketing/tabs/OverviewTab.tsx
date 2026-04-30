// frontend/components/marketing/tabs/OverviewTab.tsx
"use client";

import { Loader2, Sparkles } from "lucide-react";
import type {
  DailyInstagramData,
  DailyYoutubeData,
  MarketingAnalysis,
  MarketingData,
} from "../types";

// ── 유틸 ──────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 10_000_000
    ? `${(n / 10_000_000).toFixed(1)}천만`
    : n >= 10_000
      ? `${(n / 10_000).toFixed(1)}만`
      : n.toLocaleString();

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

function delta(curr: number, prev: number | undefined) {
  if (prev === undefined || prev === 0) return null;
  const diff = curr - prev;
  return { diff, pct: Math.round((diff / prev) * 100) };
}

// ── 플랫폼 칩 ─────────────────────────────────────────────────────────────────

const PLATFORM_STYLE = {
  Instagram: {
    chip: "border-pink-200 bg-pink-50 text-pink-600",
    dot: "bg-pink-500",
    hoverBtn: "hover:border-pink-300 hover:text-pink-500",
  },
  YouTube: {
    chip: "border-red-200 bg-red-50 text-red-600",
    dot: "bg-red-500",
    hoverBtn: "hover:border-red-300 hover:text-red-500",
  },
} as const;

function PlatformChip({
  connected,
  label,
  onConnect,
}: {
  connected: boolean;
  label: "Instagram" | "YouTube";
  onConnect?: () => void;
}) {
  const style = PLATFORM_STYLE[label];
  if (connected) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${style.chip}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {label} 연결됨
      </span>
    );
  }
  return (
    <button
      onClick={onConnect}
      className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-400 transition ${style.hoverBtn}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
      {label} 미연결
    </button>
  );
}

// ── KPI 카드 ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-100 bg-white p-4">
      <span className="text-xs text-slate-400">{label}</span>
      <span
        className={`text-xl font-bold ${accent ? "text-rose-500" : "text-slate-800"}`}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
    </div>
  );
}

// ── YouTube 일별 표 ───────────────────────────────────────────────────────────

function YoutubeTable({ rows }: { rows: DailyYoutubeData[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        YouTube 일별 조회수 · 시청시간
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-400">
              <th className="px-3 py-2 text-left font-medium">날짜</th>
              <th className="px-3 py-2 text-right font-medium">조회수</th>
              <th className="px-3 py-2 text-right font-medium">전일 대비</th>
              <th className="px-3 py-2 text-right font-medium">시청시간(분)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const d = delta(row.views, rows[i - 1]?.views);
              return (
                <tr
                  key={row.date}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-3 py-2 text-slate-600">
                    {fmtDate(row.date)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">
                    {fmt(row.views)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {d === null ? (
                      <span className="text-slate-300">—</span>
                    ) : d.diff >= 0 ? (
                      <span className="text-green-500">
                        ↑ {fmt(d.diff)} (+{d.pct}%)
                      </span>
                    ) : (
                      <span className="text-red-400">
                        ↓ {fmt(Math.abs(d.diff))} ({d.pct}%)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">
                    {fmt(row.watch_minutes)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Instagram 일별 표 ─────────────────────────────────────────────────────────

function InstagramTable({ rows }: { rows: DailyInstagramData[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Instagram 일별 도달수
      </p>
      <div className="overflow-hidden rounded-xl border border-slate-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-400">
              <th className="px-3 py-2 text-left font-medium">날짜</th>
              <th className="px-3 py-2 text-right font-medium">도달수</th>
              <th className="px-3 py-2 text-right font-medium">전일 대비</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const d = delta(row.reach, rows[i - 1]?.reach);
              return (
                <tr
                  key={row.date}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-3 py-2 text-slate-600">
                    {fmtDate(row.date)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">
                    {fmt(row.reach)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {d === null ? (
                      <span className="text-slate-300">—</span>
                    ) : d.diff >= 0 ? (
                      <span className="text-green-500">
                        ↑ {fmt(d.diff)} (+{d.pct}%)
                      </span>
                    ) : (
                      <span className="text-red-400">
                        ↓ {fmt(Math.abs(d.diff))} ({d.pct}%)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 분석 패널 ─────────────────────────────────────────────────────────────────

function AnalysisPanel({
  analysis,
  loading,
}: {
  analysis: MarketingAnalysis | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50 p-5">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          성과 데이터를 분석하고 있어요…
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 w-3/4 rounded bg-slate-200" />
          <div className="h-3 w-full rounded bg-slate-200" />
          <div className="h-3 w-5/6 rounded bg-slate-200" />
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="space-y-5">
      {/* AI 분석 텍스트 */}
      <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-violet-500">AI 분석</span>
        </div>
        <div className="prose prose-sm max-w-none text-slate-700 [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-slate-700 [&_p]:mb-2 [&_p]:text-sm [&_p]:leading-relaxed [&_strong]:text-slate-800 [&_ul]:mb-2 [&_ul]:pl-4 [&_li]:text-sm">
          {analysis.text.split("\n").map((line, i) => {
            if (line.startsWith("## ") || line.startsWith("### ")) {
              return (
                <p
                  key={i}
                  className="mt-3 mb-1 text-sm font-semibold text-slate-700"
                >
                  {line.replace(/^#+\s/, "")}
                </p>
              );
            }
            if (line.startsWith("**") && line.endsWith("**")) {
              return (
                <p key={i} className="text-sm font-semibold text-slate-700">
                  {line.slice(2, -2)}
                </p>
              );
            }
            if (line.startsWith("- ")) {
              return (
                <p key={i} className="flex gap-1.5 text-sm text-slate-700">
                  <span className="shrink-0 text-slate-400">•</span>
                  <span
                    dangerouslySetInnerHTML={{
                      __html: line
                        .slice(2)
                        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
                    }}
                  />
                </p>
              );
            }
            if (line.trim() === "") return <div key={i} className="h-1" />;
            return (
              <p
                key={i}
                className="text-sm leading-relaxed text-slate-700"
                dangerouslySetInnerHTML={{
                  __html: line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
                }}
              />
            );
          })}
        </div>
      </div>

      {/* 일별 데이터 표 */}
      <YoutubeTable rows={analysis.youtube_daily} />
      <InstagramTable rows={analysis.instagram_daily} />
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

type Props = {
  data: MarketingData;
  onConnectInstagram?: () => void;
  onConnectYoutube?: () => void;
  analysis: MarketingAnalysis | null;
  analysisLoading: boolean;
  analysisLoaded: boolean;
  onRequestAnalysis: () => void;
};

export function OverviewTab({
  data,
  onConnectInstagram,
  onConnectYoutube,
  analysis,
  analysisLoading,
  analysisLoaded,
  onRequestAnalysis,
}: Props) {
  const ig = data.instagram;
  const yt = data.youtube;
  const igOk = ig && !ig.error;
  const ytOk = yt && yt.channel && !yt.channel.error;
  const canAnalyze = !!igOk || !!ytOk;

  return (
    <div className="space-y-5 p-4">
      {/* 플랫폼 연결 상태 */}
      <div className="flex flex-wrap gap-2">
        <PlatformChip connected={!!igOk} label="Instagram" onConnect={onConnectInstagram} />
        <PlatformChip
          connected={!!ytOk}
          label="YouTube"
          onConnect={onConnectYoutube}
        />
      </div>

      {/* Instagram KPI */}
      {igOk && ig.account && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Instagram · 최근 {data.period_days}일
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="팔로워"
              value={fmt(ig.account.followers_count)}
              accent
            />
            <StatCard
              label="도달수"
              value={fmt(ig.account.reach)}
              sub="기간 합산"
            />
            <StatCard
              label="인상수"
              value={fmt(ig.account.impressions)}
              sub="기간 합산"
            />
            <StatCard
              label="avg engagement"
              value={(ig.avg_engagement ?? 0).toFixed(1)}
              sub={`${ig.total_posts_analyzed ?? 0}개 게시물`}
            />
          </div>
        </div>
      )}

      {/* YouTube KPI */}
      {ytOk && yt.channel && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            YouTube · 최근 {data.period_days}일
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="조회수"
              value={fmt(yt.channel.views)}
              sub="기간 합산"
              accent
            />
            <StatCard
              label="시청시간"
              value={`${fmt(yt.channel.watch_minutes)}분`}
              sub="기간 합산"
            />
            <StatCard
              label="구독자 순증"
              value={`${yt.channel.net_subscribers >= 0 ? "+" : ""}${fmt(yt.channel.net_subscribers)}`}
              sub={`+${fmt(yt.channel.subscribers_gained)} / -${fmt(yt.channel.subscribers_lost)}`}
            />
            <StatCard
              label="좋아요"
              value={fmt(yt.channel.likes)}
              sub={`댓글 ${fmt(yt.channel.comments)}`}
            />
          </div>
        </div>
      )}

      {/* 미연결 안내 */}
      {!igOk && !ytOk && (
        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
          Instagram 또는 YouTube를 연결하면 성과 데이터를 볼 수 있어요.
        </div>
      )}

      {/* AI 성과 분석 버튼 or 분석 결과 */}
      {canAnalyze && !analysisLoaded && !analysisLoading && (
        <button
          onClick={onRequestAnalysis}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-100 bg-violet-50 py-3 text-sm font-medium text-violet-600 transition hover:bg-violet-100"
        >
          <Sparkles className="h-4 w-4" />
          AI 성과 분석 보기
        </button>
      )}

      <AnalysisPanel analysis={analysis} loading={analysisLoading} />
    </div>
  );
}
