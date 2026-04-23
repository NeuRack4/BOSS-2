"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Employee } from "./EmployeeManagingPanel";

export type EmployeeFormData = {
  name: string;
  employment_type: string;
  hourly_rate: number | null;
  monthly_salary: number | null;
  pay_day: number | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  hire_date: string | null;
};

type Props = {
  initial?: Employee;
  onSave: (data: EmployeeFormData) => Promise<void>;
  onCancel: () => void;
};

const EMPLOYMENT_TYPES = ["초단시간", "시급제", "월급제"] as const;

export const EmployeeForm = ({ initial, onSave, onCancel }: Props) => {
  const [name, setName] = useState(initial?.name ?? "");
  const [empType, setEmpType] = useState(initial?.employment_type ?? "시급제");
  const [hourlyRate, setHourlyRate] = useState(
    String(initial?.hourly_rate ?? ""),
  );
  const [monthlySalary, setMonthlySalary] = useState(
    String(initial?.monthly_salary ?? ""),
  );
  const [payDay, setPayDay] = useState(String(initial?.pay_day ?? "25"));
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [position, setPosition] = useState(initial?.position ?? "");
  const [hireDate, setHireDate] = useState(initial?.hire_date ?? "");
  const [saving, setSaving] = useState(false);

  const isHourly = empType !== "월급제";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        employment_type: empType,
        hourly_rate: isHourly && hourlyRate ? parseInt(hourlyRate) : null,
        monthly_salary:
          !isHourly && monthlySalary ? parseInt(monthlySalary) : null,
        pay_day: payDay ? parseInt(payDay) : null,
        phone: phone || null,
        department: department || null,
        position: position || null,
        hire_date: hireDate || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-[4px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)] px-2.5 py-1.5 text-[12px] text-[color:var(--kb-fg-strong)] focus:outline-none focus:ring-1 focus:ring-[#d4a588]";
  const labelCls = "text-[10px] font-medium text-[color:var(--kb-fg-muted)]";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[5px] border border-[#d4a588]/40 bg-[#f7e6da]/20 p-3"
    >
      <p className="mb-3 text-[12px] font-semibold text-[color:var(--kb-fg-strong)]">
        {initial ? "직원 정보 수정" : "새 직원 추가"}
      </p>

      <div className="grid grid-cols-2 gap-2">
        {/* 이름 */}
        <div className="col-span-2">
          <label className={labelCls}>이름 *</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            required
          />
        </div>

        {/* 고용형태 */}
        <div className="col-span-2">
          <label className={labelCls}>고용형태 *</label>
          <div className="mt-1 flex gap-1.5">
            {EMPLOYMENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setEmpType(t)}
                className={`rounded-[4px] border px-3 py-1 text-[11px] transition-colors ${
                  empType === t
                    ? "border-[#d4a588] bg-[#d4a588]/20 font-semibold text-[#a07050]"
                    : "border-[color:var(--kb-border)] text-[color:var(--kb-fg-muted)] hover:bg-[color:var(--kb-surface-hover)]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* 시급 or 월급 */}
        {isHourly ? (
          <div>
            <label className={labelCls}>시급 (원)</label>
            <input
              className={inputCls}
              type="number"
              min={10030}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="11000"
            />
          </div>
        ) : (
          <div>
            <label className={labelCls}>월급 (원)</label>
            <input
              className={inputCls}
              type="number"
              min={0}
              value={monthlySalary}
              onChange={(e) => setMonthlySalary(e.target.value)}
              placeholder="2500000"
            />
          </div>
        )}

        {/* 지급 예정일 */}
        <div>
          <label className={labelCls}>지급 예정일</label>
          <input
            className={inputCls}
            type="number"
            min={1}
            max={31}
            value={payDay}
            onChange={(e) => setPayDay(e.target.value)}
            placeholder="25"
          />
        </div>

        {/* 부서 */}
        <div>
          <label className={labelCls}>부서</label>
          <input
            className={inputCls}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="홀"
          />
        </div>

        {/* 직책 */}
        <div>
          <label className={labelCls}>직책</label>
          <input
            className={inputCls}
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="알바"
          />
        </div>

        {/* 연락처 */}
        <div>
          <label className={labelCls}>연락처</label>
          <input
            className={inputCls}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
          />
        </div>

        {/* 입사일 */}
        <div>
          <label className={labelCls}>입사일</label>
          <input
            className={inputCls}
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className="flex-1 text-[12px]"
        >
          {saving ? "저장 중..." : "저장"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          className="text-[12px]"
        >
          취소
        </Button>
      </div>
    </form>
  );
};
