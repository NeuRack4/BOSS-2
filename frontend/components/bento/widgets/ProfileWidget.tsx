"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ProfileRow = {
  display_name: string | null;
  business_name: string | null;
  business_type: string | null;
  business_stage: string | null;
  employees_count: string | null;
  location: string | null;
  channels: string | null;
  primary_goal: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  "창업 준비": "창업 준비",
  "오픈 직전": "오픈 직전",
  "영업 중": "영업 중",
  "확장 중": "확장 중",
};

const CHANNELS_LABEL: Record<string, string> = {
  offline: "오프라인",
  online: "온라인",
  both: "양쪽",
};

const FIELDS: Array<{ label: string; key: keyof ProfileRow }> = [
  { label: "Business", key: "business_name" },
  { label: "Industry", key: "business_type" },
  { label: "Stage", key: "business_stage" },
  { label: "Staff", key: "employees_count" },
  { label: "Location", key: "location" },
  { label: "Channel", key: "channels" },
  { label: "Goal", key: "primary_goal" },
];

const formatField = (k: keyof ProfileRow, v: string | null): string | null => {
  if (!v) return null;
  if (k === "business_stage") return STAGE_LABEL[v] ?? v;
  if (k === "channels") return CHANNELS_LABEL[v] ?? v;
  return v;
};

export const ProfileWidget = ({ bgColor }: { bgColor?: string }) => {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const sb = createClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      if (!cancelled) setEmail(user.email ?? null);
      const { data } = await sb
        .from("profiles")
        .select(
          "display_name, business_name, business_type, business_stage, employees_count, location, channels, primary_goal",
        )
        .eq("id", user.id)
        .single();
      if (!cancelled) {
        setProfile(data as ProfileRow | null);
        setLoading(false);
      }
    };
    run();
    const handler = () => run();
    window.addEventListener("boss:artifacts-changed", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("boss:artifacts-changed", handler);
    };
  }, []);

  const name =
    profile?.display_name?.trim() ||
    profile?.business_name?.trim() ||
    "Not set";
  const rows = FIELDS.map(({ label, key }) => ({
    label,
    value: formatField(key, (profile?.[key] as string | null) ?? null),
  }));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() =>
        window.dispatchEvent(new CustomEvent("boss:open-profile-modal"))
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("boss:open-profile-modal"));
        }
      }}
      data-tour="profile-menu"
      className="group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] p-5 text-left shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-[#030303]/30"
      style={{ backgroundColor: bgColor ?? "#f1d9c7" }}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <span className="text-base font-semibold tracking-tight text-[#030303]">
          Profile
        </span>
        <ArrowUpRight className="h-5 w-5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/40">
            Loading…
          </div>
        ) : (
          <div className="space-y-1.5">
            {email && (
              <div className="flex items-baseline justify-between gap-2 rounded-[5px] bg-[#fcfcfc]/40 px-3 py-1.5">
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-[#030303]/50">
                  Email
                </span>
                <span className="truncate text-right text-[12.5px] text-[#030303]/70">
                  {email}
                </span>
              </div>
            )}
            <div className="rounded-[5px] bg-[#fcfcfc]/60 px-3 py-2">
              <div className="mb-0.5 font-mono text-[11px] uppercase tracking-wider text-[#030303]/50">
                Nickname
              </div>
              <div className="truncate text-[14px] font-semibold text-[#030303]">
                {name}
              </div>
            </div>
            {rows.map((r) => (
              <div
                key={r.label}
                className="flex items-baseline justify-between gap-2 rounded-[5px] bg-[#fcfcfc]/40 px-3 py-1.5"
              >
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-[#030303]/50">
                  {r.label}
                </span>
                <span
                  className={`truncate text-right text-[12.5px] ${r.value ? "text-[#030303]" : "text-[#030303]/30"}`}
                >
                  {r.value ?? "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
