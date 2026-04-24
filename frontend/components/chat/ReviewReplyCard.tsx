"use client";

import { useState } from "react";
import { Check, Copy, Star } from "lucide-react";

export type ReviewReplyPayload = {
  reply_text: string;
  star_rating: number | null;
  char_count: number;
};

const _REVIEW_REPLY_RE = /\[\[REVIEW_REPLY\]\]([\s\S]*?)\[\[\/REVIEW_REPLY\]\]/;

export const extractReviewReplyPayload = (
  text: string,
): { cleaned: string; payload: ReviewReplyPayload | null } => {
  const m = text.match(_REVIEW_REPLY_RE);
  if (!m) return { cleaned: text, payload: null };
  let payload: ReviewReplyPayload | null = null;
  try {
    payload = JSON.parse(m[1]) as ReviewReplyPayload;
  } catch {
    payload = null;
  }
  return { cleaned: text.replace(_REVIEW_REPLY_RE, "").trimEnd(), payload };
};

const CharBar = ({ count }: { count: number }) => {
  const pct = Math.min(100, Math.round((count / 150) * 100));
  const color =
    count <= 150
      ? "bg-[#7f8f54]"
      : count <= 200
        ? "bg-[#d89a2b]"
        : "bg-[#c47865]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ebe0ca]">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`text-[11px] font-medium tabular-nums ${
          count <= 150
            ? "text-[#5a7560]"
            : count <= 200
              ? "text-[#8a6a2c]"
              : "text-[#8a3a28]"
        }`}
      >
        {count}자 {count <= 150 ? "✓" : count <= 200 ? "▲" : "초과"}
      </span>
    </div>
  );
};

export const ReviewReplyCard = ({
  payload,
}: {
  payload: ReviewReplyPayload;
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload.reply_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  };

  const stars = payload.star_rating ?? 0;

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-[#ddd0b4] bg-[#fffaf2] shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#ddd0b4] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[#2e2719]">
            리뷰 답글
          </span>
          {stars > 0 && (
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className="h-3 w-3"
                  fill={i < stars ? "#d89a2b" : "none"}
                  stroke={i < stars ? "#d89a2b" : "#bfae8a"}
                  strokeWidth={1.5}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-[#ddd0b4] bg-[#ebe0ca] px-2.5 py-1 text-[12px] font-medium text-[#2e2719] transition-colors hover:bg-[#ddd0b4] active:scale-95"
          aria-label="답글 복사"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[#5a7560]" />
              복사됨
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              복사
            </>
          )}
        </button>
      </div>

      {/* Reply text */}
      <div className="px-4 py-3">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#2e2719]">
          {payload.reply_text}
        </p>
      </div>

      {/* Char count bar */}
      <div className="border-t border-[#ddd0b4] px-4 py-2">
        <CharBar count={payload.char_count} />
      </div>
    </div>
  );
};
