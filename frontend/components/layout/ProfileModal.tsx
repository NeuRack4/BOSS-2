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

type Props = {
  open: boolean;
  onClose: () => void;
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

const formatField = (k: keyof ProfileRow, v: string | null): string | null => {
  if (!v) return null;
  if (k === "business_stage") return STAGE_LABEL[v] ?? v;
  if (k === "channels") return CHANNELS_LABEL[v] ?? v;
  return v;
};

export const ProfileModal = ({ open, onClose }: Props) => {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select(
          "display_name, business_name, business_type, business_stage, employees_count, location, channels, primary_goal, profile_meta",
        )
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      setProfile((data as ProfileRow | null) ?? null);
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const rows: Array<{ label: string; value: string }> = [];
  if (profile) {
    const push = (label: string, k: keyof ProfileRow) => {
      const v = formatField(k, profile[k] as string | null);
      if (v) rows.push({ label, value: v });
    };
    push("업종", "business_type");
    push("상호", "business_name");
    push("단계", "business_stage");
    push("직원", "employees_count");
    push("지역", "location");
    push("채널", "channels");
    push("목표", "primary_goal");
  }

  const metaEntries: Array<[string, string]> = [];
  if (profile?.profile_meta && typeof profile.profile_meta === "object") {
    for (const [k, raw] of Object.entries(profile.profile_meta)) {
      if (!raw) continue;
      const val = Array.isArray(raw)
        ? raw.filter(Boolean).join(", ")
        : String(raw);
      if (val) metaEntries.push([k, val]);
    }
  }

  const name =
    profile?.display_name?.trim() ||
    profile?.business_name?.trim() ||
    "프로필 미설정";

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
            불러오는 중...
          </div>
        ) : (
          <ScrollArea className="h-full pr-1">
            <div className="mb-4 rounded-[5px] border border-[#030303]/10 bg-[#ffffff] px-4 py-3">
              <div className="text-base font-semibold text-[#030303]">
                {name}
              </div>
              {profile?.business_name && profile?.display_name && (
                <div className="mt-0.5 text-[12px] text-[#030303]/60">
                  {profile.business_name}
                </div>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="text-[12px] text-[#030303]/50">
                대화하며 프로필을 채워나가요.
              </p>
            ) : (
              <div className="divide-y divide-[#030303]/[0.06] rounded-[5px] border border-[#030303]/10 bg-[#ffffff]">
                {rows.map((r) => (
                  <div
                    key={r.label}
                    className="flex items-baseline justify-between gap-3 px-4 py-2"
                  >
                    <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-wider text-[#030303]/50">
                      {r.label}
                    </span>
                    <span className="truncate text-right text-[13px] text-[#030303]">
                      {r.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {metaEntries.length > 0 && (
              <>
                <div className="mt-5 mb-2 font-mono text-[10.5px] uppercase tracking-wider text-[#030303]/60">
                  추가 정보
                </div>
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
              </>
            )}
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
