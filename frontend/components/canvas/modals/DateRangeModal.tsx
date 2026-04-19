"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DateRangeValue = {
  start_date?: string | null;
  end_date?: string | null;
  due_date?: string | null;
};

type Mode = "range" | "due";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  initial?: DateRangeValue;
  onSubmit: (value: DateRangeValue) => Promise<void> | void;
};

const todayStr = () => new Date().toISOString().slice(0, 10);

export const DateRangeModal = ({
  open,
  onClose,
  title,
  initial,
  onSubmit,
}: Props) => {
  const initialMode: Mode =
    initial?.due_date && !initial?.end_date ? "due" : "range";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [start, setStart] = useState<string>(initial?.start_date ?? "");
  const [end, setEnd] = useState<string>(initial?.end_date ?? "");
  const [due, setDue] = useState<string>(initial?.due_date ?? todayStr());
  const [pending, setPending] = useState(false);

  const invalid = useMemo(() => {
    if (mode === "due") return !due;
    if (!start && !end) return true;
    if (start && end && start > end) return true;
    return false;
  }, [mode, start, end, due]);

  const handleSubmit = async () => {
    if (invalid || pending) return;
    setPending(true);
    try {
      const payload: DateRangeValue =
        mode === "due"
          ? { due_date: due || null, start_date: null, end_date: null }
          : {
              start_date: start || null,
              end_date: end || null,
              due_date: null,
            };
      await onSubmit(payload);
      onClose();
    } finally {
      setPending(false);
    }
  };

  const handleClear = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onSubmit({ start_date: null, end_date: null, due_date: null });
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} widthClass="w-[480px]">
      <div className="space-y-3">
        <div className="flex gap-1 rounded-md border border-[#ddd0b4] p-0.5">
          <button
            type="button"
            onClick={() => setMode("range")}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs transition-colors",
              mode === "range"
                ? "bg-[#ebe0ca] text-[#2e2719]"
                : "text-[#8c7e66] hover:text-[#2e2719]",
            )}
          >
            기간 (시작 ~ 종료)
          </button>
          <button
            type="button"
            onClick={() => setMode("due")}
            className={cn(
              "flex-1 rounded px-2 py-1 text-xs transition-colors",
              mode === "due"
                ? "bg-[#ebe0ca] text-[#2e2719]"
                : "text-[#8c7e66] hover:text-[#2e2719]",
            )}
          >
            마감일
          </button>
        </div>

        {mode === "range" ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block font-mono text-[10px] uppercase tracking-[0.15em] text-[#8c7e66]">
                시작일
              </span>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded border border-[#ddd0b4] bg-[#f2e9d5] px-2 py-1.5 text-[12px] text-[#2e2719] focus:outline-none focus:ring-1 focus:ring-[#bfae8a]"
              />
            </label>
            <label className="space-y-1">
              <span className="block font-mono text-[10px] uppercase tracking-[0.15em] text-[#8c7e66]">
                종료일
              </span>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded border border-[#ddd0b4] bg-[#f2e9d5] px-2 py-1.5 text-[12px] text-[#2e2719] focus:outline-none focus:ring-1 focus:ring-[#bfae8a]"
              />
            </label>
          </div>
        ) : (
          <label className="space-y-1">
            <span className="block font-mono text-[10px] uppercase tracking-[0.15em] text-[#8c7e66]">
              마감일
            </span>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full rounded border border-[#ddd0b4] bg-[#f2e9d5] px-2 py-1.5 text-[12px] text-[#2e2719] focus:outline-none focus:ring-1 focus:ring-[#bfae8a]"
            />
          </label>
        )}

        {start && end && start > end && (
          <p className="text-[11px] text-[#b85a4a]">
            시작일이 종료일보다 늦습니다.
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={pending}
            className="text-[#8c7e66] hover:text-[#2e2719]"
          >
            기간 제거
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={pending || invalid}
              className="bg-[#7f8f54] text-[#fbf6eb] hover:bg-[#6a7843]"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "저장"
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
