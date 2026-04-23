"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ── 타입 정의 ──────────────────────────────────────────────────────────────

interface InstagramAccount {
  username?: string;
  followers_count: number;
  media_count: number;
  reach: number;
  impressions: number;
  profile_views: number;
  period_days: number;
}

interface InstagramPost {
  id: string;
  caption: string;
  media_type: string;
  permalink: string;
  reach: number;
  impressions: number;
  engagement: number;
  saved: number;
}

interface InstagramData {
  account?: InstagramAccount;
  top_posts?: InstagramPost[];
  avg_engagement?: number;
  total_posts_analyzed?: number;
  error?: string;
}

interface YoutubeChannel {
  views: number;
  watch_minutes: number;
  subscribers_gained: number;
  subscribers_lost: number;
  net_subscribers: number;
  likes: number;
  comments: number;
  period_days: number;
  error?: string;
  needs_reconnect?: boolean;
}

interface YoutubeVideo {
  video_id: string;
  title: string;
  views: number;
  watch_minutes: number;
  likes: number;
  url: string;
}

interface YoutubeData {
  channel?: YoutubeChannel;
  top_videos?: YoutubeVideo[];
  error?: string;
}

export interface MarketingReportPayload {
  period_days: number;
  instagram: InstagramData;
  youtube: YoutubeData;
  analysis: string;
}

// ── 파서 ──────────────────────────────────────────────────────────────────

export function extractMarketingReportPayload(text: string): {
  cleaned: string;
  payload: MarketingReportPayload | null;
} {
  const start = "[[MARKETING_REPORT]]";
  const end = "[[/MARKETING_REPORT]]";
  const si = text.indexOf(start);
  const ei = text.indexOf(end);
  if (si === -1 || ei === -1) return { cleaned: text, payload: null };

  const json = text.slice(si + start.length, ei).trim();
  const cleaned = (text.slice(0, si) + text.slice(ei + end.length)).trim();

  try {
    return { cleaned, payload: JSON.parse(json) as MarketingReportPayload };
  } catch {
    return { cleaned, payload: null };
  }
}

// ── 유틸 ──────────────────────────────────────────────────────────────────

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
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="text-[15px] font-semibold text-neutral-800">
        {value}
      </span>
      {sub && <span className="text-[10px] text-neutral-400">{sub}</span>}
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────

export function MarketingReportCard({
  payload,
}: {
  payload: MarketingReportPayload;
}) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const [tab, setTab] = useState<"overview" | "instagram" | "youtube">(
    "overview",
  );
  const [ytConnecting, setYtConnecting] = useState(false);
  const [ytData, setYtData] = useState<YoutubeData>(payload.youtube);

  const ig = payload.instagram;
  const yt = ytData;
  const igOk = ig && !ig.error;
  const ytOk = yt && yt.channel && !yt.channel.error;

  const getAccountId = useCallback(async () => {
    const sb = createClient();
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? "";
  }, []);

  const handleConnectYoutube = useCallback(async () => {
    setYtConnecting(true);
    try {
      const accountId = await getAccountId();
      const res = await fetch(
        `${apiBase}/api/marketing/youtube/oauth/start?account_id=${accountId}`,
      );
      const { url } = await res.json();
      const popup = window.open(
        url,
        "youtube_oauth",
        "popup=true,width=600,height=700",
      );

      const onMsg = async (e: MessageEvent) => {
        if (e.data?.type !== "youtube_connected") return;
        window.removeEventListener("message", onMsg);
        popup?.close();

        if (e.data.success) {
          // 연결 성공 → YouTube 데이터 즉시 재조회
          try {
            const r = await fetch(
              `${apiBase}/api/marketing/report/youtube?account_id=${accountId}&days=${payload.period_days}`,
            );
            const json = await r.json();
            if (json?.data) setYtData(json.data);
          } catch {
            /* 재조회 실패는 무시 */
          }
          setTab("youtube");
        } else {
          alert(`YouTube 연결 실패: ${e.data.error ?? "알 수 없는 오류"}`);
        }
        setYtConnecting(false);
      };
      window.addEventListener("message", onMsg);
    } catch {
      setYtConnecting(false);
    }
  }, [apiBase, getAccountId, payload.period_days]);

  return (
    <div className="rounded-[5px] border border-neutral-200 bg-white overflow-hidden w-full max-w-[520px] shadow-sm">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-50 border-b border-neutral-200">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Marketing Report
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
            최근 {payload.period_days}일
          </span>
        </div>
        <div className="flex gap-1">
          {(["overview", "instagram", "youtube"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[11px] px-2.5 py-1 rounded-[4px] transition-colors ${
                tab === t
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-500 hover:bg-neutral-100"
              }`}
            >
              {t === "overview"
                ? "분석"
                : t === "instagram"
                  ? "인스타"
                  : "유튜브"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {/* 개요 탭 — AI 분석 */}
        {tab === "overview" && (
          <div className="space-y-3">
            {/* 플랫폼 연결 상태 */}
            <div className="flex gap-2">
              {igOk ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-pink-200 bg-pink-50 text-pink-600">
                  ● Instagram 연결됨
                </span>
              ) : (
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white text-neutral-500"
                  title="관리자 설정에서 Meta 액세스 토큰을 등록하면 연결됩니다"
                >
                  ○ Instagram 미연결
                </span>
              )}
              {ytOk ? (
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600">
                  ● YouTube 연결됨
                </span>
              ) : (
                <button
                  onClick={handleConnectYoutube}
                  disabled={ytConnecting}
                  className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-300 bg-white text-neutral-500 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {ytConnecting ? "연결 중…" : "○ YouTube 연결하기"}
                </button>
              )}
            </div>

            {/* AI 분석 텍스트 */}
            <div className="text-[13px] text-neutral-700 leading-relaxed whitespace-pre-wrap">
              {payload.analysis}
            </div>
          </div>
        )}

        {/* Instagram 탭 */}
        {tab === "instagram" && (
          <div className="space-y-4">
            {!igOk ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <p className="text-[13px] text-neutral-500 text-center">
                  {ig?.error || "Instagram 데이터를 불러올 수 없습니다."}
                </p>
                <p className="text-[11px] text-neutral-400 text-center">
                  Instagram 연결은 Meta 비즈니스 계정의 액세스 토큰을
                  <br />
                  관리자 설정에서 등록하면 자동으로 활성화됩니다.
                </p>
              </div>
            ) : (
              <>
                {/* 계정 통계 그리드 */}
                <div className="grid grid-cols-2 gap-3 p-3 rounded-[5px] bg-neutral-50 border border-neutral-100">
                  <StatCell
                    label="팔로워"
                    value={fmt(ig.account?.followers_count ?? 0)}
                  />
                  <StatCell
                    label="도달수"
                    value={fmt(ig.account?.reach ?? 0)}
                    sub={`${payload.period_days}일 합산`}
                  />
                  <StatCell
                    label="인상수"
                    value={fmt(ig.account?.impressions ?? 0)}
                    sub={`${payload.period_days}일 합산`}
                  />
                  <StatCell
                    label="프로필 방문"
                    value={fmt(ig.account?.profile_views ?? 0)}
                    sub={`${payload.period_days}일 합산`}
                  />
                </div>

                {/* 평균 engagement */}
                <div className="flex items-center justify-between text-[12px] text-neutral-600">
                  <span>게시물 평균 engagement</span>
                  <span className="font-semibold">
                    {(ig.avg_engagement ?? 0).toFixed(1)}
                  </span>
                </div>

                {/* TOP 3 게시물 */}
                {ig.top_posts && ig.top_posts.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-2">
                      TOP {ig.top_posts.length} 게시물 (engagement 기준)
                    </p>
                    <div className="space-y-2">
                      {ig.top_posts.map((post, i) => (
                        <a
                          key={post.id}
                          href={post.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start gap-2 p-2 rounded-[4px] hover:bg-neutral-50 transition-colors group"
                        >
                          <span className="text-[11px] font-bold text-neutral-400 mt-0.5 w-4 shrink-0">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-neutral-700 truncate group-hover:text-neutral-900">
                              {post.caption || "(캡션 없음)"}
                            </p>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              engagement {fmt(post.engagement)} · 저장{" "}
                              {fmt(post.saved)}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* YouTube 탭 */}
        {tab === "youtube" && (
          <div className="space-y-4">
            {!ytOk ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <p className="text-[13px] text-neutral-500 text-center">
                  {yt?.channel?.error || "YouTube 계정이 연결되지 않았습니다."}
                </p>
                <button
                  onClick={handleConnectYoutube}
                  disabled={ytConnecting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-[5px] bg-red-500 text-white text-[13px] font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {ytConnecting ? (
                    "연결 중…"
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                        <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.81a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                      YouTube 연결하기
                    </>
                  )}
                </button>
                {yt?.channel?.needs_reconnect && (
                  <p className="text-[11px] text-neutral-400 text-center">
                    Analytics 권한 추가를 위해 재연결이 필요합니다.
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* 채널 통계 그리드 */}
                <div className="grid grid-cols-2 gap-3 p-3 rounded-[5px] bg-neutral-50 border border-neutral-100">
                  <StatCell
                    label="조회수"
                    value={fmt(yt.channel?.views ?? 0)}
                    sub={`${payload.period_days}일 합산`}
                  />
                  <StatCell
                    label="시청시간"
                    value={`${fmt(yt.channel?.watch_minutes ?? 0)}분`}
                    sub={`${payload.period_days}일 합산`}
                  />
                  <StatCell
                    label="구독자 순증"
                    value={`${(yt.channel?.net_subscribers ?? 0) >= 0 ? "+" : ""}${fmt(yt.channel?.net_subscribers ?? 0)}`}
                    sub={`+${fmt(yt.channel?.subscribers_gained ?? 0)} / -${fmt(yt.channel?.subscribers_lost ?? 0)}`}
                  />
                  <StatCell
                    label="좋아요"
                    value={fmt(yt.channel?.likes ?? 0)}
                    sub={`댓글 ${fmt(yt.channel?.comments ?? 0)}`}
                  />
                </div>

                {/* TOP 영상 */}
                {yt.top_videos && yt.top_videos.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-neutral-400 mb-2">
                      TOP {yt.top_videos.length} 영상 (조회수 기준)
                    </p>
                    <div className="space-y-2">
                      {yt.top_videos.map((v, i) => (
                        <a
                          key={v.video_id}
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-2 rounded-[4px] hover:bg-neutral-50 transition-colors group"
                        >
                          <span className="text-[11px] font-bold text-neutral-400 w-4 shrink-0">
                            {i + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-neutral-700 truncate group-hover:text-neutral-900">
                              {v.title || v.video_id}
                            </p>
                            <p className="text-[11px] text-neutral-400 mt-0.5">
                              조회 {fmt(v.views)} · {fmt(v.watch_minutes)}분 ·
                              좋아요 {fmt(v.likes)}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
