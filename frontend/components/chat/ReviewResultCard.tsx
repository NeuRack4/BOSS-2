"use client";

import { AlertTriangle, FileCheck2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReviewClause = {
  clause: string;
  reason: string;
  severity: "High" | "Mid" | "Low";
  suggestion_from: string;
  suggestion_to: string;
};

export type ReviewPayload = {
  analysis_id: string;
  analyzed_doc_id?: string;
  gap_ratio: number;
  eul_ratio: number;
  summary: string;
  risk_clauses: ReviewClause[];
};

const SEVERITY_TONE: Record<ReviewClause["severity"], string> = {
  High: "bg-[#e9c9c0] text-[#8a3a28] border-[#d9a191]",
  Mid: "bg-[#efdfc8] text-[#8a6a2c] border-[#d6c39a]",
  Low: "bg-[#e3ece2] text-[#5a7560] border-[#bccab6]",
};

const _REVIEW_JSON_RE = /\[\[REVIEW_JSON\]\]([\s\S]*?)\[\[\/REVIEW_JSON\]\]/;
const _CHOICES_RE = /\[CHOICES\][\s\S]*?\[\/CHOICES\]/g;
const _ARTIFACT_RE = /\[ARTIFACT\][\s\S]*?\[\/ARTIFACT\]/g;
const _SET_NICKNAME_RE = /\[SET_NICKNAME\][\s\S]*?\[\/SET_NICKNAME\]/g;
const _SET_PROFILE_RE = /\[SET_PROFILE\][\s\S]*?\[\/SET_PROFILE\]/g;
const _REVIEW_REQUEST_RE = /\[REVIEW_REQUEST\][\s\S]*?\[\/REVIEW_REQUEST\]/g;

/** 어떤 경로를 타더라도 에이전트 마커 블록이 본문에 노출되지 않도록 방어적으로 정리. */
const stripMarkers = (text: string): string =>
  text
    .replace(_CHOICES_RE, "")
    .replace(_ARTIFACT_RE, "")
    .replace(_SET_NICKNAME_RE, "")
    .replace(_SET_PROFILE_RE, "")
    .replace(_REVIEW_REQUEST_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const extractReviewPayload = (
  text: string,
): { cleaned: string; payload: ReviewPayload | null } => {
  const m = text.match(_REVIEW_JSON_RE);
  let payload: ReviewPayload | null = null;
  let body = text;
  if (m) {
    try {
      payload = JSON.parse(m[1]) as ReviewPayload;
    } catch {
      payload = null;
    }
    body = text.replace(_REVIEW_JSON_RE, "");
  }
  return { cleaned: stripMarkers(body), payload };
};

export const ReviewResultCard = ({ payload }: { payload: ReviewPayload }) => {
  const gap = Math.max(0, Math.min(100, payload.gap_ratio || 0));
  const eul = Math.max(0, Math.min(100, payload.eul_ratio || 100 - gap));
  const risks = payload.risk_clauses || [];

  return (
    <div className="rounded-xl border border-[#ddd0b4] bg-[#fffaf2] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-[#6a7843]" />
        <span className="text-sm font-semibold text-[#2e2719]">
          공정성 분석 결과
        </span>
        <span className="ml-auto font-mono text-[10px] text-[#8c7e66]">
          #{payload.analysis_id.slice(0, 8)}
        </span>
      </div>

      {/* gap / eul 이중 바 */}
      <div className="mb-3 space-y-1">
        <div className="flex justify-between text-[11px] font-medium text-[#5a5040]">
          <span>갑 {gap}%</span>
          <span>을 {eul}%</span>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#ebe0ca]">
          <div
            className="bg-[#c47865] transition-all"
            style={{ width: `${gap}%` }}
            aria-label={`갑 유리 ${gap}%`}
          />
          <div
            className="bg-[#7f8f54] transition-all"
            style={{ width: `${eul}%` }}
            aria-label={`을 유리 ${eul}%`}
          />
        </div>
      </div>

      {payload.summary && (
        <p className="mb-3 whitespace-pre-wrap text-xs leading-relaxed text-[#2e2719]">
          {payload.summary}
        </p>
      )}

      {risks.length > 0 && (
        <div className="border-t border-[#ddd0b4] pt-3">
          <div className="mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-[#a35c4a]" />
            <span className="text-xs font-semibold text-[#2e2719]">
              주요 위험 조항 {risks.length}건
            </span>
          </div>
          <ul className="space-y-2">
            {risks.map((c, i) => (
              <li
                key={i}
                className="rounded-md border border-[#ebe0ca] bg-[#fbf6eb] p-2"
              >
                <div className="mb-1 flex items-start gap-2">
                  <span
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0 text-[10px] font-semibold leading-4",
                      SEVERITY_TONE[c.severity] ?? SEVERITY_TONE.Mid,
                    )}
                  >
                    {c.severity}
                  </span>
                  <span className="text-xs font-medium text-[#2e2719]">
                    {c.clause}
                  </span>
                </div>
                {c.reason && (
                  <p className="mb-1 pl-14 text-[11px] text-[#5a5040]">
                    사유 · {c.reason}
                  </p>
                )}
                {(c.suggestion_from || c.suggestion_to) && (
                  <div className="pl-14 text-[11px] text-[#5a5040]">
                    <span className="text-[#8c7e66]">수정 · </span>
                    <code className="rounded bg-[#ebe0ca] px-1">
                      {c.suggestion_from}
                    </code>
                    <span className="px-1 text-[#8c7e66]">→</span>
                    <code className="rounded bg-[#cfe3d0] px-1">
                      {c.suggestion_to}
                    </code>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
