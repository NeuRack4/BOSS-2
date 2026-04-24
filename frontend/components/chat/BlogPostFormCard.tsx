"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { X, ImagePlus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const DIRECTION_OPTIONS = [
  "신상품 소개",
  "이벤트 공지",
  "일상 스토리",
  "리뷰·후기",
];
const TONE_OPTIONS = ["친근한", "전문적인", "감성적인", "정보 전달형"];
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function BlogPostFormCard({
  onSubmit,
}: {
  onSubmit: (message: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [direction, setDirection] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("");
  const [autoUpload, setAutoUpload] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // 이미지
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const addImages = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    const remaining = 10 - imageFiles.length;
    const toAdd = incoming.slice(0, remaining);
    setImageFiles((prev) => [...prev, ...toAdd]);
    toAdd.forEach((f) => {
      const url = URL.createObjectURL(f);
      setPreviews((prev) => [...prev, url]);
    });
  };

  const removeImage = (idx: number) => {
    URL.revokeObjectURL(previews[idx]);
    setImageFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!topic.trim()) return;
    setUploading(true);
    setUploadError("");

    let imageUrls: string[] = [];
    if (imageFiles.length > 0) {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        const accountId = data.user?.id ?? "";
        for (const file of imageFiles) {
          const form = new FormData();
          form.append("account_id", accountId);
          form.append("file", file);
          const res = await fetch(`${API_BASE}/api/marketing/photos/upload`, {
            method: "POST",
            body: form,
          });
          const json = await res.json();
          if (json.data?.public_url) imageUrls.push(json.data.public_url);
        }
      } catch {
        setUploadError("이미지 업로드 중 오류가 발생했어요.");
        setUploading(false);
        return;
      }
    }

    const lines: string[] = [
      "아래 정보로 블로그 포스트를 바로 완성해줘 (추가 폼 없이 즉시 작성):",
      `주제: ${topic.trim()}`,
      direction && `방향: ${direction}`,
      keywords.trim() && `키워드: ${keywords.trim()}`,
      tone && `톤: ${tone}`,
      imageUrls.length > 0 &&
        `첨부 이미지 URL (포스트에 활용): ${imageUrls.join(", ")}`,
      autoUpload && "네이버 블로그 자동 업로드: 예",
      notes.trim() && `추가 요청사항: ${notes.trim()}`,
    ].filter(Boolean) as string[];

    setSubmitted(true);
    onSubmit(lines.join("\n"));
  };

  if (submitted) {
    return (
      <div className="rounded-[5px] border border-neutral-200 bg-white p-4 w-full max-w-[480px]">
        <p className="text-[13px] text-neutral-500">
          블로그 포스트 정보를 전달했어요. 잠시 기다려주세요...
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-[4px] border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-[#03C75A] transition-colors";
  const labelCls = "block text-[11px] font-medium text-neutral-500 mb-1";
  const pillActive = "bg-[#03C75A] text-white border-[#03C75A]";
  const pillIdle =
    "bg-white text-neutral-600 border-neutral-200 hover:border-[#03C75A]";

  return (
    <div className="rounded-[5px] border border-[#c8f0d8] bg-white overflow-hidden w-full max-w-[480px] shadow-sm">
      <div className="px-4 py-3 bg-[#f0fff6] border-b border-[#c8f0d8] flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M13.5 12.5L10 7H7v10h3.5V11.5L15 17h3V7h-3.5v5.5z"
            fill="#03C75A"
          />
        </svg>
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#028a3d]">
          네이버 Blog 포스트 작성
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* 주제 */}
        <div>
          <label className={labelCls}>
            주제 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            className={inputCls}
            placeholder="예) 봄 신메뉴 소개, 어버이날 이벤트 안내"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        {/* 포스팅 방향 */}
        <div>
          <label className={labelCls}>포스팅 방향</label>
          <div className="flex flex-wrap gap-2">
            {DIRECTION_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDirection(direction === d ? "" : d)}
                className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                  direction === d ? pillActive : pillIdle
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* 톤 */}
        <div>
          <label className={labelCls}>톤</label>
          <div className="flex flex-wrap gap-2">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => setTone(tone === t ? "" : t)}
                className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                  tone === t ? pillActive : pillIdle
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* 키워드 */}
        <div>
          <label className={labelCls}>검색 키워드 (쉼표로 구분)</label>
          <input
            type="text"
            className={inputCls}
            placeholder="예) 카페, 봄 메뉴, 홍대 카페"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </div>

        {/* 이미지 첨부 */}
        <div>
          <label className={labelCls}>이미지 첨부 (선택, 최대 10장)</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => addImages(e.target.files)}
          />
          {/* 썸네일 그리드 */}
          {previews.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {previews.map((url, idx) => (
                <div key={idx} className="relative h-16 w-16 shrink-0">
                  <Image
                    src={url}
                    alt={`이미지 ${idx + 1}`}
                    fill
                    className="rounded-[4px] object-cover border border-neutral-200"
                    unoptimized
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-white hover:bg-neutral-900"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
              {imageFiles.length < 10 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[4px] border border-dashed border-[#03C75A] text-[#03C75A] hover:bg-[#f0fff6] transition-colors"
                >
                  <ImagePlus className="h-5 w-5" />
                </button>
              )}
            </div>
          )}
          {previews.length === 0 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-[4px] border border-dashed border-[#a8dfc0] py-3 text-[12px] text-[#03C75A] hover:bg-[#f0fff6] transition-colors"
            >
              <ImagePlus className="h-4 w-4" />
              이미지 추가하기
            </button>
          )}
          {uploadError && (
            <p className="mt-1 text-[11px] text-red-500">{uploadError}</p>
          )}
        </div>

        {/* 네이버 블로그 자동 업로드 */}
        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-[12px] text-neutral-700">
              네이버 블로그 자동 업로드
            </p>
            <p className="text-[11px] text-neutral-400">
              작성 후 블로그에 바로 게시합니다
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoUpload((v) => !v)}
            className={`relative h-5 w-9 shrink-0 overflow-hidden rounded-full transition-colors ${
              autoUpload ? "bg-[#03C75A]" : "bg-neutral-200"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                autoUpload ? "translate-x-[18px]" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {/* 추가 요청사항 */}
        <div>
          <label className={labelCls}>추가 요청사항 (선택)</label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={2}
            placeholder="예) 500자 이상으로, 사진 설명 중심으로"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!topic.trim() || uploading}
          className="flex w-full items-center justify-center gap-2 py-2 rounded-[4px] bg-[#03C75A] text-white text-[13px] font-medium hover:bg-[#02a84a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              이미지 업로드 중...
            </>
          ) : (
            "포스트 작성 시작"
          )}
        </button>
      </div>
    </div>
  );
}

export function extractBlogPostForm(text: string): {
  cleaned: string;
  hasForm: boolean;
} {
  const start = "[[BLOG_POST_FORM]]";
  const end = "[[/BLOG_POST_FORM]]";
  const si = text.indexOf(start);
  const ei = text.indexOf(end);
  if (si === -1 || ei === -1) return { cleaned: text, hasForm: false };
  const cleaned = (text.slice(0, si) + text.slice(ei + end.length)).trim();
  return { cleaned, hasForm: true };
}
