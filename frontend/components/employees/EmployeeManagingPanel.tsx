"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmployeeForm, type EmployeeFormData } from "./EmployeeForm";
import { WorkRecordPanel } from "./WorkRecordPanel";

export type Employee = {
  id: string;
  name: string;
  employment_type: string;
  hourly_rate: number | null;
  monthly_salary: number | null;
  pay_day: number | null;
  phone: string | null;
  department: string | null;
  position: string | null;
  hire_date: string | null;
  status: string;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL;

type Props = { accountId: string };

export const EmployeeManagingPanel = ({ accountId }: Props) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/api/employees?account_id=${accountId}&status=active`,
      );
      const json = await res.json();
      setEmployees(json?.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data: EmployeeFormData) => {
    if (editTarget) {
      await fetch(
        `${apiBase}/api/employees/${editTarget.id}?account_id=${accountId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
    } else {
      await fetch(`${apiBase}/api/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, account_id: accountId }),
      });
    }
    setShowForm(false);
    setEditTarget(null);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("직원을 삭제하시겠습니까?")) return;
    await fetch(`${apiBase}/api/employees/${id}?account_id=${accountId}`, {
      method: "DELETE",
    });
    await load();
  };

  const openEdit = (emp: Employee) => {
    setEditTarget(emp);
    setShowForm(true);
  };

  const openNew = () => {
    setEditTarget(null);
    setShowForm(true);
  };

  const empTypeColor: Record<string, string> = {
    초단시간: "bg-amber-100 text-amber-700",
    시급제: "bg-sky-100 text-sky-700",
    월급제: "bg-emerald-100 text-emerald-700",
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[color:var(--kb-fg-strong)]">
          직원 ({employees.length}명)
        </span>
        <Button size="sm" variant="outline" onClick={openNew} className="h-7 gap-1 text-[11px]">
          <Plus className="h-3.5 w-3.5" />
          직원 추가
        </Button>
      </div>

      {showForm && (
        <EmployeeForm
          initial={editTarget ?? undefined}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTarget(null); }}
        />
      )}

      {loading ? (
        <div className="py-8 text-center text-[11px] text-[color:var(--kb-fg-muted)]">
          불러오는 중...
        </div>
      ) : employees.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[5px] border border-dashed border-[color:var(--kb-border)] py-10 text-center">
          <User className="h-8 w-8 text-[color:var(--kb-fg-faint)]" />
          <p className="text-[11px] text-[color:var(--kb-fg-muted)]">
            등록된 직원이 없어요.
          </p>
          <Button size="sm" variant="outline" onClick={openNew} className="text-[11px]">
            첫 직원 추가
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {employees.map((emp) => (
            <div
              key={emp.id}
              className="rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-surface)]"
            >
              {/* Header row */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d4a588]/20">
                  <User className="h-3.5 w-3.5 text-[#d4a588]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-[color:var(--kb-fg-strong)]">
                      {emp.name}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                        empTypeColor[emp.employment_type] ?? "bg-gray-100 text-gray-600",
                      )}
                    >
                      {emp.employment_type}
                    </span>
                  </div>
                  <div className="text-[10px] text-[color:var(--kb-fg-subtle)]">
                    {[emp.department, emp.position].filter(Boolean).join(" · ")}
                    {emp.hourly_rate ? ` · ${emp.hourly_rate.toLocaleString()}원/h` : ""}
                    {emp.monthly_salary ? ` · 월 ${emp.monthly_salary.toLocaleString()}원` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(emp)}
                    className="rounded p-1 text-[color:var(--kb-fg-muted)] hover:bg-[color:var(--kb-surface-hover)] hover:text-[color:var(--kb-fg-strong)]"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(emp.id)}
                    className="rounded p-1 text-[color:var(--kb-fg-muted)] hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((prev) => (prev === emp.id ? null : emp.id))
                    }
                    className="rounded p-1 text-[color:var(--kb-fg-muted)] hover:bg-[color:var(--kb-surface-hover)]"
                  >
                    {expandedId === emp.id ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Expanded — Work Records */}
              {expandedId === emp.id && (
                <div className="border-t border-[color:var(--kb-border)] px-3 py-3">
                  <WorkRecordPanel employeeId={emp.id} accountId={accountId} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
