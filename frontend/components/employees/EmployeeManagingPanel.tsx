"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2, User } from "lucide-react";
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

export type EmployeeManagingHandle = {
  openNew: () => void;
};

const apiBase = process.env.NEXT_PUBLIC_API_URL;

type Props = { accountId: string };

const empTypeColor: Record<string, string> = {
  초단시간: "bg-amber-100 text-amber-700",
  시급제: "bg-sky-100 text-sky-700",
  월급제: "bg-emerald-100 text-emerald-700",
};

export const EmployeeManagingPanel = forwardRef<EmployeeManagingHandle, Props>(
  ({ accountId }, ref) => {
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

    useEffect(() => {
      load();
    }, [load]);

    useImperativeHandle(ref, () => ({
      openNew: () => {
        setEditTarget(null);
        setShowForm(true);
      },
    }));

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

    return (
      <div className="space-y-2">
        {showForm && (
          <EmployeeForm
            initial={editTarget ?? undefined}
            onSave={handleSave}
            onCancel={() => {
              setShowForm(false);
              setEditTarget(null);
            }}
          />
        )}

        {loading ? (
          <div className="flex h-24 items-center justify-center text-[11px] text-[color:var(--kb-fg-muted)]">
            불러오는 중...
          </div>
        ) : employees.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-[5px] border border-dashed border-[color:var(--kb-border)] text-[11px] text-[color:var(--kb-fg-faint)]">
            등록된 직원이 없어요
          </div>
        ) : (
          employees.map((emp) => (
            <div
              key={emp.id}
              className="group relative overflow-hidden rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-card)]"
            >
              {/* Accent bar */}
              <div
                className="absolute left-0 top-0 h-full w-[2px] bg-[#d4a588] opacity-60 transition-opacity group-hover:opacity-100"
                aria-hidden
              />

              <div className="p-3">
                <div className="flex items-start gap-2.5">
                  {/* Icon */}
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] border border-[color:var(--kb-border)] bg-[color:var(--kb-icon-bg)]">
                    <User className="h-3.5 w-3.5 text-[color:var(--kb-fg-muted)]" />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium leading-snug text-[color:var(--kb-fg)]">
                        {emp.name}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[9px] font-semibold",
                          empTypeColor[emp.employment_type] ??
                            "bg-gray-100 text-gray-600",
                        )}
                      >
                        {emp.employment_type}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-[color:var(--kb-fg-subtle)]">
                      {[emp.department, emp.position]
                        .filter(Boolean)
                        .join(" · ")}
                      {emp.hourly_rate
                        ? ` · ${emp.hourly_rate.toLocaleString()}원/h`
                        : ""}
                      {emp.monthly_salary
                        ? ` · 월 ${emp.monthly_salary.toLocaleString()}원`
                        : ""}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => openEdit(emp)}
                      className="rounded p-1 text-[color:var(--kb-fg-muted)] hover:bg-[color:var(--kb-surface-hover)] hover:text-[color:var(--kb-fg-strong)]"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(emp.id)}
                      className="rounded p-1 text-[color:var(--kb-fg-muted)] hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId((prev) =>
                          prev === emp.id ? null : emp.id,
                        )
                      }
                      className="rounded p-1 text-[color:var(--kb-fg-muted)] hover:bg-[color:var(--kb-surface-hover)]"
                    >
                      {expandedId === emp.id ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded: work records */}
                {expandedId === emp.id && (
                  <div className="mt-2.5 border-t border-[color:var(--kb-border)] pt-2.5">
                    <WorkRecordPanel
                      employeeId={emp.id}
                      accountId={accountId}
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    );
  },
);

EmployeeManagingPanel.displayName = "EmployeeManagingPanel";
