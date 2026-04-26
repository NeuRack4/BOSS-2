"use client";

import { ExternalLink, Landmark } from "lucide-react";

export type SubsidyProgram = {
  title: string;
  organization: string;
  region: string;
  target: string;
  end_date: string;
  is_ongoing: boolean;
  description: string;
  detail_url: string;
};

export type SubsidyPayload = {
  programs: SubsidyProgram[];
};

const _SUBSIDY_JSON_RE = /\[\[SUBSIDY_JSON\]\]([\s\S]*?)\[\[\/SUBSIDY_JSON\]\]/;

export const extractSubsidyPayload = (
  text: string,
): { cleaned: string; payload: SubsidyPayload | null } => {
  const m = text.match(_SUBSIDY_JSON_RE);
  if (!m) return { cleaned: text, payload: null };
  let payload: SubsidyPayload | null = null;
  try {
    payload = JSON.parse(m[1]) as SubsidyPayload;
  } catch {
    payload = null;
  }
  const cleaned = text.replace(_SUBSIDY_JSON_RE, "").trim();
  return { cleaned, payload };
};

export const SubsidyRecommendCard = ({
  payload,
}: {
  payload: SubsidyPayload;
}) => {
  const programs = payload.programs || [];
  if (programs.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#c4d5b0] bg-[#f4f9ef] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Landmark className="h-4 w-4 text-[#4a7a3d]" />
        <span className="text-sm font-semibold text-[#1e3318]">
          정부 지원사업 추천
        </span>
        <span className="ml-auto rounded-full bg-[#d4eaca] px-2 py-0.5 text-xs text-[#3a6a2e]">
          {programs.length}건
        </span>
      </div>

      <div className="space-y-3">
        {programs.map((p, i) => (
          <div
            key={i}
            className="rounded-lg border border-[#d0e4c4] bg-white p-3"
          >
            {/* 헤더 행 */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1e3318] leading-snug">
                  {i + 1}. {p.title}
                </p>
              </div>
              {p.detail_url && (
                <a
                  href={p.detail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-md border border-[#b8d4a8] bg-[#e8f4e0] px-2 py-0.5 text-xs text-[#3a6a2e] flex items-center gap-1 hover:bg-[#d4eaca] transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  상세보기
                </a>
              )}
            </div>

            {/* 메타 정보 */}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#4a6a3e]">
              <span>
                <span className="text-[#030303]/40">주관</span> {p.organization}
              </span>
              <span>
                <span className="text-[#030303]/40">지역</span> {p.region}
              </span>
              <span>
                <span className="text-[#030303]/40">마감</span>{" "}
                {p.is_ongoing ? "상시" : p.end_date || "미정"}
              </span>
            </div>

            {/* 대상 */}
            {p.target && (
              <p className="mt-1.5 text-xs text-[#030303]/60 line-clamp-1">
                <span className="text-[#030303]/40">대상</span> {p.target}
              </p>
            )}

            {/* 내용 요약 */}
            {p.description && (
              <p className="mt-1.5 text-xs text-[#030303]/70 leading-relaxed line-clamp-2">
                {p.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
