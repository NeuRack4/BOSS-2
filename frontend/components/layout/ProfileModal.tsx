"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";

type ProfileRow = {
  display_name: string | null;
  business_name: string | null;
  business_type: string | null;
  business_stage: string | null;
  employees_count: string | null;
  location: string | null;
  channels: string | null;
  primary_goal: string | null;
  profile_meta: Record<string, unknown> | null;
};

type Form = Omit<ProfileRow, "profile_meta">;

type Props = {
  open: boolean;
  onClose: () => void;
};

const STAGE_OPTIONS = ["창업 준비", "오픈 직전", "영업 중", "확장 중"];
const STAFF_OPTIONS = ["0", "1-3", "4-9", "10+"];
const CHANNEL_OPTIONS = [
  { value: "offline", label: "Offline" },
  { value: "online", label: "Online" },
  { value: "both", label: "Both" },
];
const STAGE_LABEL: Record<string, string> = {
  "창업 준비": "Pre-launch",
  "오픈 직전": "Opening soon",
  "영업 중": "Operating",
  "확장 중": "Expanding",
};
const GOAL_OPTIONS = [
  "채용 관리",
  "마케팅 콘텐츠",
  "매출 분석",
  "서류 작성",
  "지원사업 추천",
  "전체 자동화",
];
const GOAL_LABEL: Record<string, string> = {
  "채용 관리": "Hiring",
  "마케팅 콘텐츠": "Marketing",
  "매출 분석": "Revenue",
  "서류 작성": "Documents",
  "지원사업 추천": "Subsidies",
  "전체 자동화": "Full automation",
};

const inputCls =
  "w-full rounded-[5px] border border-[#030303]/10 bg-[#fafafa] px-3 py-1.5 text-[13px] text-[#030303] placeholder:text-[#030303]/30 focus:border-[#4a7c59] focus:outline-none focus:ring-1 focus:ring-[#4a7c59]";
const readonlyCls =
  "w-full rounded-[5px] border border-[#030303]/10 bg-[#f0ede8] px-3 py-1.5 text-[13px] text-[#030303]/60 cursor-default select-all";
const selectCls =
  "w-full rounded-[5px] border border-[#030303]/10 bg-[#fafafa] px-3 py-1.5 text-[13px] text-[#030303] focus:border-[#4a7c59] focus:outline-none focus:ring-1 focus:ring-[#4a7c59]";
const labelCls =
  "mb-1 block font-mono text-[10.5px] uppercase tracking-wider text-[#030303]/50";

const toForm = (p: ProfileRow | null): Form => ({
  display_name: p?.display_name ?? "",
  business_name: p?.business_name ?? "",
  business_type: p?.business_type ?? "",
  business_stage: p?.business_stage ?? "",
  employees_count: p?.employees_count ?? "",
  location: p?.location ?? "",
  channels: p?.channels ?? "",
  primary_goal: p?.primary_goal ?? "",
});

export const ProfileModal = ({ open, onClose }: Props) => {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [form, setForm] = useState<Form>(toForm(null));
  const [metaEntries, setMetaEntries] = useState<Array<[string, string]>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setSaved(false);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }
      setUserId(user.id);
      setEmail(user.email ?? null);
      const { data } = await supabase
        .from("profiles")
        .select(
          "display_name, business_name, business_type, business_stage, employees_count, location, channels, primary_goal, profile_meta",
        )
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      const p = (data as ProfileRow | null) ?? null;
      setProfile(p);
      setForm(toForm(p));

      const entries: Array<[string, string]> = [];
      if (p?.profile_meta && typeof p.profile_meta === "object") {
        for (const [k, raw] of Object.entries(p.profile_meta)) {
          if (!raw) continue;
          const val = Array.isArray(raw)
            ? raw.filter(Boolean).join(", ")
            : String(raw);
          if (val) entries.push([k, val]);
        }
      }
      setMetaEntries(entries);
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const set = (k: keyof Form, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const update: Record<string, string | null> = {};
      (Object.keys(form) as Array<keyof Form>).forEach((k) => {
        update[k] = (form[k] as string).trim() || null;
      });
      await supabase.from("profiles").update(update).eq("id", userId);
      window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/subsidies/cache/invalidate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: userId }),
        },
      ).catch(() => {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Profile"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="h-[560px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/60">
            Loading…
          </div>
        ) : (
          <div className="flex h-full flex-col gap-4">
            <ScrollArea className="min-h-0 flex-1 pr-1">
              <div className="space-y-4 pb-2">
                {/* Email (read-only) */}
                <div>
                  <label className={labelCls}>Email</label>
                  <input
                    className={readonlyCls}
                    value={email ?? ""}
                    readOnly
                    tabIndex={-1}
                  />
                </div>

                {/* Identity */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Nickname</label>
                    <input
                      className={inputCls}
                      value={form.display_name ?? ""}
                      onChange={(e) => set("display_name", e.target.value)}
                      placeholder="e.g. John, Boss"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Business Name</label>
                    <input
                      className={inputCls}
                      value={form.business_name ?? ""}
                      onChange={(e) => set("business_name", e.target.value)}
                      placeholder="e.g. My Café"
                    />
                  </div>
                </div>

                {/* Business details */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Industry</label>
                    <input
                      className={inputCls}
                      value={form.business_type ?? ""}
                      onChange={(e) => set("business_type", e.target.value)}
                      placeholder="e.g. Café, Restaurant"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Location</label>
                    <input
                      className={inputCls}
                      value={form.location ?? ""}
                      onChange={(e) => set("location", e.target.value)}
                      placeholder="e.g. Seoul, Mapo-gu"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Stage</label>
                    <select
                      className={selectCls}
                      value={form.business_stage ?? ""}
                      onChange={(e) => set("business_stage", e.target.value)}
                    >
                      <option value="">—</option>
                      {STAGE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Staff</label>
                    <select
                      className={selectCls}
                      value={form.employees_count ?? ""}
                      onChange={(e) => set("employees_count", e.target.value)}
                    >
                      <option value="">—</option>
                      {STAFF_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Channel</label>
                    <select
                      className={selectCls}
                      value={form.channels ?? ""}
                      onChange={(e) => set("channels", e.target.value)}
                    >
                      <option value="">—</option>
                      {CHANNEL_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Goal pills */}
                <div>
                  <label className={labelCls}>Goal</label>
                  <div className="flex flex-wrap gap-1.5">
                    {GOAL_OPTIONS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() =>
                          set("primary_goal", form.primary_goal === g ? "" : g)
                        }
                        className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                          form.primary_goal === g
                            ? "bg-[#4a7c59] text-white"
                            : "bg-[#f0ede8] text-[#030303]/60 hover:bg-[#e8f0e4]"
                        }`}
                      >
                        {GOAL_LABEL[g]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Additional meta */}
                {metaEntries.length > 0 && (
                  <div>
                    <div className={labelCls + " mb-2"}>Additional Info</div>
                    <div className="divide-y divide-[#030303]/[0.06] rounded-[5px] border border-[#030303]/10 bg-[#ffffff]">
                      {metaEntries.map(([k, v]) => (
                        <div
                          key={k}
                          className="flex items-baseline justify-between gap-3 px-4 py-2"
                        >
                          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-[#030303]/50">
                            {k}
                          </span>
                          <span className="truncate text-right text-[13px] text-[#030303]">
                            {v}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Save button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-[5px] bg-[#4a7c59] py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#3d6a4a] disabled:opacity-40"
            >
              {saving ? "Saving…" : saved ? "Saved!" : "Save"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};
