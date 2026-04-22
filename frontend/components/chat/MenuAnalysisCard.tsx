"use client";

import { useState, useRef, useEffect } from "react";
import { BarChart2, PieChart, Crosshair } from "lucide-react";

export type MenuAnalysisItem = {
  rank: number;
  item_name: string;
  category: string;
  total_quantity: number;
  total_amount: number;
  avg_unit_price: number;
  revenue_ratio: number;
  quantity_ratio: number;
};

export type MenuAnalysisPayload = {
  period_label: string;
  start_date: string;
  end_date: string;
  total_amount: number;
  total_quantity: number;
  items: MenuAnalysisItem[];
};

// ── 색상 팔레트 ──────────────────────────────────────────────
const PALETTE = [
  "#7f8f54", "#a3b07a", "#bcc994", "#cdd8a8", "#dce4be",
  "#6b8f71", "#4a7c59", "#8fbc8f", "#5f9ea0", "#9aad7e",
];

const getCategoryColor = (() => {
  const map = new Map<string, string>();
  let idx = 0;
  return (cat: string) => {
    if (!map.has(cat)) { map.set(cat, PALETTE[idx % PALETTE.length]); idx++; }
    return map.get(cat)!;
  };
})();

// ── 마커 파서 ─────────────────────────────────────────────────
const _MENU_CHART_RE = /\[\[MENU_CHART\]\]([\s\S]*?)\[\[\/MENU_CHART\]\]/;

export const extractMenuChartPayload = (
  text: string,
): { cleaned: string; payload: MenuAnalysisPayload | null } => {
  const m = text.match(_MENU_CHART_RE);
  if (!m) return { cleaned: text, payload: null };
  let payload: MenuAnalysisPayload | null = null;
  try { payload = JSON.parse(m[1]) as MenuAnalysisPayload; } catch { payload = null; }
  const cleaned = text.replace(_MENU_CHART_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleaned, payload };
};

// ── 바 차트 탭 ────────────────────────────────────────────────
const BAR_COLORS = [
  "#7f8f54","#a3b07a","#bcc994","#cdd8a8","#dce4be",
  "#cdd8a8","#bcc994","#a3b07a","#7f8f54","#6b8f71",
];

function BarTab({ items }: { items: MenuAnalysisItem[] }) {
  const max = items[0]?.total_amount ?? 1;
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx}>
          <div className="mb-0.5 flex items-baseline justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 font-mono text-[11px] text-[#8c7e66]">{idx + 1}위</span>
              <span className="truncate text-[13px] font-medium text-[#2e2719]">{item.item_name}</span>
              <span className="shrink-0 rounded-[3px] bg-[#ede9df] px-1 py-px font-mono text-[10px] text-[#8c7e66]">{item.category}</span>
            </div>
            <div className="shrink-0 text-right">
              <span className="font-mono text-[12px] text-[#2e2719]">{item.total_amount.toLocaleString()}원</span>
              <span className="ml-1.5 font-mono text-[11px] text-[#8c7e66]">{item.revenue_ratio}%</span>
            </div>
          </div>
          <div className="h-[6px] w-full overflow-hidden rounded-full bg-[#e8e3d8]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(item.total_amount / max) * 100}%`, backgroundColor: BAR_COLORS[idx] ?? BAR_COLORS[0] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 파이(도넛) 차트 탭 ────────────────────────────────────────
function PieTab({ items }: { items: MenuAnalysisItem[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  // 카테고리별 집계
  const catMap = new Map<string, number>();
  for (const it of items) {
    catMap.set(it.category, (catMap.get(it.category) ?? 0) + it.total_amount);
  }
  const total = [...catMap.values()].reduce((a, b) => a + b, 0);
  const cats = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      ratio: total ? Math.round((amount / total) * 1000) / 10 : 0,
      color: getCategoryColor(name),
    }));

  // SVG 도넛 계산
  const R = 54, r = 30, cx = 70, cy = 70;
  let angle = -90;
  const slices = cats.map((cat) => {
    const deg = (cat.amount / total) * 360;
    const start = angle;
    angle += deg;
    return { ...cat, startDeg: start, endDeg: angle };
  });

  const toXY = (deg: number, radius: number) => ({
    x: cx + radius * Math.cos((deg * Math.PI) / 180),
    y: cy + radius * Math.sin((deg * Math.PI) / 180),
  });

  const arcPath = (s: number, e: number, outerR: number, innerR: number) => {
    const gap = 0.5;
    const s1 = toXY(s + gap, outerR), e1 = toXY(e - gap, outerR);
    const s2 = toXY(e - gap, innerR), e2 = toXY(s + gap, innerR);
    const large = e - s - gap * 2 > 180 ? 1 : 0;
    return [
      `M ${s1.x} ${s1.y}`,
      `A ${outerR} ${outerR} 0 ${large} 1 ${e1.x} ${e1.y}`,
      `L ${s2.x} ${s2.y}`,
      `A ${innerR} ${innerR} 0 ${large} 0 ${e2.x} ${e2.y}`,
      "Z",
    ].join(" ");
  };

  const hoveredCat = cats.find((c) => c.name === hovered);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {/* 도넛 SVG */}
      <div className="relative shrink-0">
        <svg width={140} height={140} viewBox="0 0 140 140">
          {slices.map((s, i) => (
            <path
              key={i}
              d={arcPath(s.startDeg, s.endDeg, R, r)}
              fill={s.color}
              opacity={hovered && hovered !== s.name ? 0.35 : 1}
              className="cursor-pointer transition-opacity duration-200"
              onMouseEnter={() => setHovered(s.name)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
          {/* 중앙 텍스트 */}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize={9} fill="#8c7e66" fontFamily="monospace">
            {hoveredCat ? hoveredCat.name : "카테고리"}
          </text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize={12} fill="#2e2719" fontWeight="600">
            {hoveredCat ? `${hoveredCat.ratio}%` : `${cats.length}종`}
          </text>
          <text x={cx} y={cy + 20} textAnchor="middle" fontSize={8} fill="#8c7e66" fontFamily="monospace">
            {hoveredCat ? `${hoveredCat.amount.toLocaleString()}원` : "매출 비중"}
          </text>
        </svg>
      </div>

      {/* 범례 */}
      <div className="flex flex-col gap-1.5 min-w-0 flex-1">
        {cats.map((cat, i) => (
          <div
            key={i}
            className="flex items-center gap-2 cursor-pointer"
            onMouseEnter={() => setHovered(cat.name)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: cat.color }} />
            <span className="truncate text-[13px] text-[#2e2719]">{cat.name}</span>
            <span className="ml-auto shrink-0 font-mono text-[12px] text-[#8c7e66]">{cat.ratio}%</span>
            <div className="w-16 h-[4px] rounded-full bg-[#e8e3d8] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${cat.ratio}%`, backgroundColor: cat.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 산점도(가격 vs 판매량) 탭 ─────────────────────────────────
const QUADRANT_LABELS = [
  { label: "⭐ 효자 메뉴",    desc: "고단가·고판매량",  x: "high", y: "high" },
  { label: "💎 프리미엄",      desc: "고단가·저판매량",  x: "high", y: "low"  },
  { label: "🔥 볼륨 메뉴",    desc: "저단가·고판매량",  x: "low",  y: "high" },
  { label: "🔻 재검토 필요",  desc: "저단가·저판매량",  x: "low",  y: "low"  },
];

function ScatterTab({ items }: { items: MenuAnalysisItem[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(400);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      setW(Math.floor(entries[0].contentRect.width));
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const prices = items.map((i) => i.avg_unit_price);
  const qtys   = items.map((i) => i.total_quantity);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minQ = Math.min(...qtys),   maxQ = Math.max(...qtys);
  const medP = (minP + maxP) / 2;
  const medQ = (minQ + maxQ) / 2;

  const H = 260, PAD = 44;
  const BPAD = PAD - 12; // 배경 박스는 PAD보다 12px 더 크게
  const IM   = 20;       // 점은 PAD 안쪽으로 20px 여유
  const toSvgX = (p: number) => PAD + IM + ((p - minP) / (maxP - minP || 1)) * (W - (PAD + IM) * 2);
  const toSvgY = (q: number) => H - PAD - IM - ((q - minQ) / (maxQ - minQ || 1)) * (H - (PAD + IM) * 2);
  const medSvgX = toSvgX(medP);
  const medSvgY = toSvgY(medQ);

  return (
    <div className="flex flex-col gap-3">
      {/* 산점도 SVG — 컨테이너 너비 측정 후 좌표 직접 계산 (viewBox 없음 → 글자 CSS px 그대로) */}
      <div ref={containerRef} className="relative rounded-[5px] bg-[#fdfcf8]">
        <svg width={W} height={H} style={{ display: "block" }}>
          {/* 사분면 배경 — BPAD 기준으로 점선보다 더 크게 */}
          <rect x={medSvgX} y={BPAD}      width={W - BPAD - medSvgX} height={medSvgY - BPAD}       fill="#e8edd8" opacity={0.4} />
          <rect x={BPAD}    y={BPAD}      width={medSvgX - BPAD}     height={medSvgY - BPAD}       fill="#f0e8d8" opacity={0.3} />
          <rect x={medSvgX} y={medSvgY}  width={W - BPAD - medSvgX} height={H - BPAD - medSvgY}   fill="#e0e8d0" opacity={0.3} />
          <rect x={BPAD}    y={medSvgY}  width={medSvgX - BPAD}     height={H - BPAD - medSvgY}   fill="#f4e8e0" opacity={0.3} />

          {/* 중앙선 — PAD+IM 범위 안에서만 */}
          <line x1={medSvgX} y1={PAD + IM} x2={medSvgX} y2={H - PAD - IM} stroke="#c8c0b0" strokeWidth={1} strokeDasharray="4,4" />
          <line x1={PAD + IM} y1={medSvgY} x2={W - PAD - IM} y2={medSvgY} stroke="#c8c0b0" strokeWidth={1} strokeDasharray="4,4" />

          {/* 사분면 라벨 */}
          <text x={medSvgX + 8} y={PAD + 16} fontSize={13} fill="#6a7843" fontWeight="600">⭐ 효자</text>
          <text x={PAD + 6}     y={PAD + 16} fontSize={13} fill="#8a6a2c">💎 프리미엄</text>
          <text x={medSvgX + 8} y={H - PAD - 8} fontSize={13} fill="#4a7c59">🔥 볼륨</text>
          <text x={PAD + 6}     y={H - PAD - 8} fontSize={13} fill="#8a3a28">🔻 재검토</text>

          {/* 축 레이블 */}
          <text x={W / 2} y={H - 6}  textAnchor="middle" fontSize={13} fill="#8c7e66" fontFamily="monospace">단가 (원) →</text>
          <text x={14}    y={H / 2}  textAnchor="middle" fontSize={13} fill="#8c7e66" fontFamily="monospace" transform={`rotate(-90, 14, ${H / 2})`}>판매량 →</text>

          {/* X축 min/max */}
          <text x={PAD}     y={H - 16} textAnchor="middle" fontSize={11} fill="#aaa" fontFamily="monospace">{(minP / 1000).toFixed(1)}k</text>
          <text x={W - PAD} y={H - 16} textAnchor="middle" fontSize={11} fill="#aaa" fontFamily="monospace">{(maxP / 1000).toFixed(1)}k</text>

          {/* 점 */}
          {items.map((item, idx) => {
            const x = toSvgX(item.avg_unit_price);
            const y = toSvgY(item.total_quantity);
            const color = getCategoryColor(item.category);
            const isHov = hovered === idx;
            return (
              <g key={idx} onMouseEnter={() => setHovered(idx)} onMouseLeave={() => setHovered(null)} className="cursor-pointer">
                <circle cx={x} cy={y} r={isHov ? 9 : 6} fill={color} opacity={hovered !== null && !isHov ? 0.35 : 0.9} stroke="white" strokeWidth={1.5} className="transition-all duration-150" />
                {isHov && (
                  <>
                    <rect x={x + 10} y={y - 40} width={130} height={46} rx={4} fill="white" stroke="#d0cbbf" strokeWidth={1} />
                    <text x={x + 18} y={y - 22} fontSize={13} fill="#2e2719" fontWeight="600">{item.item_name}</text>
                    <text x={x + 18} y={y - 6}  fontSize={11} fill="#8c7e66" fontFamily="monospace">{item.avg_unit_price.toLocaleString()}원 · {item.total_quantity}개</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {[...new Set(items.map((i) => i.category))].map((cat) => (
          <div key={cat} className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getCategoryColor(cat) }} />
            <span className="text-[13px] text-[#8c7e66]">{cat}</span>
          </div>
        ))}
      </div>

      {/* 인사이트 */}
      <div className="grid grid-cols-2 gap-1.5">
        {items
          .filter((i) => i.avg_unit_price >= medP && i.total_quantity >= medQ)
          .slice(0, 2)
          .map((i, idx) => (
            <div key={idx} className="rounded-[4px] bg-[#e8edd8] px-2 py-1.5">
              <div className="text-[10px] font-semibold text-[#4a5c28]">⭐ {i.item_name}</div>
              <div className="text-[9px] text-[#6a7843]">효자 메뉴 · 집중 육성 추천</div>
            </div>
          ))}
        {items
          .filter((i) => i.avg_unit_price < medP && i.total_quantity < medQ)
          .slice(0, 2)
          .map((i, idx) => (
            <div key={idx} className="rounded-[4px] bg-[#f4e8e0] px-2 py-1.5">
              <div className="text-[9px] font-semibold text-[#8a3a28]">🔻 {i.item_name}</div>
              <div className="text-[9px] text-[#c05a3a]">가격 인상 또는 메뉴 재검토</div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── 메인 카드 ─────────────────────────────────────────────────
type Tab = "bar" | "pie" | "scatter";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "bar",     label: "매출 순위",   icon: <BarChart2 className="h-3 w-3" /> },
  { id: "pie",     label: "카테고리",    icon: <PieChart  className="h-3 w-3" /> },
  { id: "scatter", label: "가격·판매량", icon: <Crosshair className="h-3 w-3" /> },
];

export const MenuAnalysisCard = ({ payload }: { payload: MenuAnalysisPayload }) => {
  const [tab, setTab] = useState<Tab>("bar");
  const items = payload.items ?? [];
  if (!items.length) return null;

  // 카테고리 색상 초기화 (순서 고정)
  [...new Set(items.map((i) => i.category))].forEach((c) => getCategoryColor(c));

  return (
    <div className="rounded-[5px] border border-[#d0cbbf] bg-[#faf8f3] p-4 shadow-sm">
      {/* 헤더 */}
      <div className="mb-3 flex items-center gap-2">
        <BarChart2 className="h-4 w-4 text-[#6a7843]" />
        <span className="text-sm font-semibold text-[#2e2719]">{payload.period_label} 메뉴별 수익성</span>
        <span className="ml-auto font-mono text-[10px] text-[#8c7e66]">{payload.start_date} ~ {payload.end_date}</span>
      </div>

      {/* 요약 pills */}
      <div className="mb-3 flex gap-2">
        <div className="rounded-[4px] bg-[#e8edd8] px-2.5 py-1 text-[11px] font-mono text-[#4a5c28]">
          총매출 {payload.total_amount.toLocaleString()}원
        </div>
        <div className="rounded-[4px] bg-[#e8edd8] px-2.5 py-1 text-[11px] font-mono text-[#4a5c28]">
          총판매량 {payload.total_quantity.toLocaleString()}개
        </div>
      </div>

      {/* 탭 */}
      <div className="mb-3 flex gap-1 rounded-[5px] bg-[#ede9df] p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "flex flex-1 items-center justify-center gap-1 rounded-[4px] px-2 py-1 text-[11px] font-medium transition-all",
              tab === t.id
                ? "bg-white text-[#2e2719] shadow-sm"
                : "text-[#8c7e66] hover:text-[#2e2719]",
            ].join(" ")}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      {tab === "bar"     && <BarTab     items={items} />}
      {tab === "pie"     && <PieTab     items={items} />}
      {tab === "scatter" && <ScatterTab items={items} />}

      {/* 인사이트 푸터 (바 탭에서만) */}
      {tab === "bar" && items.length >= 2 && (
        <div className="mt-4 rounded-[4px] border border-[#d0cbbf] bg-white/60 px-3 py-2 text-[11px] leading-relaxed text-[#5a5040]">
          <span className="font-semibold text-[#4a5c28]">{items[0].item_name}</span>이(가) 전체 매출의{" "}
          <span className="font-semibold">{items[0].revenue_ratio}%</span>를 차지해요.
          {items.length >= 3 && (
            <> 상위 3개 메뉴가{" "}
              <span className="font-semibold">
                {(items[0].revenue_ratio + items[1].revenue_ratio + items[2].revenue_ratio).toFixed(1)}%
              </span>를 담당해요.</>
          )}
        </div>
      )}
    </div>
  );
};
