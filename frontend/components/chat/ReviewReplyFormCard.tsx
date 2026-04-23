"use client";

import React, { useState } from "react";

const PLATFORM_OPTIONS = ["네이버 플레이스", "카카오맵", "구글", "기타"];

export function ReviewReplyFormCard({
  onSubmit,
}: {
  onSubmit: (message: string) => void;
}) {
  const [reviewText, setReviewText] = useState("");
  const [starRating, setStarRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [platform, setPlatform] = useState("네이버 플레이스");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!reviewText.trim()) return;

    const lines: string[] = [
      "아래 리뷰에 사장님 답글을 바로 작성해줘 (추가 폼 없이 즉시 작성):",
      `리뷰 원문: ${reviewText.trim()}`,
      starRating > 0 && `별점: ${starRating}점`,
      platform && `플랫폼: ${platform}`,
    ].filter(Boolean) as string[];

    setSubmitted(true);
    onSubmit(lines.join("\n"));
  };

  if (submitted) {
    return (
      <div className="rounded-[5px] border border-neutral-200 bg-white p-4 w-full max-w-[480px]">
        <p className="text-[13px] text-neutral-500">
          리뷰 정보를 전달했어요. 잠시 기다려주세요...
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-[4px] border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 transition-colors";
  const labelCls = "block text-[11px] font-medium text-neutral-500 mb-1";

  const displayStar = hoveredStar || starRating;

  return (
    <div className="rounded-[5px] border border-neutral-200 bg-white overflow-hidden w-full max-w-[480px] shadow-sm">
      <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          리뷰 답글 작성
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* 리뷰 원문 */}
        <div>
          <label className={labelCls}>
            리뷰 원문 <span className="text-red-400">*</span>
          </label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={4}
            placeholder="고객이 남긴 리뷰를 그대로 붙여넣어 주세요"
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
          />
        </div>

        {/* 별점 */}
        <div>
          <label className={labelCls}>별점</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => setStarRating(star === starRating ? 0 : star)}
                className="text-2xl transition-transform hover:scale-110 active:scale-95"
              >
                <span className={displayStar >= star ? "text-amber-400" : "text-neutral-200"}>
                  ★
                </span>
              </button>
            ))}
            {starRating > 0 && (
              <span className="ml-2 self-center text-[12px] text-neutral-500">
                {starRating}점
              </span>
            )}
          </div>
        </div>

        {/* 플랫폼 */}
        <div>
          <label className={labelCls}>플랫폼</label>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                  platform === p
                    ? "bg-neutral-800 text-white border-neutral-800"
                    : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!reviewText.trim()}
          className="w-full py-2 rounded-[4px] bg-neutral-800 text-white text-[13px] font-medium hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          답글 작성 시작
        </button>
      </div>
    </div>
  );
}

export function extractReviewReplyForm(text: string): {
  cleaned: string;
  hasForm: boolean;
} {
  const start = "[[REVIEW_REPLY_FORM]]";
  const end = "[[/REVIEW_REPLY_FORM]]";
  const si = text.indexOf(start);
  const ei = text.indexOf(end);
  if (si === -1 || ei === -1) return { cleaned: text, hasForm: false };
  const cleaned = (text.slice(0, si) + text.slice(ei + end.length)).trim();
  return { cleaned, hasForm: true };
}
