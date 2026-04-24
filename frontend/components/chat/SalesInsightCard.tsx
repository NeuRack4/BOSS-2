"use client";

import { useState, useRef, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Megaphone,
  AlertCircle,
} from "lucide-react";

// ── 타입 ───────────────────────────────────────────────────────────────────

export type SalesInsightPayload = {
  period: string;
  sales: number;
  costs: number;
  profit: number;
  sales_change: string;
  costs_change: string;
  profit_change: string;
  top_items: { name: string; amount: number }[];
  summary: string;
  good_factors: string[];
  bad_factors: string[];
  actions: string[];
  marketing: string[];
};

// ── 마커 파싱 ──────────────────────────────────────────────────────────────

const MARKER_RE = /\[\[SALES_INSIGHT:([\s\S]*?)\]\]/;

export function extractInsightPayload(text: string): {
  cleaned: string;
  payload: SalesInsightPayload | null;
} {
  const m = text.match(MARKER_RE);
  if (!m) return { cleaned: text, payload: null };
  try {
    const payload = JSON.parse(m[1]) as SalesInsightPayload;
    return { cleaned: text.replace(MARKER_RE, "").trim(), payload };
  } catch {
    return { cleaned: text, payload: null };
  }
}

// ── 유틸 ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 100_000_000
    ? `${(n / 100_000_000).toFixed(1)}억`
    : n >= 10_000
      ? `${(n / 10_000).toFixed(1)}만`
      : n.toLocaleString();

function ChangePill({ rate }: { rate: string }) {
  if (!rate || rate.includes("데이터"))
    return <span className="text-[10px] text-[#aaa]">전기 없음</span>;
  const isUp = rate.startsWith("+");
  const isZero = rate === "0.0%";
  if (isZero)
    return (
      <span className="inline-flex items-center gap-0.5 rounded-[3px] bg-[#e8e3d8] px-1 py-0.5 text-[10px] text-[#8c7e66]">
        <Minus size={8} /> 변동없음
      </span>
    );
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-[3px] px-1 py-0.5 text-[10px] font-semibold ${
        isUp ? "bg-[#e8edd8] text-[#4a5c28]" : "bg-[#f4e8e0] text-[#8a3a28]"
      }`}
    >
      {isUp ? <TrendingUp size={8} /> : <TrendingDown size={8} />}
      {rate}
    </span>
  );
}

// ── 탭 ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "summary", label: "📊 요약" },
  { id: "analysis", label: "🔍 원인분석" },
  { id: "actions", label: "✅ 추천액션" },
  { id: "marketing", label: "📣 마케팅" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// ── 상위 품목 수평 바 차트 ──────────────────────────────────────────────────

function TopItemsBar({ items }: { items: { name: string; amount: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(300);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((e) =>
      setW(Math.floor(e[0].contentRect.width)),
    );
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  if (!items.length) return null;
  const max = items[0].amount;
  const BAR_H = 14;
  const GAP = 8;
  const LABEL_W = 80;
  const BAR_W = W - LABEL_W - 50;
  const H = items.length * (BAR_H + GAP);

  return (
    <div ref={containerRef} className="w-full">
      <p className="mb-2 text-[11px] font-semibold text-[#5a5040]">
        매출 상위 품목
      </p>
      <svg
        width={W}
        height={H}
        style={{ display: "block", overflow: "visible" }}
      >
        {items.map((item, i) => {
          const { name, amount: amt } = item;
          const barLen = max > 0 ? (amt / max) * BAR_W : 0;
          const y = i * (BAR_H + GAP);
          return (
            <g key={name}>
              <text
                x={0}
                y={y + BAR_H - 2}
                fontSize={10}
                fill="#6a5e50"
                fontFamily="monospace"
              >
                {name.length > 7 ? name.slice(0, 7) + "…" : name}
              </text>
              <rect
                x={LABEL_W}
                y={y}
                width={Math.max(barLen, 2)}
                height={BAR_H}
                rx={3}
                fill="#a3b07a"
                opacity={0.85}
              />
              <text
                x={LABEL_W + barLen + 4}
                y={y + BAR_H - 2}
                fontSize={9}
                fill="#8c7e66"
                fontFamily="monospace"
              >
                {fmt(amt)}원
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── 메인 카드 ──────────────────────────────────────────────────────────────

export function SalesInsightCard({
  payload,
}: {
  payload: SalesInsightPayload;
}) {
  const [tab, setTab] = useState<TabId>("summary");

  return (
    <div className="w-full overflow-hidden rounded-[5px] border border-[#d8d0c4] bg-[#faf8f4] shadow-sm">
      {/* 헤더 */}
      <div className="border-b border-[#d8d0c4] bg-[#f0ece4] px-4 py-2.5">
        <p className="font-mono text-[11px] uppercase tracking-wide text-[#8c7e66]">
          매출 인사이트
        </p>
        <p className="text-[12px] font-semibold text-[#3a3020]">
          {payload.period}
        </p>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-[#d8d0c4]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-[#7f8f54] bg-white text-[#4a5c28]"
                : "text-[#8c7e66] hover:bg-[#f0ece4]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 내용 */}
      <div className="p-4">
        {/* ── 요약 탭 ── */}
        {tab === "summary" && (
          <div className="flex flex-col gap-4">
            {/* 3카드 */}
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: "매출",
                  value: payload.sales,
                  change: payload.sales_change,
                  color: "#4a5c28",
                  bg: "#f0f4e8",
                },
                {
                  label: "비용",
                  value: payload.costs,
                  change: payload.costs_change,
                  color: "#8a3a28",
                  bg: "#f9f0ec",
                },
                {
                  label: "순이익",
                  value: payload.profit,
                  change: payload.profit_change,
                  color: payload.profit >= 0 ? "#4a5c28" : "#8a3a28",
                  bg: payload.profit >= 0 ? "#f0f4e8" : "#f9f0ec",
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-[5px] border border-[#d8d0c4] bg-white p-2.5"
                >
                  <p className="text-[10px] text-[#8c7e66]">{c.label}</p>
                  <p
                    className="mt-0.5 text-[14px] font-bold"
                    style={{ color: c.color }}
                  >
                    {fmt(c.value)}원
                  </p>
                  <div className="mt-1">
                    <ChangePill rate={c.change} />
                  </div>
                </div>
              ))}
            </div>

            {/* 상위 품목 차트 */}
            {payload.top_items.length > 0 && (
              <div className="rounded-[5px] border border-[#d8d0c4] bg-white p-3">
                <TopItemsBar items={payload.top_items} />
              </div>
            )}

            {/* 핵심 요약 텍스트 */}
            {payload.summary && (
              <div className="rounded-[5px] bg-[#f0ece4] px-3 py-2.5">
                <p className="text-[12px] leading-relaxed text-[#5a5040]">
                  {payload.summary}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── 원인분석 탭 ── */}
        {tab === "analysis" && (
          <div className="flex flex-col gap-3">
            {payload.good_factors.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-[#4a5c28]">
                  <TrendingUp size={12} /> 잘된 요인
                </p>
                <div className="flex flex-col gap-1.5">
                  {payload.good_factors.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-[5px] bg-[#f0f4e8] px-3 py-2"
                    >
                      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#7f8f54]" />
                      <p className="text-[12px] text-[#3a5020]">{f}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {payload.bad_factors.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold text-[#8a3a28]">
                  <AlertCircle size={12} /> 아쉬운 요인
                </p>
                <div className="flex flex-col gap-1.5">
                  {payload.bad_factors.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-[5px] bg-[#f9f0ec] px-3 py-2"
                    >
                      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#c05a3a]" />
                      <p className="text-[12px] text-[#6a2a18]">{f}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 추천액션 탭 ── */}
        {tab === "actions" && (
          <div className="flex flex-col gap-2">
            {payload.actions.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-[5px] border border-[#d8d0c4] bg-white px-3 py-2.5"
              >
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#7f8f54] text-[10px] font-bold text-white">
                  {i + 1}
                </div>
                <p className="text-[12px] leading-relaxed text-[#3a3020]">
                  {a}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ── 마케팅 탭 ── */}
        {tab === "marketing" && (
          <div className="flex flex-col gap-2">
            {payload.marketing.map((m, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-[5px] border border-[#d8d0c4] bg-[#fdf8f2] px-3 py-2.5"
              >
                <Megaphone
                  size={14}
                  className="mt-0.5 shrink-0 text-[#7f8f54]"
                />
                <p className="text-[12px] leading-relaxed text-[#3a3020]">
                  {m}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
