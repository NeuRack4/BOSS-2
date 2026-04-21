"use client";

import { useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const CATEGORIES = [
  "재료비",
  "인건비",
  "임대료",
  "공과금",
  "마케팅",
  "기타",
] as const;

export type CostActionData = {
  date: string;
  items: Array<{
    item_name: string;
    category: string;
    amount: number;
    memo: string;
  }>;
};

export type CostConfirmItems = Array<{
  item_name: string;
  category: string;
  amount: number;
  memo: string;
  recorded_date: string;
  source: "chat";
}>;

type Props = {
  data: CostActionData;
  onClose: () => void;
  onConfirm: (items: CostConfirmItems, date: string) => void;
};

export const CostInputTable = ({ data, onClose, onConfirm }: Props) => {
  const [date, setDate] = useState(data.date);
  const [items, setItems] = useState(
    data.items.length > 0
      ? data.items.map((it) => ({ ...it }))
      : [{ item_name: "", category: "기타", amount: 0, memo: "" }],
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
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
      { item_name: "", category: "기타", amount: 0, memo: "" },
    ]);

  const removeRow = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  const total = items.reduce((s, it) => s + it.amount, 0);

  const handleSave = () => {
    if (savingRef.current) return;
    const validItems = items.filter((it) => it.item_name.trim());
    if (validItems.length === 0) {
      setError("Enter at least one item name.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");

    const payload: CostConfirmItems = validItems.map((it) => ({
      item_name: it.item_name,
      category: it.category,
      amount: it.amount,
      memo: it.memo,
      recorded_date: date,
      source: "chat",
    }));
    onConfirm(payload, date);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2e2719]/40 backdrop-blur-sm">
      <div className="relative flex max-h-[86vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-[5px] border border-[#030303]/10 bg-[#f4f1ed] shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#030303]/[0.08] px-4 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-[#030303]">Cost entry</h3>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-[4px] border border-[#030303]/15 bg-white px-2 py-0.5 font-mono text-[11px] text-[#030303] outline-none focus:border-[#030303]/40"
            />
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[#030303]/60 hover:bg-[#030303]/[0.05] hover:text-[#030303]"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Table */}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <div className="rounded-[5px] border border-[#030303]/10 bg-white">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#030303]/10 text-left font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Memo</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr
                    key={i}
                    className="border-b border-[#030303]/5 last:border-b-0"
                  >
                    <td className="px-3 py-1.5">
                      <input
                        value={it.item_name}
                        onChange={(e) => update(i, "item_name", e.target.value)}
                        placeholder="e.g., 식재료"
                        className="w-full bg-transparent text-[#030303] placeholder:text-[#030303]/30 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={it.category}
                        onChange={(e) => update(i, "category", e.target.value)}
                        className="rounded-[4px] border border-[#030303]/15 bg-white px-1.5 py-0.5 text-[12px] text-[#030303] focus:border-[#030303]/40 focus:outline-none"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        value={it.amount}
                        min={0}
                        onChange={(e) =>
                          update(
                            i,
                            "amount",
                            Math.max(0, parseInt(e.target.value) || 0),
                          )
                        }
                        className="w-28 bg-transparent text-right font-mono tabular-nums text-[#030303] focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={it.memo}
                        onChange={(e) => update(i, "memo", e.target.value)}
                        placeholder="Memo"
                        className="w-full bg-transparent text-[#030303]/80 placeholder:text-[#030303]/30 focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => removeRow(i)}
                        className="rounded p-1 text-[#030303]/30 hover:bg-rose-50 hover:text-rose-500"
                        aria-label="remove row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#030303]/10 bg-[#f4f1ed]">
                  <td
                    colSpan={2}
                    className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-[#030303]/60"
                  >
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[13px] font-semibold text-[#030303]">
                    {total.toLocaleString()}
                    <span className="ml-1 text-[10px] uppercase tracking-wider text-[#030303]/50">
                      won
                    </span>
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] text-[#030303]/60 hover:bg-[#030303]/[0.05] hover:text-[#030303]"
          >
            <Plus className="h-3 w-3" />
            Add row
          </button>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-[#030303]/[0.08] px-4 py-3">
          <span className="text-[11px] text-rose-600">{error}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="rounded-[4px] border-[#030303]/15 bg-white text-[#030303]/70 hover:bg-[#030303]/[0.05] hover:text-[#030303]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || items.length === 0}
              className="rounded-[4px] bg-[#030303] text-white hover:bg-[#030303]/85 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
