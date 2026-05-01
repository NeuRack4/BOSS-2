// frontend/components/sales/dashboard/tabs/NotificationTab.tsx
"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Clock } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const label =
    h === 0
      ? "오전 12시"
      : h < 12
        ? `오전 ${h}시`
        : h === 12
          ? "오후 12시"
          : `오후 ${h - 12}시`;
  return { value: h, label };
});

type Props = {
  accountId: string;
  slackConnected: boolean;
  onOpenConnect: () => void;
};

export function NotificationTab({
  accountId,
  slackConnected,
  onOpenConnect,
}: Props) {
  const [enabled, setEnabled] = useState(true);
  const [hour, setHour] = useState(21);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/notifications/settings?account_id=${accountId}`)
      .then((r) => r.json())
      .then((res) => {
        setEnabled(res.data?.notify_enabled ?? true);
        setHour(res.data?.notify_hour ?? 21);
      });
  }, [accountId]);

  const handleSave = async () => {
    setSaving(true);
    await fetch(`${API}/api/notifications/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        notify_enabled: enabled,
        notify_hour: hour,
      }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-3 p-1">
      {/* Slack 미연동 시 안내 */}
      {!slackConnected && (
        <div className="flex items-center gap-2 rounded-xl border border-[#e8d5e8] bg-[#f9f0f9] px-4 py-3">
          <BellOff className="h-4 w-4 shrink-0 text-[#4A154B]" />
          <p className="text-[12px] text-[#4A154B]">
            알림 수신을 위해 Slack 연동이 필요해요.
          </p>
        </div>
      )}
      <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 flex flex-col gap-3">
        {/* 알림 받기 + 토글 */}
        <div className="flex items-center">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-slate-400" />
            <span className="text-[13px] font-medium text-slate-700">
              알림 받기
            </span>
          </div>
          <div className="w-[30px]" />
          <button
            onClick={() => setEnabled((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              enabled ? "bg-[#7C3AED]" : "bg-slate-200"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* 알림 시간 + 드롭다운 */}
        {enabled && (
          <div className="flex items-center">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-slate-400" />
              <span className="text-[13px] font-medium text-slate-700">
                알림 시간
              </span>
            </div>
            <div className="w-[30px]" />
            <select
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="rounded-md border border-slate-200 px-2 py-1 text-[12px] text-slate-600 outline-none focus:border-slate-400"
            >
              {HOUR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !slackConnected}
          title={!slackConnected ? "Slack 연동 후 저장할 수 있어요" : undefined}
          className="w-[160px] rounded-xl border border-[#7C3AED] bg-[#7C3AED]/10 py-2 text-[13px] font-medium text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {saved ? "저장됐어요 ✓" : saving ? "저장 중…" : "저장"}
        </button>
        {!slackConnected && (
          <button
            onClick={onOpenConnect}
            className="w-[120px] rounded-xl border border-[#4A154B] bg-[#4A154B] py-2 text-[13px] font-medium text-white hover:bg-white hover:text-[#4A154B] active:scale-95 transition"
          >
            Slack 연결하기
          </button>
        )}
      </div>
    </div>
  );
}
