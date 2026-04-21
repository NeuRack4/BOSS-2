"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2, Check, X, TrendingUp, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

// ── 타입 ─────────────────────────────────────────────────────────────────────

type SaleRecord = {
  id: string;
  item_name: string;
  category: string;
  quantity: number;
  unit_price: number;
  amount: number;
  recorded_date: string;
  memo?: string;
};

type CostRecord = {
  id: string;
  item_name: string;
  category: string;
  amount: number;
  recorded_date: string;
  memo?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  accountId: string;
  artifactId: string;
  artifactType: "revenue_entry" | "cost_report" | string;
  recordedDate: string;   // YYYY-MM-DD (artifact metadata.recorded_date)
  artifactTitle: string;
};

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toLocaleString("ko-KR") + "원";

const SALE_CATS  = ["음료", "음식", "디저트", "상품", "서비스", "기타"];
const COST_CATS  = ["재료비", "인건비", "임대료", "공과금", "마케팅", "기타"];

const CAT_COLOR: Record<string, string> = {
  음료:   "bg-sky-400/15 text-sky-300",
  음식:   "bg-orange-400/15 text-orange-300",
  디저트: "bg-pink-400/15 text-pink-300",
  상품:   "bg-violet-400/15 text-violet-300",
  서비스: "bg-teal-400/15 text-teal-300",
  재료비: "bg-amber-400/15 text-amber-300",
  인건비: "bg-rose-400/15 text-rose-300",
  임대료: "bg-indigo-400/15 text-indigo-300",
  공과금: "bg-cyan-400/15 text-cyan-300",
  마케팅: "bg-purple-400/15 text-purple-300",
  기타:   "bg-white/10 text-white/50",
};

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export const SalesDetailModal = ({
  open,
  onClose,
  accountId,
  artifactType,
  recordedDate,
  artifactTitle,
}: Props) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
  const isSales = artifactType === "revenue_entry";

  const [saleRecords, setSaleRecords] = useState<SaleRecord[]>([]);
  const [costRecords, setCostRecords] = useState<CostRecord[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // 편집 상태
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editBuf, setEditBuf]       = useState<Partial<SaleRecord & CostRecord>>({});
  const [saving, setSaving]         = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── 데이터 로드 ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!open || !recordedDate) return;
    setLoading(true);
    setError(null);
    try {
      const url = isSales
        ? `${apiBase}/api/sales?account_id=${accountId}&start_date=${recordedDate}&end_date=${recordedDate}&limit=500`
        : `${apiBase}/api/costs?account_id=${accountId}&start_date=${recordedDate}&end_date=${recordedDate}&limit=500`;
      const res  = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const records = json?.data?.records ?? [];
      if (isSales) setSaleRecords(records);
      else         setCostRecords(records);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [open, recordedDate, isSales, apiBase, accountId]);

  useEffect(() => { load(); }, [load]);

  // 모달 닫을 때 상태 초기화
  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setEditBuf({});
      setError(null);
    }
  }, [open]);

  // ── 편집 ──────────────────────────────────────────────────────────────────

  const startEdit = (rec: SaleRecord | CostRecord) => {
    setEditingId(rec.id);
    setEditBuf({ ...rec });
  };

  const cancelEdit = () => { setEditingId(null); setEditBuf({}); };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const endpoint = isSales
        ? `${apiBase}/api/sales/${id}`
        : `${apiBase}/api/costs/${id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, ...editBuf }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      setEditingId(null);
      setEditBuf({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "수정 실패");
    } finally {
      setSaving(false);
    }
  };

  // ── 삭제 ──────────────────────────────────────────────────────────────────

  const deleteRecord = async (id: string) => {
    if (!confirm("이 항목을 삭제할까요?")) return;
    setDeletingId(id);
    try {
      const endpoint = isSales
        ? `${apiBase}/api/sales/${id}?account_id=${accountId}`
        : `${apiBase}/api/costs/${id}?account_id=${accountId}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDeletingId(null);
    }
  };

  // ── 집계 ──────────────────────────────────────────────────────────────────

  const records  = isSales ? saleRecords : costRecords;
  const total    = records.reduce((s, r) => s + r.amount, 0);
  const catMap: Record<string, number> = {};
  for (const r of records) {
    catMap[r.category] = (catMap[r.category] ?? 0) + r.amount;
  }
  const catList = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={artifactTitle}
      widthClass="w-[700px] max-w-[95vw]"
    >
      {/* 헤더 요약 */}
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-[#ddd0b4] bg-[#f8f2e6] px-4 py-3">
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          isSales ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
        )}>
          {isSales ? <TrendingUp className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-[#8c7e66]">{recordedDate} · {isSales ? "매출" : "비용"}</div>
          <div className="text-lg font-bold text-[#2e2719]">{fmt(total)}</div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end">
          {catList.map(([cat, amt]) => (
            <span
              key={cat}
              className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", CAT_COLOR[cat] ?? CAT_COLOR["기타"])}
            >
              {cat} {fmt(amt)}
            </span>
          ))}
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      )}

      {/* 로딩 */}
      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-[#8c7e66]">
          불러오는 중...
        </div>
      ) : records.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-[#8c7e66]">
          기록된 항목이 없어요.
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#ddd0b4] text-xs text-[#8c7e66]">
                <th className="pb-2 text-left font-medium">항목명</th>
                <th className="pb-2 text-left font-medium">분류</th>
                {isSales && <th className="pb-2 text-right font-medium">수량</th>}
                {isSales && <th className="pb-2 text-right font-medium">단가</th>}
                <th className="pb-2 text-right font-medium">금액</th>
                <th className="pb-2 text-left font-medium pl-2">메모</th>
                <th className="pb-2 w-14" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ece3d4]">
              {records.map((rec) => {
                const isEditing = editingId === rec.id;
                const isDeleting = deletingId === rec.id;
                const cats = isSales ? SALE_CATS : COST_CATS;

                return (
                  <tr
                    key={rec.id}
                    className={cn(
                      "transition-colors",
                      isEditing ? "bg-[#fdf8f0]" : "hover:bg-[#faf5ec]",
                    )}
                  >
                    {/* 항목명 */}
                    <td className="py-2 pr-2">
                      {isEditing ? (
                        <input
                          className="w-full rounded border border-[#ddd0b4] bg-white px-2 py-1 text-xs text-[#2e2719] focus:outline-none focus:ring-1 focus:ring-[#c47865]"
                          value={editBuf.item_name ?? ""}
                          onChange={(e) => setEditBuf((b) => ({ ...b, item_name: e.target.value }))}
                        />
                      ) : (
                        <span className="font-medium text-[#2e2719]">{rec.item_name}</span>
                      )}
                    </td>

                    {/* 분류 */}
                    <td className="py-2 pr-2">
                      {isEditing ? (
                        <select
                          className="rounded border border-[#ddd0b4] bg-white px-1.5 py-1 text-xs text-[#2e2719] focus:outline-none"
                          value={editBuf.category ?? rec.category}
                          onChange={(e) => setEditBuf((b) => ({ ...b, category: e.target.value }))}
                        >
                          {cats.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      ) : (
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", CAT_COLOR[rec.category] ?? CAT_COLOR["기타"])}>
                          {rec.category}
                        </span>
                      )}
                    </td>

                    {/* 수량 (매출만) */}
                    {isSales && (
                      <td className="py-2 pr-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            className="w-16 rounded border border-[#ddd0b4] bg-white px-2 py-1 text-xs text-right text-[#2e2719] focus:outline-none"
                            value={editBuf.quantity ?? (rec as SaleRecord).quantity}
                            onChange={(e) => setEditBuf((b) => ({ ...b, quantity: Number(e.target.value) }))}
                          />
                        ) : (
                          <span className="text-[#5a4e3a]">{(rec as SaleRecord).quantity}</span>
                        )}
                      </td>
                    )}

                    {/* 단가 (매출만) */}
                    {isSales && (
                      <td className="py-2 pr-2 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            className="w-24 rounded border border-[#ddd0b4] bg-white px-2 py-1 text-xs text-right text-[#2e2719] focus:outline-none"
                            value={editBuf.unit_price ?? (rec as SaleRecord).unit_price}
                            onChange={(e) => setEditBuf((b) => ({ ...b, unit_price: Number(e.target.value) }))}
                          />
                        ) : (
                          <span className="tabular-nums text-[#5a4e3a]">
                            {(rec as SaleRecord).unit_price > 0 ? fmt((rec as SaleRecord).unit_price) : "-"}
                          </span>
                        )}
                      </td>
                    )}

                    {/* 금액 */}
                    <td className="py-2 pr-2 text-right">
                      {isEditing ? (
                        <input
                          type="number"
                          className="w-24 rounded border border-[#ddd0b4] bg-white px-2 py-1 text-xs text-right text-[#2e2719] focus:outline-none"
                          value={editBuf.amount ?? rec.amount}
                          onChange={(e) => setEditBuf((b) => ({ ...b, amount: Number(e.target.value) }))}
                        />
                      ) : (
                        <span className="font-semibold tabular-nums text-[#2e2719]">{fmt(rec.amount)}</span>
                      )}
                    </td>

                    {/* 메모 */}
                    <td className="py-2 pl-2 pr-2">
                      {isEditing ? (
                        <input
                          className="w-full rounded border border-[#ddd0b4] bg-white px-2 py-1 text-xs text-[#2e2719] focus:outline-none"
                          value={editBuf.memo ?? rec.memo ?? ""}
                          onChange={(e) => setEditBuf((b) => ({ ...b, memo: e.target.value }))}
                          placeholder="메모"
                        />
                      ) : (
                        <span className="text-xs text-[#8c7e66]">{rec.memo || ""}</span>
                      )}
                    </td>

                    {/* 액션 */}
                    <td className="py-2 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => saveEdit(rec.id)}
                            disabled={saving}
                            className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                            title="저장"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded p-1 text-[#8c7e66] hover:bg-[#ebe0ca]"
                            title="취소"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 [tr:hover_&]:opacity-100">
                          <button
                            onClick={() => startEdit(rec)}
                            className="rounded p-1 text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                            title="수정"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteRecord(rec.id)}
                            disabled={isDeleting}
                            className="rounded p-1 text-rose-400 hover:bg-rose-50 disabled:opacity-40"
                            title="삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* 합계 행 */}
            <tfoot>
              <tr className="border-t-2 border-[#ddd0b4]">
                <td colSpan={isSales ? 4 : 2} className="pt-2 text-xs font-semibold text-[#8c7e66]">
                  합계 {records.length}건
                </td>
                <td className="pt-2 text-right font-bold text-[#2e2719]">{fmt(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
};
