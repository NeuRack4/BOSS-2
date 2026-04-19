"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ label: string; cron: string }> = [
  { label: "매 시간 정각", cron: "0 * * * *" },
  { label: "매일 오전 9시", cron: "0 9 * * *" },
  { label: "매일 오후 6시", cron: "0 18 * * *" },
  { label: "평일 오전 9시", cron: "0 9 * * 1-5" },
  { label: "매주 월요일 오전 10시", cron: "0 10 * * 1" },
  { label: "매월 1일 오전 9시", cron: "0 9 1 * *" },
  { label: "30분마다", cron: "*/30 * * * *" },
  { label: "매일 자정", cron: "0 0 * * *" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  initialCron?: string;
  title: string;
  onSubmit: (cron: string) => Promise<void> | void;
};

export const ScheduleModal = ({
  open,
  onClose,
  mode,
  initialCron,
  title,
  onSubmit,
}: Props) => {
  const [cron, setCron] = useState(initialCron ?? "0 9 * * *");
  const [pending, setPending] = useState(false);

  const handleSubmit = async () => {
    if (!cron.trim() || pending) return;
    setPending(true);
    try {
      await onSubmit(cron.trim());
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} widthClass="w-[520px]">
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-[#8c7e66]">
            프리셋
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.cron}
                type="button"
                onClick={() => setCron(p.cron)}
                className={cn(
                  "rounded border px-2 py-1.5 text-left text-[11px] transition-colors",
                  cron === p.cron
                    ? "border-[#7f8f54] bg-[#7f8f54]/12 text-[#6a7843]"
                    : "border-[#ddd0b4] bg-[#ebe0ca]/40 text-[#2e2719] hover:bg-[#ebe0ca]",
                )}
              >
                <div className="font-medium">{p.label}</div>
                <div className="mt-0.5 font-mono text-[9px] text-[#8c7e66]">
                  {p.cron}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-[#8c7e66]">
            cron 표현식 (커스텀)
          </p>
          <input
            type="text"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="w-full rounded border border-[#ddd0b4] bg-[#f2e9d5] px-2 py-1.5 font-mono text-[12px] text-[#2e2719] focus:outline-none focus:ring-1 focus:ring-[#bfae8a]"
            placeholder="분 시 일 월 요일"
          />
          <p className="mt-1 font-mono text-[9px] text-[#8c7e66]">
            형식: 분(0-59) 시(0-23) 일(1-31) 월(1-12) 요일(0-6)
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>
            취소
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={pending || !cron.trim()}
            className="bg-[#7f8f54] text-[#fbf6eb] hover:bg-[#6a7843]"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : mode === "create" ? (
              "스케줄 만들기"
            ) : (
              "저장"
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
