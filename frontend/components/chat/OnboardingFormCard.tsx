"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const GOAL_OPTIONS = [
  "채용 관리",
  "마케팅 콘텐츠",
  "매출 분석",
  "서류 작성",
  "지원사업 추천",
  "전체 자동화",
];

type Props = {
  accountId: string;
  onComplete: (summary: string) => void;
};

export const OnboardingFormCard = ({ accountId, onComplete }: Props) => {
  const [nickname, setNickname] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [location, setLocation] = useState("");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessType.trim() || !location.trim()) return;
    setSaving(true);
    try {
      const sb = createClient();
      const update: Record<string, string> = {
        business_type: businessType.trim(),
        location: location.trim(),
      };
      if (nickname.trim()) update.display_name = nickname.trim();
      if (primaryGoal) update.primary_goal = primaryGoal;
      await sb.from("profiles").update(update).eq("id", accountId);
      window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/subsidies/cache/invalidate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        },
      ).catch(() => {});

      const parts = [];
      if (nickname.trim()) parts.push(`${nickname.trim()}으로 불러드릴게요`);
      parts.push(`업종: ${businessType.trim()}`);
      parts.push(`지역: ${location.trim()}`);
      if (primaryGoal) parts.push(`목표: ${primaryGoal}`);
      onComplete(parts.join(" · "));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-[340px] rounded-[5px] border border-[#ddd0b4] bg-[#faf8f4] p-4 text-[13px]"
    >
      <div className="mb-3 text-[12px] font-semibold text-[#030303]/60 uppercase tracking-wide">
        프로필 설정
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[12px] text-[#030303]/60">
            어떻게 불러드릴까요?
          </label>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="예: 김사장님, 대표님"
            className="w-full rounded-[5px] border border-[#ddd0b4] bg-white px-3 py-1.5 text-[13px] placeholder:text-[#030303]/30 focus:outline-none focus:ring-1 focus:ring-[#4a7c59]"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] text-[#030303]/60">
            업종 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            placeholder="예: 카페, 음식점, 의류매장, 미용실"
            required
            className="w-full rounded-[5px] border border-[#ddd0b4] bg-white px-3 py-1.5 text-[13px] placeholder:text-[#030303]/30 focus:outline-none focus:ring-1 focus:ring-[#4a7c59]"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] text-[#030303]/60">
            사업장 지역 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="예: 서울 마포구, 부산 해운대구"
            required
            className="w-full rounded-[5px] border border-[#ddd0b4] bg-white px-3 py-1.5 text-[13px] placeholder:text-[#030303]/30 focus:outline-none focus:ring-1 focus:ring-[#4a7c59]"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] text-[#030303]/60">
            주요 목표
          </label>
          <div className="flex flex-wrap gap-1.5">
            {GOAL_OPTIONS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setPrimaryGoal(primaryGoal === g ? "" : g)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  primaryGoal === g
                    ? "bg-[#4a7c59] text-white"
                    : "bg-[#f0ede8] text-[#030303]/60 hover:bg-[#e8f0e4]"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving || !businessType.trim() || !location.trim()}
        className="mt-4 w-full rounded-[5px] bg-[#4a7c59] py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#3d6a4a] disabled:opacity-40"
      >
        {saving ? "저장 중…" : "시작하기"}
      </button>
    </form>
  );
};
