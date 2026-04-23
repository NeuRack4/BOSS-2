"use client";

import { useEffect, useState } from "react";
import { Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type EmployeeSummary = {
  id: string;
  name: string;
  employment_type: string;
  hourly_rate: number | null;
  monthly_salary: number | null;
  pay_day: number | null;
  department: string | null;
  position: string | null;
};

export type EmployeePickerPayload = {
  employees: EmployeeSummary[];
  pay_month: string;
};

type WorkRecordSummary = {
  hours_worked: number;
  overtime_hours: number;
  night_hours: number;
  holiday_hours: number;
};

type Props = {
  payload: EmployeePickerPayload;
  accountId: string;
  onConfirm: (confirmMessage: string) => void;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL;

export const EmployeePickerCard = ({ payload, accountId, onConfirm }: Props) => {
  const { employees, pay_month } = payload;
  const [selected, setSelected] = useState<string | null>(null);
  const [summary, setSummary] = useState<WorkRecordSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!selected) { setSummary(null); return; }
    setLoadingSummary(true);
    fetch(
      `${apiBase}/api/employees/${selected}/work-records?account_id=${accountId}&month=${pay_month}`,
    )
      .then((r) => r.json())
      .then((json) => {
        const records: WorkRecordSummary[] = json?.data ?? [];
        const agg = records.reduce(
          (acc, r) => ({
            hours_worked: acc.hours_worked + (r.hours_worked ?? 0),
            overtime_hours: acc.overtime_hours + (r.overtime_hours ?? 0),
            night_hours: acc.night_hours + (r.night_hours ?? 0),
            holiday_hours: acc.holiday_hours + (r.holiday_hours ?? 0),
          }),
          { hours_worked: 0, overtime_hours: 0, night_hours: 0, holiday_hours: 0 },
        );
        setSummary(agg);
      })
      .catch(() => setSummary(null))
      .finally(() => setLoadingSummary(false));
  }, [selected, accountId, pay_month]);

  const selectedEmp = employees.find((e) => e.id === selected);

  const handleConfirm = () => {
    if (!selected) return;
    setConfirmed(true);
    const confirmMsg = `__PAYROLL_CONFIRM__:${JSON.stringify({ employee_id: selected, pay_month })}`;
    onConfirm(confirmMsg);
  };

  if (confirmed) {
    return (
      <div className="rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] px-4 py-3 text-[12px] text-[color:var(--kb-fg-muted)]">
        급여명세서를 생성하는 중입니다...
      </div>
    );
  }

  return (
    <div className="rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] p-4">
      <p className="mb-3 text-[12px] font-semibold text-[color:var(--kb-fg-strong)]">
        직원 선택 — {pay_month}
      </p>

      <div className="mb-3 space-y-1.5">
        {employees.map((emp) => (
          <button
            key={emp.id}
            type="button"
            onClick={() => setSelected(emp.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-[5px] border px-3 py-2 text-left transition-colors",
              selected === emp.id
                ? "border-[#7977a0] bg-[#c8c7d6]/30"
                : "border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] hover:bg-[color:var(--kb-surface-hover)]",
            )}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7977a0]/15">
              <User className="h-3.5 w-3.5 text-[#7977a0]" />
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-medium text-[color:var(--kb-fg-strong)]">
                {emp.name}
                {emp.position && (
                  <span className="ml-1.5 text-[11px] text-[color:var(--kb-fg-muted)]">
                    {emp.position}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[color:var(--kb-fg-subtle)]">
                {emp.employment_type}
                {emp.hourly_rate ? ` · ${emp.hourly_rate.toLocaleString()}원/h` : ""}
                {emp.monthly_salary ? ` · 월 ${emp.monthly_salary.toLocaleString()}원` : ""}
              </div>
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="mb-3 rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface-hover)] px-3 py-2.5 text-[11px]">
          {loadingSummary ? (
            <div className="flex items-center gap-1.5 text-[color:var(--kb-fg-muted)]">
              <Loader2 className="h-3 w-3 animate-spin" />
              근무 기록 불러오는 중...
            </div>
          ) : summary ? (
            <>
              <div className="mb-1 font-semibold text-[color:var(--kb-fg-strong)]">
                {pay_month} 근무 기록
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[color:var(--kb-fg-muted)]">
                <span>기본 근무: {summary.hours_worked}h</span>
                <span>연장: {summary.overtime_hours}h</span>
                <span>야간: {summary.night_hours}h</span>
                <span>휴일: {summary.holiday_hours}h</span>
              </div>
              {summary.hours_worked === 0 && (
                <p className="mt-1.5 text-[10px] text-amber-600">
                  ⚠️ 이 달 근무 기록이 없어요. 직원 관리 탭에서 먼저 입력해 주세요.
                </p>
              )}
            </>
          ) : (
            <span className="text-[color:var(--kb-fg-muted)]">근무 기록 없음</span>
          )}
        </div>
      )}

      <Button
        size="sm"
        disabled={!selected}
        onClick={handleConfirm}
        className="w-full text-[12px]"
      >
        {selectedEmp ? `${selectedEmp.name} 급여명세서 생성` : "직원을 선택해 주세요"}
      </Button>
    </div>
  );
};

export const extractEmployeePickerPayload = (
  text: string,
): { cleaned: string; payload: EmployeePickerPayload | undefined } => {
  const PREFIX = "[ACTION:SELECT_EMPLOYEE_FOR_PAYROLL:";
  const start = text.indexOf(PREFIX);
  if (start === -1) return { cleaned: text, payload: undefined };

  const jsonStart = start + PREFIX.length;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) { jsonEnd = i; break; }
    }
  }
  if (jsonEnd === -1) return { cleaned: text, payload: undefined };

  let markerEnd = jsonEnd + 1;
  while (markerEnd < text.length && text[markerEnd] !== "]") markerEnd++;
  markerEnd++;

  let payload: EmployeePickerPayload | undefined;
  try {
    payload = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch { /* ignore */ }

  const cleaned = (text.slice(0, start) + text.slice(markerEnd)).trim();
  return { cleaned, payload };
};
