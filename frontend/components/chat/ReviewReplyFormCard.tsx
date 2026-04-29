"use client";

import React, { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = async (file: File) => {
    setImageFile(file);
    setAnalyzeError("");

    // 미리보기
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);

    // 자동 분석
    setAnalyzing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/api/marketing/review/analyze`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.error) {
        setAnalyzeError(data.error);
      } else {
        if (data.review_text) setReviewText(data.review_text);
        if (data.star_rating) setStarRating(data.star_rating);
        if (data.platform) {
          const pMap: Record<string, string> = {
            naver: "네이버 플레이스",
            kakao: "카카오맵",
            google: "구글",
          };
          setPlatform(pMap[data.platform] ?? "기타");
        }
      }
    } catch {
      setAnalyzeError(
        "이미지 분석에 실패했어요. 리뷰 내용을 직접 입력해주세요.",
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleImageSelect(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setAnalyzeError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
        {/* 이미지 업로드 */}
        <div>
          <label className={labelCls}>리뷰 캡처 이미지 (선택)</label>

          {!imagePreview ? (
            <div
              className="relative flex flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed border-neutral-200 bg-neutral-50 py-5 cursor-pointer hover:border-neutral-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
            >
              <ImagePlus className="h-5 w-5 text-neutral-400" />
              <p className="text-[12px] text-neutral-400">
                클릭하거나 이미지를 드래그하세요
              </p>
              <p className="text-[11px] text-neutral-300">
                업로드 시 리뷰 내용·별점·플랫폼이 자동으로 입력됩니다
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageSelect(file);
                }}
              />
            </div>
          ) : (
            <div className="relative rounded-[4px] border border-neutral-200 overflow-hidden">
              <img
                src={imagePreview}
                alt="리뷰 캡처"
                className="w-full max-h-48 object-contain bg-neutral-50"
              />
              <button
                onClick={clearImage}
                className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              {analyzing && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                  <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                  <span className="ml-2 text-[12px] text-neutral-500">
                    분석 중...
                  </span>
                </div>
              )}
            </div>
          )}

          {analyzeError && (
            <p className="mt-1.5 text-[11px] text-red-500">{analyzeError}</p>
          )}
          {imageFile && !analyzing && !analyzeError && (
            <p className="mt-1.5 text-[11px] text-green-600">
              분석 완료 — 아래 내용을 확인 후 수정하세요
            </p>
          )}
        </div>

        {/* 리뷰 원문 */}
        <div>
          <label className={labelCls}>
            리뷰 원문 <span className="text-red-400">*</span>
          </label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={4}
            placeholder="고객이 남긴 리뷰를 그대로 붙여넣거나, 위에서 이미지를 업로드하면 자동 입력됩니다"
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
                <span
                  className={
                    displayStar >= star ? "text-amber-400" : "text-neutral-200"
                  }
                >
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
          disabled={!reviewText.trim() || analyzing}
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
