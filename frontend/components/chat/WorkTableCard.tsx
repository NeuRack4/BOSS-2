"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type WorkRecord = {
  work_date: string;
  hours_worked: number;
  overtime_hours: number;
  night_hours: number;
  holiday_hours: number;
  memo: string;
};

export type WorkActionData = {
  employee_id: string;
  employee_name: string;
  pay_month: string;
  records: WorkRecord[];
};

type Props = {
  data: WorkActionData;
  onClose: () => void;
  onConfirm: (data: WorkActionData) => void;
};

export const WorkTableCard = ({ data, onClose, onConfirm }: Props) => {
  const [rows, setRows] = useState<WorkRecord[]>(
    data.records.length > 0
      ? data.records.map((r) => ({ ...r }))
      : [
          {
            work_date: `${data.pay_month}-01`,
            hours_worked: 8,
            overtime_hours: 0,
            night_hours: 0,
            holiday_hours: 0,
            memo: "",
          },
        ],
  );

  const update = <K extends keyof WorkRecord>(
    i: number,
    field: K,
    value: WorkRecord[K],
  ) => {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)),
    );
  };

  const addRow = () =>
    setRows((prev) => [
      ...prev,
      {
        work_date: `${data.pay_month}-01`,
        hours_worked: 8,
        overtime_hours: 0,
        night_hours: 0,
        holiday_hours: 0,
        memo: "",
      },
    ]);

  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  const totalHours = rows.reduce(
    (s, r) =>
      s + r.hours_worked + r.overtime_hours + r.night_hours + r.holiday_hours,
    0,
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2e2719]/40 backdrop-blur-sm">
      <div className="relative flex max-h-[86vh] w-[min(860px,96vw)] flex-col overflow-hidden rounded-[5px] border border-[#030303]/10 bg-[#f4f1ed] shadow-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#030303]/[0.08] px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#030303]">
              Work Records
            </h3>
            <span className="font-mono text-[11px] text-[#030303]/60">
              {data.employee_name} · {data.pay_month}
            </span>
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
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Regular</th>
                  <th className="px-3 py-2 text-right font-medium">Overtime</th>
                  <th className="px-3 py-2 text-right font-medium">Night</th>
                  <th className="px-3 py-2 text-right font-medium">Holiday</th>
                  <th className="px-3 py-2 font-medium">Memo</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-[#030303]/5 last:border-b-0"
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="date"
                        value={r.work_date}
                        onChange={(e) => update(i, "work_date", e.target.value)}
                        className="bg-transparent font-mono text-[12px] text-[#030303] focus:outline-none"
                      />
                    </td>
                    {(
                      [
                        "hours_worked",
                        "overtime_hours",
                        "night_hours",
                        "holiday_hours",
                      ] as const
                    ).map((field) => (
                      <td key={field} className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          value={r[field]}
                          min={0}
                          step={0.5}
                          onChange={(e) =>
                            update(
                              i,
                              field,
                              Math.max(0, parseFloat(e.target.value) || 0),
                            )
                          }
                          className="w-14 bg-transparent text-right font-mono tabular-nums text-[#030303] focus:outline-none"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-1.5">
                      <input
                        value={r.memo}
                        onChange={(e) => update(i, "memo", e.target.value)}
                        placeholder="Memo"
                        className="w-full bg-transparent text-[#030303]/70 placeholder:text-[#030303]/25 focus:outline-none"
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
                  <td className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                    Total
                  </td>
                  <td
                    colSpan={4}
                    className="px-3 py-2 text-right font-mono tabular-nums text-[13px] font-semibold text-[#030303]"
                  >
                    {totalHours}h
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
            Add Row
          </button>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#030303]/[0.08] px-4 py-3">
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
            onClick={() => {
              onConfirm({ ...data, records: rows });
              onClose();
            }}
            disabled={rows.length === 0}
            className="rounded-[4px] bg-[#030303] text-white hover:bg-[#030303]/85 disabled:opacity-50"
          >
            Save & Calculate Pay
          </Button>
        </div>
      </div>
    </div>
  );
};
