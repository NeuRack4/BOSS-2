"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Menu {
  id: string;
  name: string;
  category: string;
  price: number;
  cost_price: number;
  is_active: boolean;
  memo: string;
  margin_rate: number | null;
  margin_amount: number | null;
}

interface MenuListPanelProps {
  accountId: string;
}

const CATEGORY_COLORS: Record<string, { badge: string }> = {
  음료:   { badge: "bg-blue-100 text-blue-700" },
  디저트: { badge: "bg-pink-100 text-pink-700" },
  음식:   { badge: "bg-orange-100 text-orange-700" },
  기타:   { badge: "bg-gray-100 text-gray-600" },
};

function marginColor(rate: number) {
  if (rate >= 60) return { text: "text-green-600", bar: "bg-green-400" };
  if (rate >= 40) return { text: "text-yellow-600", bar: "bg-yellow-400" };
  return              { text: "text-red-500",       bar: "bg-red-400" };
}

// ── 카테고리 요약 헤더 ──────────────────────────────────────────────────────

function CategoryHeader({ cat, items }: { cat: string; items: Menu[] }) {
  const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS["기타"];
  const withMargin = items.filter((m) => m.margin_rate !== null);
  const avgMargin =
    withMargin.length > 0
      ? Math.round(withMargin.reduce((s, m) => s + (m.margin_rate ?? 0), 0) / withMargin.length)
      : null;

  return (
    <div className="mb-2 flex items-center justify-between">
      <span className={`inline-block rounded-full px-2 py-0.5 font-mono text-[11px] uppercase ${colors.badge}`}>
        {cat}
      </span>
      <span className="font-mono text-[11px] text-[#999]">
        {items.length}개
        {avgMargin !== null && (
          <span className={`ml-2 ${marginColor(avgMargin).text}`}>
            · 평균 마진 {avgMargin}%
          </span>
        )}
      </span>
    </div>
  );
}

// ── 마진율 게이지바 ────────────────────────────────────────────────────────

function MarginBar({ rate }: { rate: number }) {
  const { text, bar } = marginColor(rate);
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-[#f0ede8]">
        <div className={`h-1.5 rounded-full transition-all ${bar}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className={`font-mono text-[11px] ${text}`}>{rate}%</span>
    </div>
  );
}

// ── 원가 미입력 — 인라인 입력 + 채팅 유도 ────────────────────────────────

function NoCostSection({
  menu,
  accountId,
  onSaved,
}: {
  menu: Menu;
  accountId: string;
  onSaved: (id: string, costPrice: number) => void;
}) {
  const [open, setOpen]       = useState(false);
  const [value, setValue]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const inputRef              = useRef<HTMLInputElement>(null);

  const hint = `"${menu.name} 원가 [금액]원으로 수정해줘"`;

  const handleSave = async () => {
    const cost = parseInt(value.replace(/,/g, ""), 10);
    if (isNaN(cost) || cost <= 0) {
      setError("올바른 금액을 입력해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/menus/${menu.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, cost_price: cost }),
      });
      if (!res.ok) throw new Error();
      onSaved(menu.id, cost);
      setOpen(false);
    } catch {
      setError("저장에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <div className="mt-1.5 flex flex-col gap-1">
        {/* B) 인라인 입력 버튼 */}
        <button
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          className="flex w-fit items-center gap-1 rounded-[4px] border border-[#d0cbbf] bg-[#faf8f3] px-2 py-0.5 font-mono text-[11px] text-[#6a5e50] transition-colors hover:bg-[#f0ece5]"
        >
          ✏️ 원가 직접 입력
        </button>
        {/* A) 채팅 유도 */}
        <p className="font-mono text-[10px] text-[#bbb]">
          또는 챗봇에서&nbsp;
          <span className="text-[#a89880]">{hint}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="number"
          min={1}
          placeholder="원가 입력 (원)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setOpen(false); }}
          className="w-32 rounded-[4px] border border-[#d0cbbf] bg-white px-2 py-1 font-mono text-[12px] text-[#2c2c2c] outline-none focus:border-[#7f8f54]"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-[4px] bg-[#7f8f54] px-2.5 py-1 font-mono text-[11px] text-white transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button
          onClick={() => { setOpen(false); setValue(""); setError(""); }}
          className="font-mono text-[11px] text-[#aaa] hover:text-[#555]"
        >
          취소
        </button>
      </div>
      {error && <p className="font-mono text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

// ── 메뉴 행 ───────────────────────────────────────────────────────────────

function MenuRow({
  m,
  accountId,
  onCostSaved,
}: {
  m: Menu;
  accountId: string;
  onCostSaved: (id: string, costPrice: number) => void;
}) {
  const noCost = m.cost_price === 0;

  return (
    <div className="rounded-[5px] border border-[#e8e3dc] bg-white px-3 py-2.5 transition-colors hover:bg-[#f9f7f4]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-[#2c2c2c]">{m.name}</span>
          {noCost && (
            <span className="rounded-[3px] bg-[#fff3cd] px-1 py-0.5 font-mono text-[10px] text-[#856404]">
              ⚠ 원가 미입력
            </span>
          )}
        </div>
        <span className="text-[13px] text-[#555]">{m.price.toLocaleString()}원</span>
      </div>

      {!noCost && m.margin_rate !== null ? (
        <div className="mt-1.5">
          <MarginBar rate={m.margin_rate} />
        </div>
      ) : (
        <NoCostSection menu={m} accountId={accountId} onSaved={onCostSaved} />
      )}
    </div>
  );
}

// ── 메인 패널 ─────────────────────────────────────────────────────────────

export default function MenuListPanel({ accountId }: MenuListPanelProps) {
  const [byCategory, setByCategory] = useState<Record<string, Menu[]>>({});
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (!accountId) return;
    fetch(`${API}/api/menus?account_id=${accountId}&active_only=true`)
      .then((r) => r.json())
      .then((res) => {
        setByCategory(res.data?.by_category ?? {});
        setTotal(res.data?.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);

  // 원가 저장 후 로컬 상태 즉시 반영 (API 재호출 없이)
  const handleCostSaved = (id: string, costPrice: number) => {
    setByCategory((prev) => {
      const next = { ...prev };
      for (const cat of Object.keys(next)) {
        next[cat] = next[cat].map((m) => {
          if (m.id !== id) return m;
          const price = m.price;
          const rate  = price > 0 ? Math.round((price - costPrice) / price * 100 * 10) / 10 : null;
          return { ...m, cost_price: costPrice, margin_rate: rate, margin_amount: price - costPrice };
        });
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-[13px] text-[#aaa]">
        불러오는 중…
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <p className="text-[13px] text-[#999]">Nothing here yet</p>
        <div className="rounded-[5px] border border-[#d0cbbf] bg-[#faf8f3] px-4 py-3 text-left text-[12px] text-[#5a5040]">
          <p className="mb-1.5 font-semibold text-[#4a5c28]">이렇게 입력해보세요 💬</p>
          <p className="text-[#6a7843]">"아메리카노 4500원 등록해줘"</p>
          <p className="mt-1 text-[#6a7843]">"라떼 5000원, 원가 800원으로 추가해줘"</p>
        </div>
      </div>
    );
  }

  const allMenus    = Object.values(byCategory).flat();
  const noCostCount = allMenus.filter((m) => m.cost_price === 0).length;

  return (
    <div className="flex flex-col gap-5">
      {/* 전체 요약 */}
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase text-[#999]">총 {total}개 메뉴</p>
        {noCostCount > 0 && (
          <span className="rounded-[3px] bg-[#fff3cd] px-2 py-0.5 font-mono text-[10px] text-[#856404]">
            ⚠ 원가 미입력 {noCostCount}개
          </span>
        )}
      </div>

      {/* 카테고리별 목록 */}
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat}>
          <CategoryHeader cat={cat} items={items} />
          <div className="flex flex-col gap-1.5">
            {items.map((m) => (
              <MenuRow key={m.id} m={m} accountId={accountId} onCostSaved={handleCostSaved} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
