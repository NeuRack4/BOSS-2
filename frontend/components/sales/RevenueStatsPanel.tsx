"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── 타입 ──────────────────────────────────────────────────────────────────────

type OverviewData = {
  year: number;
  month: number;
  sales: {
    total: number;
    prev_total: number;
    change_rate: number | null;
    daily_avg: number;
  };
  costs: { total: number; prev_total: number; change_rate: number | null };
  profit: { total: number; prev_total: number; change_rate: number | null };
};

type VsCompare = {
  current: number;
  previous: number;
  change_rate: number | null;
  label: string;
  months_ago: number;
};

type BenchmarkData = {
  vs_compare: VsCompare;
  months_of_data: number;
  dow_avg: { day: string; avg: number }[];
  best_day_of_week: string | null;
  dow_reliable: boolean;
};

type AIHighlight = {
  type: "positive" | "warning" | "insight";
  text: string;
};

type AIResult = {
  summary: string;
  highlights: AIHighlight[];
  action: string;
};

type PredictionBasis = {
  elapsed_days: number;
  total_days: number;
  daily_avg: number;
};

type BenchmarkInsightData = {
  growth_stage: "early" | "growing" | "stable";
  months_of_data: number;
  ai_result: AIResult | null;
  narrative: string;
  monthly_prediction: number | null;
  prediction_basis: PredictionBasis | null;
};

type ComparePeriod = {
  months_ago: number;
  label: string;
  year: number;
  month: number;
  record_count: number;
  has_sufficient_data: boolean;
};

type GoalData = {
  monthly_goal: number;
  current_sales: number;
  achievement_rate: number | null;
  remaining: number | null;
};

type DayPoint = {
  date: string;
  day: number;
  sales: number;
  costs: number;
  profit: number;
};

type CategoryItem = {
  category: string;
  amount: number;
  pct: number;
};

type CategoryBreakdownData = {
  total: number;
  items: CategoryItem[];
};

type HourlyPoint = {
  hour: number;
  label: string;
  amount: number;
  slot: string;
};

type HourlyData = {
  series: HourlyPoint[];
  peak_hour: number | null;
  peak_slot: string | null;
};

// ── 유틸 ──────────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 10_000_000
    ? `${(n / 10_000_000).toFixed(1)}천만`
    : n >= 10_000
      ? `${(n / 10_000).toFixed(1)}만`
      : n.toLocaleString();

const MONTH_KO = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
];

// ── 카테고리 색상 ──────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  음료: "#a3b07a",
  음식: "#7a9cb0",
  디저트: "#c4a87a",
  기타: "#b0a89a",
};

function getCatColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "#b0a89a";
}

// ── 시간대 색상 ────────────────────────────────────────────────────────────────

const SLOT_COLORS: Record<string, string> = {
  새벽: "#8a9db0",
  오전: "#a3c4a8",
  점심: "#d4a84a",
  오후: "#c4a87a",
  저녁: "#a87a7a",
  심야: "#7a7aa8",
};

// ── 변화율 pill ───────────────────────────────────────────────────────────────

function ChangePill({ rate }: { rate: number | null }) {
  if (rate === null)
    return <span className="text-[11px] text-[#aaa]">전월 데이터 없음</span>;
  if (rate === 0)
    return (
      <span className="inline-flex items-center gap-0.5 rounded-[3px] bg-[#e8e3d8] px-1.5 py-0.5 text-[11px] text-[#8c7e66]">
        <Minus size={10} /> 변동없음
      </span>
    );
  const up = rate > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-[3px] px-1.5 py-0.5 text-[11px] font-mono font-semibold ${up ? "bg-[#e8edd8] text-[#4a5c28]" : "bg-[#f4e8e0] text-[#8a3a28]"}`}
    >
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {up ? "+" : ""}
      {rate.toFixed(1)}%
    </span>
  );
}

// ── 일별 바 차트 (SVG, ResizeObserver 기반) ───────────────────────────────────

function DailyBarChart({ series }: { series: DayPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(400);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((e) =>
      setW(Math.floor(e[0].contentRect.width)),
    );
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const H = 150,
    PAD_T = 16,
    PAD_B = 28,
    PAD_X = 4;
  const maxSales = Math.max(...series.map((d) => d.sales), 1);
  const colW = (W - PAD_X * 2) / series.length;
  const barW = Math.max(2, colW - 1.5);
  const plotH = H - PAD_T - PAD_B;

  const today = new Date().getDate();
  const hasData = series.some((d) => d.sales > 0);
  const totalDays = series.length;

  // 주차 구분선: 7일마다 (day 8, 15, 22 앞)
  const weekBoundaries = [7, 14, 21].filter((d) => d < totalDays);
  // 주차 레이블 중심 (각 구간 중앙)
  const weekLabels = [
    { label: "1주", center: 3.5 },
    { label: "2주", center: 10.5 },
    { label: "3주", center: 17.5 },
    { label: "4주", center: Math.min(24.5, (21 + totalDays) / 2) },
  ].filter((w) => w.center < totalDays);

  const barX = (i: number) => PAD_X + i * colW;

  return (
    <div ref={containerRef} className="w-full">
      <svg width={W} height={H} style={{ display: "block" }}>
        {/* 수평 가이드라인 */}
        {[0.5, 1].map((r) => {
          const y = PAD_T + plotH * (1 - r);
          return (
            <line
              key={r}
              x1={PAD_X}
              y1={y}
              x2={W - PAD_X}
              y2={y}
              stroke="#e8e3d8"
              strokeWidth={0.8}
            />
          );
        })}

        {/* 주차 구분 수직선 */}
        {weekBoundaries.map((d) => {
          const x = barX(d);
          return (
            <line
              key={d}
              x1={x}
              y1={PAD_T}
              x2={x}
              y2={PAD_T + plotH}
              stroke="#b8b0a4"
              strokeWidth={1.2}
              strokeDasharray="4 3"
            />
          );
        })}

        {/* 바 */}
        {series.map((d, i) => {
          const x = barX(i);
          const barH = maxSales ? (d.sales / maxSales) * plotH : 0;
          const y = PAD_T + plotH - barH;
          const isToday = d.day === today;
          return (
            <g key={i}>
              <rect
                x={x + 0.75}
                y={y}
                width={barW}
                height={barH}
                rx={2}
                fill={isToday ? "#d95f3b" : d.sales > 0 ? "#a3b07a" : "#e8e3d8"}
                opacity={0.9}
              />
              {/* 오늘: 위에 점 + 아래 레이블 */}
              {isToday && (
                <>
                  <circle
                    cx={x + barW / 2 + 0.75}
                    cy={y - 5}
                    r={3.5}
                    fill="#d95f3b"
                  />
                  <text
                    x={x + barW / 2 + 0.75}
                    y={H - 7}
                    textAnchor="middle"
                    fontSize={12}
                    fill="#d95f3b"
                    fontWeight="800"
                  >
                    오늘
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* 주차 레이블 */}
        {weekLabels.map(({ label, center }) => {
          const x = barX(center);
          return (
            <text
              key={label}
              x={x}
              y={H - 7}
              textAnchor="middle"
              fontSize={12}
              fill="#777"
              fontWeight="600"
            >
              {label}
            </text>
          );
        })}

        {/* 데이터 없을 때 안내 */}
        {!hasData && (
          <text
            x={W / 2}
            y={PAD_T + plotH / 2}
            textAnchor="middle"
            fontSize={12}
            fill="#c8c0b0"
          >
            이번 달 매출 데이터 없음
          </text>
        )}
      </svg>
    </div>
  );
}

// ── 카테고리별 매출 비중 차트 ─────────────────────────────────────────────────

function CategoryBreakdownChart({
  items,
  total,
}: {
  items: CategoryItem[];
  total: number;
}) {
  if (!items.length || total === 0) {
    return (
      <p className="py-4 text-center text-[12px] text-[#bbb]">
        카테고리 데이터 없음
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.category} className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-right text-[12px] font-semibold text-[#3a3228]">
            {item.category}
          </span>
          <div className="relative flex-1 h-5 rounded-[3px] bg-[#f0ede8] overflow-hidden">
            <div
              className="h-full rounded-[3px] transition-all"
              style={{
                width: `${item.pct}%`,
                backgroundColor: getCatColor(item.category),
              }}
            />
          </div>
          <span className="w-8 shrink-0 font-mono text-[11px] text-[#8c7e66]">
            {item.pct}%
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-[11px] text-[#5a5040]">
            {fmt(item.amount)}원
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 시간대별 매출 차트 (SVG) ──────────────────────────────────────────────────

// 시간대 슬롯 정의 (시작시간, 끝시간, 이름, 색상)
const HOURLY_SLOTS = [
  { start: 0, end: 6, label: "새벽", color: SLOT_COLORS["새벽"] },
  { start: 6, end: 12, label: "오전", color: SLOT_COLORS["오전"] },
  { start: 12, end: 14, label: "점심", color: SLOT_COLORS["점심"] },
  { start: 14, end: 18, label: "오후", color: SLOT_COLORS["오후"] },
  { start: 18, end: 22, label: "저녁", color: SLOT_COLORS["저녁"] },
  { start: 22, end: 24, label: "심야", color: SLOT_COLORS["심야"] },
];

function HourlyBarChart({
  series,
  peakHour,
}: {
  series: HourlyPoint[];
  peakHour: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(400);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((e) =>
      setW(Math.floor(e[0].contentRect.width)),
    );
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const H = 170,
    PAD_T = 10,
    PAD_B = 36,
    PAD_X = 2;
  const maxAmt = Math.max(...series.map((d) => d.amount), 1);
  const colW = (W - PAD_X * 2) / 24;
  const barW = Math.max(2, colW - 1);
  const plotH = H - PAD_T - PAD_B;
  const hasData = series.some((d) => d.amount > 0);

  const barX = (h: number) => PAD_X + h * colW;
  // 슬롯 중앙 x 좌표
  const slotCenterX = (s: (typeof HOURLY_SLOTS)[0]) =>
    barX((s.start + s.end) / 2);

  return (
    <div ref={containerRef} className="w-full">
      <svg width={W} height={H} style={{ display: "block" }}>
        {/* 수평 가이드라인 */}
        {[0.5, 1].map((r) => {
          const y = PAD_T + plotH * (1 - r);
          return (
            <line
              key={r}
              x1={PAD_X}
              y1={y}
              x2={W - PAD_X}
              y2={y}
              stroke="#e8e3d8"
              strokeWidth={0.8}
            />
          );
        })}

        {/* 슬롯 구분 수직선 */}
        {HOURLY_SLOTS.slice(1).map((s) => {
          const x = barX(s.start);
          return (
            <line
              key={s.label}
              x1={x}
              y1={PAD_T}
              x2={x}
              y2={PAD_T + plotH}
              stroke="#b8b0a4"
              strokeWidth={1.2}
              strokeDasharray="4 3"
            />
          );
        })}

        {/* 바 */}
        {series.map((d) => {
          const x = barX(d.hour);
          const barH = maxAmt ? (d.amount / maxAmt) * plotH : 0;
          const y = PAD_T + plotH - barH;
          const isPeak = d.hour === peakHour;
          const slot = HOURLY_SLOTS.find(
            (s) => d.hour >= s.start && d.hour < s.end,
          );
          const color = isPeak ? "#7f8f54" : (slot?.color ?? "#b0a89a");
          return (
            <g key={d.hour}>
              <rect
                x={x + 0.5}
                y={y}
                width={barW}
                height={barH}
                rx={1.5}
                fill={color}
                opacity={0.88}
              />
              {isPeak && (
                <circle
                  cx={x + barW / 2 + 0.5}
                  cy={y - 5}
                  r={3}
                  fill="#7f8f54"
                />
              )}
            </g>
          );
        })}

        {/* 슬롯 이름 레이블 */}
        {HOURLY_SLOTS.map((s) => (
          <text
            key={s.label}
            x={slotCenterX(s)}
            y={H - 19}
            textAnchor="middle"
            fontSize={12}
            fill="#555"
            fontWeight="700"
          >
            {s.label}
          </text>
        ))}

        {/* 슬롯 시작 시각 (경계값만) */}
        {HOURLY_SLOTS.map((s) => (
          <text
            key={`t-${s.start}`}
            x={barX(s.start) + 1}
            y={H - 5}
            textAnchor="middle"
            fontSize={10}
            fill="#999"
            fontFamily="monospace"
          >
            {s.start}시
          </text>
        ))}

        {!hasData && (
          <text
            x={W / 2}
            y={PAD_T + plotH / 2}
            textAnchor="middle"
            fontSize={12}
            fill="#c8c0b0"
          >
            데이터 없음
          </text>
        )}
      </svg>
    </div>
  );
}

// ── 성장 단계 배지 ────────────────────────────────────────────────────────────

const STAGE_META = {
  early: { emoji: "🌱", label: "창업 초기", color: "#6a8f5a", bg: "#eef5e8" },
  growing: { emoji: "📈", label: "성장 중", color: "#5a7aaf", bg: "#e8eef8" },
  stable: { emoji: "💪", label: "안정 운영", color: "#8a6a3a", bg: "#f5ede0" },
};

// ── 비교 카드 (지난달 / 전년 동월) ───────────────────────────────────────────

function trendMeta(rate: number | null): {
  emoji: string;
  word: string;
  color: string;
} {
  if (rate === null) return { emoji: "—", word: "", color: "#bbb" };
  if (rate > 20) return { emoji: "🚀", word: "크게 성장!", color: "#4a5c28" };
  if (rate > 5) return { emoji: "📈", word: "성장 중이에요", color: "#4a7c28" };
  if (rate > -5) return { emoji: "➡️", word: "비슷한 수준", color: "#8c7e66" };
  return { emoji: "📉", word: "아쉬운 달이었어요", color: "#8a3a28" };
}

function ComparisonCard({
  label,
  current,
  previous,
  changeRate,
  noDataLabel,
}: {
  label: string;
  current: number;
  previous: number;
  changeRate: number | null;
  noDataLabel: string;
}) {
  const trend = trendMeta(changeRate);
  const hasData = previous > 0 || current > 0;

  return (
    <div className="flex-1 rounded-[5px] border border-[#e8e3d8] bg-white px-3 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#aaa]">
        {label}
      </p>

      {!hasData ? (
        <div className="flex flex-col items-center gap-1 py-2 text-center">
          <span className="text-[20px]">📊</span>
          <p className="text-[11px] text-[#bbb]">{noDataLabel}</p>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-end justify-between">
            <div>
              <p className="text-[10px] text-[#aaa]">이번달</p>
              <p className="text-[15px] font-bold text-[#2e2719]">
                {fmt(current)}원
              </p>
            </div>
            {previous > 0 && (
              <div className="text-right">
                <p className="text-[10px] text-[#aaa]">이전</p>
                <p className="text-[12px] text-[#8c7e66]">{fmt(previous)}원</p>
              </div>
            )}
          </div>
          {previous > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[14px]">{trend.emoji}</span>
              <span
                className="font-mono text-[12px] font-bold"
                style={{ color: trend.color }}
              >
                {changeRate !== null
                  ? `${changeRate > 0 ? "+" : ""}${changeRate}%`
                  : ""}
              </span>
              <span className="text-[11px]" style={{ color: trend.color }}>
                {trend.word}
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-[#bbb]">비교 데이터 없음</p>
          )}
        </>
      )}
    </div>
  );
}

// ── 요일별 매출 패턴 ──────────────────────────────────────────────────────────

function DowChart({
  dowAvg,
  bestDay,
}: {
  dowAvg: { day: string; avg: number }[];
  bestDay: string | null;
}) {
  const maxAvg = Math.max(...dowAvg.map((d) => d.avg), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {dowAvg.map(({ day, avg }) => {
        const pct = (avg / maxAvg) * 100;
        const isBest = day === bestDay;
        return (
          <div key={day} className="flex items-center gap-2">
            <span
              className={`w-4 shrink-0 text-center text-[12px] font-bold ${isBest ? "text-[#d95f3b]" : "text-[#8c7e66]"}`}
            >
              {day}
            </span>
            <div className="flex-1 h-[18px] rounded-[3px] bg-[#f0ede8] overflow-hidden">
              <div
                className="h-full rounded-[3px] transition-all"
                style={{
                  width: `${pct}%`,
                  backgroundColor: isBest ? "#d95f3b" : "#a3b07a",
                }}
              />
            </div>
            <span
              className={`w-16 shrink-0 text-right font-mono text-[11px] ${isBest ? "font-bold text-[#d95f3b]" : "text-[#8c7e66]"}`}
            >
              {avg > 0 ? `${fmt(avg)}원` : "—"}
            </span>
            {isBest && <span className="text-[11px]">⭐</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── 비교 기간 드롭박스 ────────────────────────────────────────────────────────

function PeriodDropdown({
  periods,
  selected,
  onChange,
  loading,
}: {
  periods: ComparePeriod[];
  selected: number;
  onChange: (months_ago: number) => void;
  loading: boolean;
}) {
  if (!periods.length) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] text-[#8c7e66]">비교 기간</span>
      <div className="relative flex-1">
        <select
          value={selected}
          disabled={loading}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full appearance-none rounded-[5px] border border-[#d0cbbf] bg-white py-1.5 pl-3 pr-7 text-[12px] text-[#3a3228] focus:outline-none focus:ring-1 focus:ring-[#a3b07a] disabled:opacity-50"
        >
          {periods.map((p) => (
            <option key={p.months_ago} value={p.months_ago}>
              {p.label}
              {!p.has_sufficient_data ? "  ⚠️ 데이터 부족" : ""}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#999]">
          ▾
        </span>
      </div>
      {loading && (
        <span className="shrink-0 text-[11px] text-[#aaa]">분석 중...</span>
      )}
    </div>
  );
}

// ── AI 인사이트 카드 ──────────────────────────────────────────────────────────

const HIGHLIGHT_STYLE: Record<
  AIHighlight["type"],
  { icon: string; label: string; bg: string; color: string; labelColor: string }
> = {
  positive: {
    icon: "✅",
    label: "잘 된 점",
    bg: "#f0f6e8",
    color: "#3a5c1a",
    labelColor: "#5a8a3a",
  },
  warning: {
    icon: "⚠️",
    label: "주의할 점",
    bg: "#fff8e8",
    color: "#7a5a10",
    labelColor: "#a07820",
  },
  insight: {
    icon: "💡",
    label: "발견한 패턴",
    bg: "#e8f0f8",
    color: "#2a4a70",
    labelColor: "#4a6a90",
  },
};

function AIInsightCard({ result }: { result: AIResult }) {
  return (
    <div className="flex flex-col gap-3">
      {/* 요약 */}
      <p className="text-[13px] font-semibold leading-snug text-[#2e2719]">
        {result.summary}
      </p>

      {/* 하이라이트 3개 */}
      <div className="flex flex-col gap-2">
        {result.highlights.map((h, i) => {
          const s = HIGHLIGHT_STYLE[h.type] ?? HIGHLIGHT_STYLE.insight;
          return (
            <div
              key={i}
              className="rounded-[5px] px-3 py-2.5"
              style={{ backgroundColor: s.bg }}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[12px]">{s.icon}</span>
                <span
                  className="text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: s.labelColor }}
                >
                  {s.label}
                </span>
              </div>
              <p
                className="text-[12px] leading-relaxed"
                style={{ color: s.color }}
              >
                {h.text}
              </p>
            </div>
          );
        })}
      </div>

      {/* 오늘 실천할 것 */}
      <div className="rounded-[5px] border border-[#d0cbbf] bg-white px-3 py-2.5">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#aaa]">
          오늘 실천할 것
        </p>
        <p className="text-[12px] leading-relaxed text-[#3a3228]">
          → {result.action}
        </p>
      </div>
    </div>
  );
}

// ── 성장 단계 가이드 ──────────────────────────────────────────────────────────

const STAGE_GUIDE = [
  {
    key: "early" as const,
    emoji: "🌱",
    label: "창업 초기",
    range: "데이터 1개월 이하",
    desc: "매출 기록을 막 시작한 단계예요. 비교할 과거가 아직 없어요.",
  },
  {
    key: "growing" as const,
    emoji: "📈",
    label: "성장 중",
    range: "2~6개월 데이터 보유",
    desc: "패턴이 잡히기 시작하는 시기예요. 어떤 요일·시간대가 잘 팔리는지 눈에 보여요.",
  },
  {
    key: "stable" as const,
    emoji: "💪",
    label: "안정 운영",
    range: "7개월 이상 데이터 보유",
    desc: "충분한 이력이 쌓였어요. 계절 패턴·연간 성장률 비교가 가능해요.",
  },
];

function StageGuide({
  currentStage,
}: {
  currentStage: "early" | "growing" | "stable";
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-[5px] border border-[#e8e3d8] bg-[#fdfcf8] px-3 py-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#aaa]">
          평가 단계 기준
        </p>
        <span className="text-[11px] text-[#bbb]">
          {open ? "접기 ▲" : "펼치기 ▼"}
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {STAGE_GUIDE.map((s) => {
            const isCurrent = s.key === currentStage;
            return (
              <div
                key={s.key}
                className={`flex items-start gap-2 rounded-[4px] px-2 py-1.5 ${isCurrent ? "bg-[#f0f4e8]" : ""}`}
              >
                <span className="mt-0.5 shrink-0 text-[13px]">{s.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[12px] font-semibold ${isCurrent ? "text-[#4a5c28]" : "text-[#5a5040]"}`}
                    >
                      {s.label}
                    </span>
                    <span className="rounded-full bg-[#e8e3d8] px-1.5 py-0.5 font-mono text-[9px] text-[#8c7e66]">
                      {s.range}
                    </span>
                    {isCurrent && (
                      <span className="rounded-full bg-[#7f8f54] px-1.5 py-0.5 text-[9px] font-semibold text-white">
                        현재
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#8c7e66]">{s.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 벤치마크 통합 섹션 ────────────────────────────────────────────────────────

function BenchmarkSection({
  benchmark,
  insight,
  periods,
  selectedPeriod,
  onPeriodChange,
  periodLoading,
}: {
  benchmark: BenchmarkData | null;
  insight: BenchmarkInsightData | null;
  periods: ComparePeriod[];
  selectedPeriod: number;
  onPeriodChange: (months_ago: number) => void;
  periodLoading: boolean;
}) {
  const stage = insight?.growth_stage ?? "early";
  const meta = STAGE_META[stage];
  const months = insight?.months_of_data ?? 0;
  const hasYearData = months >= 12;
  const selectedPeriodInfo = periods.find(
    (p) => p.months_ago === selectedPeriod,
  );

  if (!benchmark && months === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-[5px] border border-[#e8e3d8] bg-white px-4 py-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-[28px]">🌱</span>
          <p className="text-[13px] font-semibold text-[#2e2719]">
            아직 비교할 매출 데이터가 없어요
          </p>
          <p className="text-[12px] text-[#8c7e66]">
            매출을 입력하면 지난달·전년과 비교해
            <br />
            성장 흐름을 분석해드려요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-[5px] border border-[#e8e3d8] bg-white px-4 py-4">
      {/* 성장 단계 배지 */}
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: meta.bg, color: meta.color }}
        >
          {meta.emoji} {meta.label}
        </span>
        {months > 0 && (
          <span className="text-[11px] text-[#aaa]">
            {months}개월째 운영 중
          </span>
        )}
      </div>

      {/* 비교 기간 드롭박스 */}
      {periods.length > 0 && (
        <div className="flex flex-col gap-1">
          <PeriodDropdown
            periods={periods}
            selected={selectedPeriod}
            onChange={onPeriodChange}
            loading={periodLoading}
          />
          <p className="text-[10px] text-[#aaa]">
            💡 전년 동월 비교가 가장 정확해요 — 계절 요인을 제거하고 순수한
            성장만 볼 수 있어요.
            {!hasYearData && " 1년치 데이터가 쌓이면 자동 활성화돼요."}
          </p>
        </div>
      )}

      {/* 데이터 부족 경고 */}
      {selectedPeriodInfo && !selectedPeriodInfo.has_sufficient_data && (
        <div className="rounded-[5px] border border-[#f0d8b0] bg-[#fffaf0] px-3 py-2">
          <p className="text-[11px] text-[#8a6a20]">
            ⚠️ 선택한 기간({selectedPeriodInfo.label})의 데이터가{" "}
            {selectedPeriodInfo.record_count}건으로 적어요. 비교 결과가 정확하지
            않을 수 있어요.
          </p>
        </div>
      )}

      {/* AI 인사이트 */}
      <div className="rounded-[5px] bg-[#f8f6f0] px-3 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#a3946a]">
          AI 분석
        </p>
        {insight?.ai_result ? (
          <AIInsightCard result={insight.ai_result} />
        ) : insight?.narrative ? (
          <p className="text-[12px] leading-relaxed text-[#3a3228]">
            {insight.narrative}
          </p>
        ) : (
          <p className="text-[12px] leading-relaxed text-[#6a5a40]">
            매출 데이터가 쌓일수록 AI가 더 정확한 성장 패턴을 분석해드려요.
            꾸준히 입력해보세요! 📊
          </p>
        )}
      </div>

      {/* 비교 카드 */}
      {benchmark?.vs_compare && (
        <ComparisonCard
          label={benchmark.vs_compare.label}
          current={benchmark.vs_compare.current}
          previous={benchmark.vs_compare.previous}
          changeRate={benchmark.vs_compare.change_rate}
          noDataLabel="해당 기간 데이터 없음"
        />
      )}

      {/* 예상 월매출 — 알고리즘 개선 후 별도 브랜치에서 활성화 예정 */}
      {false &&
        insight?.monthly_prediction &&
        insight!.monthly_prediction! > 0 &&
        insight!.prediction_basis && (
          <div className="rounded-[5px] bg-[#f0f4e8] px-3 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#4a5c28]">
                이번달 예상 매출
              </span>
              <span className="font-mono text-[14px] font-bold text-[#4a5c28]">
                약 {fmt(insight!.monthly_prediction!)}원
              </span>
            </div>
            <div className="mt-1.5 rounded-[4px] bg-[#e4edcc] px-2.5 py-1.5">
              <p className="text-[10px] text-[#5a6e30]">
                📐 <strong>계산 근거</strong> —{" "}
                {insight!.prediction_basis!.elapsed_days}일 경과 · 일평균{" "}
                {fmt(insight!.prediction_basis!.daily_avg)}원 ×{" "}
                {insight!.prediction_basis!.total_days}일
              </p>
              <p className="mt-1 text-[10px] text-[#7a8a50]">
                ⚠️ 단순 일평균 비례 추산이에요. 주말·행사·계절 요인은 반영되지
                않아 실제 매출과 차이가 날 수 있어요. <strong>참고 지표</strong>
                로만 활용하세요.
              </p>
            </div>
          </div>
        )}

      {/* 성장 단계 가이드 */}
      <StageGuide currentStage={stage} />
    </div>
  );
}

// ── 메인 패널 ─────────────────────────────────────────────────────────────────

export function RevenueStatsPanel({ accountId }: { accountId: string }) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [goal, setGoal] = useState<GoalData | null>(null);
  const [categoryData, setCategoryData] =
    useState<CategoryBreakdownData | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyData | null>(null);
  const [insight, setInsight] = useState<BenchmarkInsightData | null>(null);
  const [availablePeriods, setAvailablePeriods] = useState<ComparePeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<number>(1);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const prevPeriodRef = useRef<number>(1);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    setError(false);
    prevPeriodRef.current = 1;
    setSelectedPeriod(1);

    Promise.all([
      fetch(`${API}/api/stats/overview?account_id=${accountId}`).then((r) =>
        r.json(),
      ),
      fetch(`${API}/api/stats/daily?account_id=${accountId}`).then((r) =>
        r.json(),
      ),
      fetch(
        `${API}/api/stats/personal-benchmark?account_id=${accountId}&compare_months_ago=1`,
      ).then((r) => r.json()),
      fetch(`${API}/api/stats/goal?account_id=${accountId}`).then((r) =>
        r.json(),
      ),
      fetch(`${API}/api/stats/category-breakdown?account_id=${accountId}`).then(
        (r) => r.json(),
      ),
      fetch(`${API}/api/stats/hourly?account_id=${accountId}`).then((r) =>
        r.json(),
      ),
      fetch(
        `${API}/api/stats/benchmark-insight?account_id=${accountId}&compare_months_ago=1`,
      ).then((r) => r.json()),
      fetch(
        `${API}/api/stats/available-compare-periods?account_id=${accountId}`,
      ).then((r) => r.json()),
    ])
      .then(([ov, dv, bm, gl, cat, hr, ins, ap]) => {
        setOverview(ov.data ?? null);
        setSeries(dv.data?.series ?? []);
        setBenchmark(bm.data ?? null);
        setGoal(gl.data ?? null);
        setCategoryData(cat.data ?? null);
        setHourlyData(hr.data ?? null);
        setInsight(ins.data ?? null);
        setAvailablePeriods(ap.data?.periods ?? []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [accountId]);

  // 드롭박스 기간 변경 시에만 재조회 (초기 마운트 제외)
  const fetchBenchmarkData = useCallback(
    async (months_ago: number) => {
      setPeriodLoading(true);
      try {
        const [bm, ins] = await Promise.all([
          fetch(
            `${API}/api/stats/personal-benchmark?account_id=${accountId}&compare_months_ago=${months_ago}`,
          ).then((r) => r.json()),
          fetch(
            `${API}/api/stats/benchmark-insight?account_id=${accountId}&compare_months_ago=${months_ago}`,
          ).then((r) => r.json()),
        ]);
        setBenchmark(bm.data ?? null);
        setInsight(ins.data ?? null);
      } catch {
        // 기존 데이터 유지
      } finally {
        setPeriodLoading(false);
      }
    },
    [accountId],
  );

  const fetchBenchmarkDataRef = useRef(fetchBenchmarkData);
  useEffect(() => {
    fetchBenchmarkDataRef.current = fetchBenchmarkData;
  }, [fetchBenchmarkData]);

  useEffect(() => {
    if (!accountId) return;
    if (selectedPeriod === prevPeriodRef.current) return;
    prevPeriodRef.current = selectedPeriod;
    fetchBenchmarkDataRef.current(selectedPeriod);
  }, [selectedPeriod, accountId]);

  if (loading)
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[#aaa]">
        통계 불러오는 중...
      </div>
    );

  if (error)
    return (
      <div className="flex h-40 items-center justify-center text-[13px] text-[#c05a3a]">
        통계를 불러오지 못했어요.
      </div>
    );

  const noData = !overview || overview.sales.total === 0;

  // ── 데이터 없음 (창업 준비 중 등) ─────────────────────────────────────────
  if (noData)
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="text-[32px]">📊</div>
        <div>
          <p className="text-[14px] font-semibold text-[#2e2719]">
            아직 매출 데이터가 없어요
          </p>
          <p className="mt-1 text-[12px] text-[#8c7e66]">
            챗봇에서 오늘 매출을 입력하면
            <br />
            여기에 통계가 자동으로 쌓여요.
          </p>
        </div>
        <div className="rounded-[5px] border border-[#d0cbbf] bg-[#faf8f3] px-4 py-3 text-left text-[12px] text-[#5a5040]">
          <p className="mb-1.5 font-semibold text-[#4a5c28]">
            이렇게 입력해보세요 💬
          </p>
          <p className="text-[#6a7843]">
            "오늘 아메리카노 30잔, 라떼 20잔 팔았어"
          </p>
          <p className="mt-1 text-[#6a7843]">"이번 주 매출 알려줘"</p>
        </div>
      </div>
    );

  // ── 데이터 있음 ────────────────────────────────────────────────────────────
  const { sales, costs, profit, year, month } = overview;
  const monthLabel = `${year}년 ${MONTH_KO[month - 1]}`;
  const dataDays = series.filter((d) => d.sales > 0).length;
  const fewData = dataDays < 5;

  return (
    <div className="flex flex-col gap-5">
      {/* 데이터 부족 안내 배너 */}
      {fewData && (
        <div className="flex items-center gap-2 rounded-[5px] border border-[#d0cbbf] bg-[#faf8f3] px-3 py-2">
          <span className="text-[14px]">📈</span>
          <p className="text-[12px] text-[#5a5040]">
            데이터가 쌓일수록 분석이 정확해져요.{" "}
            <span className="font-semibold text-[#4a5c28]">
              매출을 더 입력해보세요!
            </span>
          </p>
        </div>
      )}

      {/* 기간 라벨 */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-[#2e2719]">
          {monthLabel} 현황
        </span>
        <span className="font-mono text-[11px] text-[#aaa]">
          일평균 {fmt(sales.daily_avg)}원
        </span>
      </div>

      {/* 요약 3카드 */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: "매출",
            value: sales.total,
            rate: sales.change_rate,
            color: "#4a5c28",
            bg: "#f0f4e8",
          },
          {
            label: "비용",
            value: costs.total,
            rate: costs.change_rate,
            color: "#8a3a28",
            bg: "#f9f0ec",
          },
          {
            label: "순이익",
            value: profit.total,
            rate: profit.change_rate,
            color: profit.total >= 0 ? "#4a5c28" : "#8a3a28",
            bg: profit.total >= 0 ? "#f0f4e8" : "#f9f0ec",
          },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-[5px] border border-[#d0cbbf] bg-white p-3"
          >
            <p className="text-[11px] text-[#8c7e66]">{c.label}</p>
            <p
              className="mt-1 text-[15px] font-bold"
              style={{ color: c.color }}
            >
              {fmt(c.value)}원
            </p>
            <div className="mt-1.5">
              <ChangePill rate={c.rate} />
            </div>
          </div>
        ))}
      </div>

      {/* 목표 달성률 게이지 */}
      {goal && goal.monthly_goal > 0 && (
        <div className="rounded-[5px] border border-[#e8e3d8] bg-white px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase text-[#999]">
              이번달 목표
            </span>
            <span className="text-[13px] font-semibold text-[#2c2c2c]">
              {fmt(goal.monthly_goal)}원
            </span>
          </div>
          <div className="mb-1 h-2 w-full rounded-full bg-[#f0ede8]">
            <div
              className="h-2 rounded-full bg-[#7f8f54] transition-all"
              style={{ width: `${Math.min(goal.achievement_rate ?? 0, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#999]">
              {goal.achievement_rate !== null
                ? `${goal.achievement_rate}% 달성`
                : "데이터 없음"}
            </span>
            {goal.remaining !== null && goal.remaining > 0 && (
              <span className="text-[11px] text-[#999]">
                잔여 {fmt(goal.remaining)}원
              </span>
            )}
          </div>
        </div>
      )}

      {/* 일별 바 차트 */}
      <div>
        <p className="mb-2 text-[12px] font-semibold text-[#5a5040]">
          일별 매출
        </p>
        <div className="rounded-[5px] border border-[#e8e3d8] bg-[#fdfcf8] p-3">
          <DailyBarChart series={series} />
          <p className="mt-1 text-right font-mono text-[10px] text-[#bbb]">
            최대 {fmt(Math.max(...series.map((d) => d.sales), 0))}원
          </p>
        </div>
      </div>

      {/* 카테고리별 매출 비중 */}
      {categoryData && categoryData.total > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-semibold text-[#5a5040]">
            카테고리별 매출 비중
          </p>
          <div className="rounded-[5px] border border-[#e8e3d8] bg-[#fdfcf8] px-4 py-3">
            <CategoryBreakdownChart
              items={categoryData.items}
              total={categoryData.total}
            />
          </div>
        </div>
      )}

      {/* 시간대별 매출 분포 */}
      {hourlyData && hourlyData.series.some((d) => d.amount > 0) && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[#5a5040]">
              시간대별 매출
            </p>
            {hourlyData.peak_hour !== null && (
              <span className="font-mono text-[11px] text-[#7f8f54]">
                피크 {hourlyData.peak_hour}시 ({hourlyData.peak_slot})
              </span>
            )}
          </div>
          <div className="rounded-[5px] border border-[#e8e3d8] bg-[#fdfcf8] p-3">
            <HourlyBarChart
              series={hourlyData.series}
              peakHour={hourlyData.peak_hour}
            />
          </div>
        </div>
      )}

      {/* 요일별 매출 패턴 (최근 8주) */}
      {benchmark?.dow_avg && benchmark.dow_avg.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[#5a5040]">
              요일별 매출 패턴
              {benchmark.best_day_of_week && (
                <span className="ml-1.5 font-normal text-[#d95f3b]">
                  — {benchmark.best_day_of_week}요일이 최고예요
                </span>
              )}
            </p>
            <span className="font-mono text-[10px] text-[#bbb]">
              최근 8주 기준{!benchmark.dow_reliable && " · 데이터 축적 중"}
            </span>
          </div>
          <div className="rounded-[5px] border border-[#e8e3d8] bg-[#fdfcf8] px-4 py-3">
            <DowChart
              dowAvg={benchmark.dow_avg}
              bestDay={benchmark.best_day_of_week}
            />
          </div>
        </div>
      )}

      {/* 나 vs 과거의 나 — AI 벤치마킹 */}
      <div>
        <p className="mb-2 text-[12px] font-semibold text-[#5a5040]">
          나 vs 과거의 나
        </p>
        <BenchmarkSection
          benchmark={benchmark}
          insight={insight}
          periods={availablePeriods}
          selectedPeriod={selectedPeriod}
          onPeriodChange={setSelectedPeriod}
          periodLoading={periodLoading}
        />
      </div>
    </div>
  );
}
