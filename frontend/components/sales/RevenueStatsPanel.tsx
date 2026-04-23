"use client";

import { useEffect, useRef, useState } from "react";
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

type BenchmarkData = {
  vs_last_month: { change_rate: number | null; label: string };
  vs_last_year: { change_rate: number | null; label: string };
  best_day_of_week: string | null;
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

  const H = 110,
    PAD_T = 8,
    PAD_B = 24,
    PAD_X = 4;
  const maxSales = Math.max(...series.map((d) => d.sales), 1);
  const barW = Math.max(2, (W - PAD_X * 2) / series.length - 1.5);
  const plotH = H - PAD_T - PAD_B;

  const today = new Date().getDate();
  const hasData = series.some((d) => d.sales > 0);

  return (
    <div ref={containerRef} className="w-full">
      <svg width={W} height={H} style={{ display: "block" }}>
        {/* 가이드라인 */}
        {[0.25, 0.5, 0.75, 1].map((r) => {
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

        {/* 바 */}
        {series.map((d, i) => {
          const x = PAD_X + i * ((W - PAD_X * 2) / series.length);
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
                fill={isToday ? "#7f8f54" : d.sales > 0 ? "#a3b07a" : "#e8e3d8"}
                opacity={0.9}
              />
              {/* 오늘 표시 */}
              {isToday && (
                <text
                  x={x + barW / 2 + 0.75}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#7f8f54"
                  fontWeight="600"
                >
                  오늘
                </text>
              )}
            </g>
          );
        })}

        {/* X축 날짜 (1일·10일·20일·말일만) */}
        {series
          .filter((d) => [1, 10, 20, series.length].includes(d.day))
          .map((d) => {
            const i = d.day - 1;
            const x = PAD_X + i * ((W - PAD_X * 2) / series.length) + barW / 2;
            return (
              <text
                key={d.day}
                x={x}
                y={H - 6}
                textAnchor="middle"
                fontSize={9}
                fill="#aaa"
                fontFamily="monospace"
              >
                {d.day}일
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

// ── 메인 패널 ─────────────────────────────────────────────────────────────────

export function RevenueStatsPanel({ accountId }: { accountId: string }) {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [series, setSeries] = useState<DayPoint[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [goal, setGoal] = useState<GoalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    setError(false);

    Promise.all([
      fetch(`${API}/api/stats/overview?account_id=${accountId}`).then((r) =>
        r.json(),
      ),
      fetch(`${API}/api/stats/daily?account_id=${accountId}`).then((r) =>
        r.json(),
      ),
      fetch(`${API}/api/stats/personal-benchmark?account_id=${accountId}`).then(
        (r) => r.json(),
      ),
      fetch(`${API}/api/stats/goal?account_id=${accountId}`).then((r) =>
        r.json(),
      ),
    ])
      .then(([ov, dv, bm, gl]) => {
        setOverview(ov.data ?? null);
        setSeries(dv.data?.series ?? []);
        setBenchmark(bm.data ?? null);
        setGoal(gl.data ?? null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [accountId]);

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

      {/* 개인 히스토리 벤치마킹 */}
      {benchmark && (
        <div className="rounded-[5px] border border-[#e8e3d8] bg-white px-4 py-3">
          <p className="mb-3 font-mono text-[11px] uppercase text-[#999]">
            나 vs 과거의 나
          </p>
          <div className="flex gap-3">
            {[benchmark.vs_last_month, benchmark.vs_last_year].map((v) => (
              <div
                key={v.label}
                className="flex flex-1 flex-col items-center gap-1 rounded-[5px] bg-[#f9f7f4] px-3 py-2"
              >
                <span className="text-[11px] text-[#999]">{v.label}</span>
                <span
                  className={`text-base font-semibold ${
                    v.change_rate === null
                      ? "text-[#bbb]"
                      : v.change_rate >= 0
                        ? "text-[#4a5c28]"
                        : "text-[#8a3a28]"
                  }`}
                >
                  {v.change_rate === null
                    ? "—"
                    : `${v.change_rate >= 0 ? "+" : ""}${v.change_rate}%`}
                </span>
              </div>
            ))}
          </div>
          {benchmark.best_day_of_week && (
            <p className="mt-2 text-center text-[11px] text-[#999]">
              최근 8주 최고 요일:{" "}
              <strong className="text-[#4a5c28]">
                {benchmark.best_day_of_week}요일
              </strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
