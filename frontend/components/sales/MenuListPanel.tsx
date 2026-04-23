"use client";

import { useEffect, useState } from "react";

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

const CATEGORY_COLORS: Record<string, string> = {
  음료:   "bg-blue-100 text-blue-700",
  디저트: "bg-pink-100 text-pink-700",
  음식:   "bg-orange-100 text-orange-700",
  기타:   "bg-gray-100 text-gray-600",
};

function MarginBadge({ rate }: { rate: number | null }) {
  if (rate === null) return null;
  const color =
    rate >= 60 ? "text-green-600" : rate >= 40 ? "text-yellow-600" : "text-red-500";
  return (
    <span className={`text-[11px] font-mono ${color}`}>마진 {rate}%</span>
  );
}

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

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-[11px] uppercase text-[#999]">총 {total}개 메뉴</p>

      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat}>
          <span
            className={`mb-2 inline-block rounded-full px-2 py-0.5 font-mono text-[11px] uppercase ${
              CATEGORY_COLORS[cat] ?? CATEGORY_COLORS["기타"]
            }`}
          >
            {cat}
          </span>
          <div className="flex flex-col gap-1">
            {items.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-[5px] border border-[#e8e3dc] bg-white px-3 py-2 transition-colors hover:bg-[#f9f7f4]"
              >
                <span className="text-[13px] font-medium text-[#2c2c2c]">{m.name}</span>
                <div className="flex items-center gap-3">
                  <MarginBadge rate={m.margin_rate} />
                  <span className="text-[13px] text-[#555]">
                    {m.price.toLocaleString()}원
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
