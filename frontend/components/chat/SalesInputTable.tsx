"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export type SalesActionData = {
  date: string;
  items: Array<{
    item_name: string;
    category: string;
    quantity: number;
    unit_price: number;
  }>;
};

type Props = {
  data: SalesActionData;
  apiBase: string;
  onClose: () => void;
  onSaved?: (message: string) => void;
};

export const SalesInputTable = ({ data, apiBase, onClose, onSaved }: Props) => {
  const [date, setDate] = useState(data.date);
  const [items, setItems] = useState(
    data.items.length > 0
      ? data.items.map((it) => ({ ...it }))
      : [{ item_name: "", category: "기타", quantity: 1, unit_price: 0 }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (
    i: number,
    field: keyof (typeof items)[0],
    value: string | number,
  ) => {
    setItems((prev) =>
      prev.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)),
    );
  };

  const addRow = () =>
    setItems((prev) => [
      ...prev,
      { item_name: "", category: "기타", quantity: 1, unit_price: 0 },
    ]);

  const removeRow = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  const total = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);

  const handleSave = async () => {
    if (!apiBase) {
      setError("API 주소가 설정되지 않았습니다. 프론트엔드를 재시작해 주세요.");
      return;
    }
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("로그인 정보를 확인할 수 없습니다.");
      return;
    }

    const validItems = items.filter((it) => it.item_name.trim());
    if (validItems.length === 0) {
      setError("상품명을 하나 이상 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${apiBase}/api/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: userId,
          items: validItems.map((it) => ({
            ...it,
            amount: it.quantity * it.unit_price,
            recorded_date: date,
            source: "chat",
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || `HTTP ${res.status}`);
      }
      const saved = await res.json();
      const count = saved?.data?.saved ?? items.length;
      onSaved?.(`매출 ${count}건이 저장됐어요. 캔버스 Revenue 허브에서 확인할 수 있어요.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#2e2719]/40 backdrop-blur-sm">
      <div className="relative flex max-h-[80vh] w-[700px] flex-col overflow-hidden rounded-2xl border border-[#ddd0b4] bg-[#fffaf2] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#ddd0b4] px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-[#2e2719]">매출 입력</h3>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-0.5 bg-transparent text-xs text-[#8c7e66] focus:outline-none"
            />
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[#8c7e66] hover:bg-[#ddd0b4] hover:text-[#2e2719]"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#ddd0b4] text-left text-xs text-[#8c7e66]">
                <th className="pb-2 pr-3 font-medium">메뉴/상품</th>
                <th className="pb-2 pr-3 font-medium">카테고리</th>
                <th className="pb-2 pr-3 text-right font-medium">수량</th>
                <th className="pb-2 pr-3 text-right font-medium">단가(원)</th>
                <th className="pb-2 text-right font-medium">금액</th>
                <th className="w-6 pb-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-[#ddd0b4]/50">
                  <td className="py-1.5 pr-3">
                    <input
                      value={it.item_name}
                      onChange={(e) => update(i, "item_name", e.target.value)}
                      placeholder="상품명"
                      className="w-full bg-transparent text-[#2e2719] placeholder:text-[#bfae8a] focus:outline-none"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={it.category}
                      onChange={(e) => update(i, "category", e.target.value)}
                      className="w-24 bg-transparent text-[#5a5040] focus:outline-none"
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <input
                      type="number"
                      value={it.quantity}
                      min={1}
                      onChange={(e) =>
                        update(i, "quantity", Math.max(1, parseInt(e.target.value) || 1))
                      }
                      className="w-16 bg-transparent text-right text-[#2e2719] focus:outline-none"
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <input
                      type="number"
                      value={it.unit_price}
                      min={0}
                      onChange={(e) =>
                        update(i, "unit_price", Math.max(0, parseInt(e.target.value) || 0))
                      }
                      className="w-28 bg-transparent text-right text-[#2e2719] focus:outline-none"
                    />
                  </td>
                  <td className="py-1.5 text-right text-[#2e2719]">
                    {(it.quantity * it.unit_price).toLocaleString()}원
                  </td>
                  <td className="py-1.5 pl-2">
                    <button
                      onClick={() => removeRow(i)}
                      className="text-[#bfae8a] hover:text-[#c47865]"
                      aria-label="행 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={4}
                  className="pt-3 pr-3 text-right text-xs font-semibold text-[#2e2719]"
                >
                  합계
                </td>
                <td className="pt-3 text-right text-sm font-bold text-[#2e2719]">
                  {total.toLocaleString()}원
                </td>
                <td />
              </tr>
            </tfoot>
          </table>

          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1 text-xs text-[#8c7e66] hover:text-[#2e2719]"
          >
            <Plus className="h-3.5 w-3.5" />
            항목 추가
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#ddd0b4] px-5 py-3">
          <span className="text-xs text-[#c47865]">{error}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="border-[#ddd0b4] text-[#5a5040] hover:bg-[#ebe0ca]"
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || items.length === 0}
              className="bg-[#2e2719] text-[#fbf6eb] hover:bg-[#3d3423] disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
