"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type WorkRecord = {
  id: string;
  work_date: string;
  hours_worked: number;
  overtime_hours: number;
  night_hours: number;
  holiday_hours: number;
  memo: string | null;
};

type Props = {
  employeeId: string;
  accountId: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL;

const toMonth = (d: Date) => d.toISOString().slice(0, 7);
const fmt = (n: number) => (n > 0 ? String(n) : "");

export const WorkRecordPanel = ({ employeeId, accountId }: Props) => {
  const [month, setMonth] = useState(() => toMonth(new Date()));
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // New record form state
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newHours, setNewHours] = useState("");
  const [newOt, setNewOt] = useState("");
  const [newNight, setNewNight] = useState("");
  const [newHoliday, setNewHoliday] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/api/employees/${employeeId}/work-records?account_id=${accountId}&month=${month}`,
      );
      const json = await res.json();
      setRecords(json?.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [employeeId, accountId, month]);

  useEffect(() => { load(); }, [load]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(toMonth(d));
  };

  const handleAdd = async () => {
    if (!newDate || !newHours) return;
    setSaving(true);
    try {
      await fetch(`${apiBase}/api/employees/${employeeId}/work-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          work_date: newDate,
          hours_worked: parseFloat(newHours) || 0,
          overtime_hours: parseFloat(newOt) || 0,
          night_hours: parseFloat(newNight) || 0,
          holiday_hours: parseFloat(newHoliday) || 0,
          memo: newMemo || null,
        }),
      });
      setShowAdd(false);
      setNewHours(""); setNewOt(""); setNewNight(""); setNewHoliday(""); setNewMemo("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${apiBase}/api/work-records/${id}?account_id=${accountId}`, {
      method: "DELETE",
    });
    await load();
  };

  const totalHours = records.reduce((s, r) => s + r.hours_worked, 0);
  const totalOt = records.reduce((s, r) => s + r.overtime_hours, 0);

  const inputCls =
    "w-full rounded-[4px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-[#d4a588]";

  return (
    <div>
      {/* Month navigator */}
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => shiftMonth(-1)} className="rounded p-1 hover:bg-[color:var(--kb-surface-hover)]">
          <ChevronLeft className="h-3.5 w-3.5 text-[color:var(--kb-fg-muted)]" />
        </button>
        <span className="text-[11px] font-semibold text-[color:var(--kb-fg-strong)]">{month}</span>
        <button type="button" onClick={() => shiftMonth(1)} className="rounded p-1 hover:bg-[color:var(--kb-surface-hover)]">
          <ChevronRight className="h-3.5 w-3.5 text-[color:var(--kb-fg-muted)]" />
        </button>
      </div>

      {/* Summary */}
      {records.length > 0 && (
        <div className="mb-2 flex gap-3 text-[10px] text-[color:var(--kb-fg-muted)]">
          <span>기본: <b>{totalHours}h</b></span>
          {totalOt > 0 && <span>연장: <b>{totalOt}h</b></span>}
        </div>
      )}

      {/* Records list */}
      {loading ? (
        <div className="py-4 text-center text-[10px] text-[color:var(--kb-fg-muted)]">불러오는 중...</div>
      ) : records.length === 0 ? (
        <div className="py-3 text-center text-[10px] text-[color:var(--kb-fg-muted)]">이 달 기록 없음</div>
      ) : (
        <div className="mb-2 space-y-1">
          {records.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-[4px] border border-[color:var(--kb-border)] px-2 py-1.5 text-[10px]">
              <span className="w-16 shrink-0 text-[color:var(--kb-fg-muted)]">{r.work_date.slice(5)}</span>
              <span className="flex-1 text-[color:var(--kb-fg-strong)]">
                {r.hours_worked}h
                {r.overtime_hours > 0 && ` +연장 ${r.overtime_hours}h`}
                {r.night_hours > 0 && ` +야간 ${r.night_hours}h`}
                {r.holiday_hours > 0 && ` +휴일 ${r.holiday_hours}h`}
                {r.memo && <span className="ml-1 text-[color:var(--kb-fg-subtle)]">({r.memo})</span>}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(r.id)}
                className="rounded p-0.5 text-[color:var(--kb-fg-faint)] hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showAdd ? (
        <div className="mt-2 rounded-[4px] border border-[color:var(--kb-border)] p-2.5">
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <div className="col-span-2">
              <label className="text-[9px] text-[color:var(--kb-fg-muted)]">날짜</label>
              <input type="date" className={inputCls} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-[color:var(--kb-fg-muted)]">기본 시간</label>
              <input type="number" min={0} step={0.5} className={inputCls} value={newHours} onChange={(e) => setNewHours(e.target.value)} placeholder="8" />
            </div>
            <div>
              <label className="text-[9px] text-[color:var(--kb-fg-muted)]">연장</label>
              <input type="number" min={0} step={0.5} className={inputCls} value={newOt} onChange={(e) => setNewOt(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-[9px] text-[color:var(--kb-fg-muted)]">야간</label>
              <input type="number" min={0} step={0.5} className={inputCls} value={newNight} onChange={(e) => setNewNight(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="text-[9px] text-[color:var(--kb-fg-muted)]">휴일</label>
              <input type="number" min={0} step={0.5} className={inputCls} value={newHoliday} onChange={(e) => setNewHoliday(e.target.value)} placeholder="0" />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-[color:var(--kb-fg-muted)]">메모</label>
              <input type="text" className={inputCls} value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder="야간 조리" />
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={saving || !newHours} onClick={handleAdd} className="flex-1 h-6 text-[10px]">
              {saving ? "저장..." : "저장"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(false)} className="h-6 text-[10px]">취소</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-1 rounded-[4px] border border-dashed border-[color:var(--kb-border)] py-1.5 text-[10px] text-[color:var(--kb-fg-muted)] hover:bg-[color:var(--kb-surface-hover)]"
        >
          <Plus className="h-3 w-3" />
          근무 기록 추가
        </button>
      )}
    </div>
  );
};
