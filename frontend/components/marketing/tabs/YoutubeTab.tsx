// frontend/components/marketing/tabs/YoutubeTab.tsx
"use client";

import type { YoutubeData } from "../types";

const fmt = (n: number) => n.toLocaleString("ko-KR");

function StatCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="text-[15px] font-semibold text-slate-800">{value}</span>
      {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
    </div>
  );
}

export function YoutubeTab({
  yt,
  periodDays,
  onConnect,
  connecting,
}: {
  yt: YoutubeData;
  periodDays: number;
  onConnect?: () => void;
  connecting?: boolean;
}) {
  const ch = yt.channel;
  const hasError = !ch || !!ch.error;

  if (hasError) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <p className="text-sm text-slate-400">
          {ch?.error || "YouTube 계정이 연결되지 않았습니다."}
        </p>
        <button
          onClick={onConnect}
          disabled={connecting}
          className="flex items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
        >
          {connecting ? (
            "연결 중…"
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.81a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
              </svg>
              YouTube 연결하기
            </>
          )}
        </button>
        {ch?.needs_reconnect && (
          <p className="text-xs text-slate-400">
            Analytics 권한 추가를 위해 재연결이 필요합니다.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      {/* 채널 통계 */}
      <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">
        <StatCell
          label="조회수"
          value={fmt(ch.views)}
          sub={`${periodDays}일 합산`}
        />
        <StatCell
          label="시청시간"
          value={`${fmt(ch.watch_minutes)}분`}
          sub={`${periodDays}일 합산`}
        />
        <StatCell
          label="구독자 순증"
          value={`${ch.net_subscribers >= 0 ? "+" : ""}${fmt(ch.net_subscribers)}`}
          sub={`+${fmt(ch.subscribers_gained)} / -${fmt(ch.subscribers_lost)}`}
        />
        <StatCell
          label="좋아요"
          value={fmt(ch.likes)}
          sub={`댓글 ${fmt(ch.comments)}`}
        />
      </div>

      {/* TOP 영상 */}
      {yt.top_videos && yt.top_videos.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            TOP {yt.top_videos.length} 영상 (조회수 기준)
          </p>
          <div className="space-y-1">
            {yt.top_videos.map((v, i) => (
              <a
                key={v.video_id}
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg p-3 transition hover:bg-slate-50"
              >
                <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-700">
                    {v.title || v.video_id}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    조회 {fmt(v.views)} · {fmt(v.watch_minutes)}분 · 좋아요{" "}
                    {fmt(v.likes)}
                  </p>
                </div>
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3 shrink-0 text-slate-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    d="M3 13L13 3M13 3H7M13 3v6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
