"use client";

import React, { useState } from "react";

const TONE_OPTIONS = ["따뜻한", "유머러스", "전문적인", "감성적인", "활기찬"];
const PLATFORM_OPTIONS = ["인스타그램", "페이스북", "스레드"];

export function SnsPostFormCard({
  onSubmit,
}: {
  onSubmit: (message: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [product, setProduct] = useState("");
  const [promotion, setPromotion] = useState("");
  const [tones, setTones] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>(["인스타그램"]);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const toggleTone = (t: string) => {
    setTones((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const togglePlatform = (p: string) => {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const handleSubmit = () => {
    if (!topic.trim()) return;

    const lines: string[] = [
      "아래 정보로 SNS 게시물을 바로 완성해줘 (추가 폼 없이 즉시 작성):",
      `주제: ${topic.trim()}`,
      product.trim() && `제품/서비스: ${product.trim()}`,
      promotion.trim() && `혜택/프로모션: ${promotion.trim()}`,
      tones.length > 0 && `톤: ${tones.join(", ")}`,
      platforms.length > 0 && `플랫폼: ${platforms.join(", ")}`,
      notes.trim() && `추가 요청사항: ${notes.trim()}`,
    ].filter(Boolean) as string[];

    setSubmitted(true);
    onSubmit(lines.join("\n"));
  };

  if (submitted) {
    return (
      <div className="rounded-[5px] border border-neutral-200 bg-white p-4 w-full max-w-[480px]">
        <p className="text-[13px] text-neutral-500">
          게시물 정보를 전달했어요. 잠시 기다려주세요...
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-[4px] border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-[#c13584] transition-colors";
  const labelCls = "block text-[11px] font-medium text-neutral-500 mb-1";
  const pillActive = "bg-[#c13584] text-white border-[#c13584]";
  const pillIdle = "bg-white text-neutral-600 border-neutral-200 hover:border-[#c13584]";

  return (
    <div className="rounded-[5px] border border-[#f0d0e8] bg-white overflow-hidden w-full max-w-[480px] shadow-sm">
      {/* 헤더 */}
      <div className="px-4 py-3 bg-gradient-to-r from-[#fff5f0] to-[#fdf0f8] border-b border-[#f0d0e8] flex items-center gap-2">
        {/* 인스타그램 로고 */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="ig-form-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f09433"/>
              <stop offset="50%" stopColor="#e6683c"/>
              <stop offset="100%" stopColor="#bc1888"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-form-grad)"/>
          <circle cx="12" cy="12" r="4.5" stroke="white" strokeWidth="1.8" fill="none"/>
          <circle cx="17.5" cy="6.5" r="1.2" fill="white"/>
        </svg>
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#8a3070]">
          Instagram 게시물 작성
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
            placeholder="예) 신메뉴 출시, 어버이날 이벤트"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        {/* 제품/서비스 */}
        <div>
          <label className={labelCls}>제품 · 서비스</label>
          <input
            type="text"
            className={inputCls}
            placeholder="예) 아메리카노, 케이크 세트"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
          />
        </div>

        {/* 혜택/프로모션 */}
        <div>
          <label className={labelCls}>혜택 · 프로모션</label>
          <input
            type="text"
            className={inputCls}
            placeholder="예) 20% 할인, 1+1 증정"
            value={promotion}
            onChange={(e) => setPromotion(e.target.value)}
          />
        </div>

        {/* 톤 */}
        <div>
          <label className={labelCls}>톤 (복수 선택 가능)</label>
          <div className="flex flex-wrap gap-2">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => toggleTone(t)}
                className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                  tones.includes(t) ? pillActive : pillIdle
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* 플랫폼 */}
        <div>
          <label className={labelCls}>플랫폼</label>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => togglePlatform(p)}
                className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                  platforms.includes(p) ? pillActive : pillIdle
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 추가 요청사항 */}
        <div>
          <label className={labelCls}>추가 요청사항 (선택)</label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={2}
            placeholder="예) 이모지 많이 써줘, 젊은 감성으로"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* 제출 */}
        <button
          onClick={handleSubmit}
          disabled={!topic.trim()}
          className="w-full py-2 rounded-[4px] bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] text-white text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          게시물 작성 시작
        </button>
      </div>
    </div>
  );
}

export function extractSnsPostForm(text: string): {
  cleaned: string;
  hasForm: boolean;
} {
  const start = "[[SNS_POST_FORM]]";
  const end = "[[/SNS_POST_FORM]]";
  const si = text.indexOf(start);
  const ei = text.indexOf(end);
  if (si === -1 || ei === -1) return { cleaned: text, hasForm: false };
  const cleaned = (text.slice(0, si) + text.slice(ei + end.length)).trim();
  return { cleaned, hasForm: true };
}
