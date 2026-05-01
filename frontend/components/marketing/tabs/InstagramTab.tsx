// frontend/components/marketing/tabs/InstagramTab.tsx
"use client";

import type { InstagramData } from "../types";

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

export function InstagramTab({
  ig,
  periodDays,
  onConnect,
}: {
  ig: InstagramData;
  periodDays: number;
  onConnect?: () => void;
}) {
  if (ig.error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-slate-400">{ig.error}</p>
        <button
          onClick={onConnect}
          className="inline-flex items-center gap-1.5 rounded-full border border-pink-200 bg-pink-50 px-4 py-1.5 text-xs font-medium text-pink-600 transition hover:bg-pink-100"
        >
          Instagram 연결하기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      {/* 계정 통계 */}
      {ig.account && (
        <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">
          <StatCell label="팔로워" value={fmt(ig.account.followers_count)} />
          <StatCell
            label="게시글 수"
            value={fmt(ig.account.media_count)}
          />
          <StatCell
            label="공유 수"
            value={fmt((ig.top_posts ?? []).reduce((s, p) => s + (p.shares ?? 0), 0))}
            sub="분석 게시물 합산"
          />
          <StatCell
            label="댓글 수"
            value={fmt((ig.top_posts ?? []).reduce((s, p) => s + (p.comments ?? 0), 0))}
            sub="분석 게시물 합산"
          />
        </div>
      )}

      {/* TOP 게시물 */}
      {ig.top_posts && ig.top_posts.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            TOP {ig.top_posts.length} 게시물 (engagement 기준)
          </p>
          <div className="space-y-1">
            {ig.top_posts.map((post, i) => (
              <a
                key={post.id}
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-lg p-3 transition hover:bg-slate-50"
              >
                <span className="mt-0.5 w-5 shrink-0 text-center text-xs font-bold text-slate-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-700 group-hover:text-slate-900">
                    {post.caption || "(캡션 없음)"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    engagement {fmt(post.engagement)} · 저장 {fmt(post.saved)} ·
                    도달 {fmt(post.reach)}
                  </p>
                </div>
                <svg
                  viewBox="0 0 16 16"
                  className="mt-1 h-3 w-3 shrink-0 text-slate-300"
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
