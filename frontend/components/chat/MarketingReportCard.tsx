"use client";

import React, { useCallback, useState } from "react";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
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

export interface ActionItem {
  priority: "high" | "medium" | "low";
  category: "instagram" | "youtube" | "content" | "general";
  title: string;
  target: string;
  period: string;
  idea: string;
  steps: string[];
  expected: string;
  why: string;
}

export interface MarketingReportPayload {
  period_days: number;
  instagram: InstagramData;
  youtube: YoutubeData;
  analysis: string;
  actions?: ActionItem[];
}

type ReportTab = "overview" | "instagram" | "youtube" | "actions";

const REPORT_TABS: {
  key: ReportTab;
  label: string;
  activeClass: string;
}[] = [
  { key: "overview", label: "\uac1c\uc694", activeClass: "bg-slate-700 text-white" },
  { key: "instagram", label: "\uc778\uc2a4\ud0c0", activeClass: "bg-pink-500 text-white" },
  { key: "youtube", label: "\uc720\ud29c\ube0c", activeClass: "bg-red-500 text-white" },
  { key: "actions", label: "\ud560 \uc77c", activeClass: "bg-orange-400 text-white" },
];

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

// ── 액션 아이템 탭 ────────────────────────────────────────────────────────

const PRIORITY_META: Record<
  string,
  { label: string; border: string; dot: string; text: string }
> = {
  high: {
    label: "이번 주",
    border: "border-l-orange-400",
    dot: "bg-orange-400",
    text: "text-orange-500",
  },
  medium: {
    label: "이번 달",
    border: "border-l-neutral-400",
    dot: "bg-neutral-400",
    text: "text-neutral-500",
  },
  low: {
    label: "여유 있을 때",
    border: "border-l-neutral-300",
    dot: "bg-neutral-300",
    text: "text-neutral-400",
  },
};

const CATEGORY_LABEL: Record<string, string> = {
  instagram: "인스타그램",
  youtube: "유튜브",
  content: "콘텐츠",
  general: "전반",
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`w-3.5 h-3.5 text-neutral-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 6 8 10 12 6" />
    </svg>
  );
}

function ActionCard({ item, index }: { item: ActionItem; index: number }) {
  const [open, setOpen] = useState(false);
  const priority = item.priority ?? "medium";
  const meta = PRIORITY_META[priority] ?? PRIORITY_META.medium;

  return (
    <div
      className={`rounded-[6px] border border-neutral-200 border-l-[3px] ${meta.border} bg-white overflow-hidden`}
    >
      {/* 헤더 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-start gap-3 px-3.5 py-3 hover:bg-neutral-50/70 transition-colors"
      >
        {/* 순서 번호 */}
        <span className="text-[12px] font-semibold text-neutral-300 mt-px w-4 shrink-0 leading-5">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          {/* 메타 행: 우선순위 · 카테고리 · 기간 */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-[11px] font-medium ${meta.text}`}>
              {meta.label}
            </span>
            <span className="text-neutral-300 text-[10px]">·</span>
            <span className="text-[11px] text-neutral-400">
              {CATEGORY_LABEL[item.category] ?? item.category}
            </span>
            {item.period && (
              <>
                <span className="text-neutral-300 text-[10px]">·</span>
                <span className="text-[11px] text-neutral-400">
                  {item.period}
                </span>
              </>
            )}
          </div>

          {/* 제목 */}
          <p className="text-[13.5px] font-semibold text-neutral-800 leading-snug">
            {item.title}
          </p>

          {/* 대상 */}
          {item.target && (
            <p className="text-[12px] text-neutral-500 mt-1 leading-relaxed">
              대상 · {item.target}
            </p>
          )}
        </div>

        <ChevronIcon open={open} />
      </button>

      {/* 펼쳐지는 상세 */}
      {open && (
        <div className="px-3.5 pb-3.5 space-y-4 border-t border-neutral-100">
          {/* 아이디어 */}
          {item.idea && (
            <div className="pt-3">
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-1.5">
                아이디어
              </p>
              <p className="text-[13px] text-neutral-700 leading-[1.65]">
                {item.idea}
              </p>
            </div>
          )}

          {/* 실행 단계 */}
          {item.steps && item.steps.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-wide mb-2">
                실행 방법
              </p>
              <ol className="space-y-2">
                {item.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-neutral-100 flex items-center justify-center text-[10px] font-semibold text-neutral-500 mt-px">
                      {i + 1}
                    </span>
                    <span className="text-[13px] text-neutral-700 leading-relaxed">
                      {step.replace(/^\d+[단계:.\s]+/, "")}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 기대 효과 */}
          {item.expected && (
            <div className="flex items-start gap-2.5 bg-neutral-50 rounded-[5px] px-3 py-2.5 border border-neutral-100">
              <span className="text-[11px] font-medium text-neutral-400 shrink-0 mt-px">
                기대효과
              </span>
              <span className="text-[13px] text-neutral-700">
                {item.expected}
              </span>
            </div>
          )}

          {/* 근거 */}
          {item.why && (
            <p className="text-[12px] text-neutral-400 leading-relaxed">
              {item.why}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ActionItemsTab({ actions }: { actions: ActionItem[] }) {
  if (actions.length === 0) {
    return (
      <div className="py-10 text-center text-[13px] text-neutral-400">
        성과 데이터를 수집하면 AI가 할 일을 제안합니다.
      </div>
    );
  }

  const highItems = actions.filter((a) => a.priority === "high");
  const restItems = actions.filter((a) => a.priority !== "high");

  return (
    <div className="space-y-4">
      {highItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
            이번 주 할 일
          </p>
          {highItems.map((item, i) => (
            <ActionCard key={i} item={item} index={i} />
          ))}
        </div>
      )}
      {restItems.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">
            {highItems.length > 0 ? "그 다음" : "할 일"}
          </p>
          {restItems.map((item, i) => (
            <ActionCard key={i} item={item} index={highItems.length + i} />
          ))}
        </div>
      )}
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
  const [tab, setTab] = useState<ReportTab>("overview");
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
    <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Marketing Report
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
            {"\ucd5c\uadfc "}
            {payload.period_days}
            {"\uc77c"}
          </span>
        </div>
        <div className="flex gap-1">
          {REPORT_TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === item.key
                  ? item.activeClass
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {/* 할 일 탭 — 프로액티브 액션 아이템 */}
        {tab === "actions" && (
          <ActionItemsTab actions={payload.actions ?? []} />
        )}

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
            <div className="[&_p]:mb-3 [&_li]:mb-1 [&_ul]:mb-2 [&_ol]:mb-2">
              <MarkdownMessage
                content={payload.analysis}
                className="text-[13px] text-neutral-700"
              />
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
