"use client";

import React, { useState } from "react";

const EVENT_TYPES = ["할인", "증정", "SNS 이벤트", "체험·클래스", "기타"];

// 채널별 설명 — 선택 시 어떤 결과물이 나오는지 안내
const CHANNEL_INFO: Record<string, { label: string; desc: string }> = {
  인스타그램: {
    label: "인스타그램",
    desc: "캡션 + 해시태그 + 이미지 미리보기 카드 생성",
  },
  "네이버 블로그": {
    label: "네이버 블로그",
    desc: "마크다운 포스트 작성 + 자동 업로드",
  },
  "오프라인 포스터": {
    label: "오프라인 포스터",
    desc: "기획안에 포스터 문구 포함",
  },
};

export function EventPlanFormCard({
  onSubmit,
}: {
  onSubmit: (message: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [benefit, setBenefit] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const toggleChannel = (ch: string) => {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  };

  const handleSubmit = () => {
    if (!title.trim() || !startDate) return;

    // 채널별 명시적 생성 지시 — 플래너가 체이닝 dispatch 하도록
    const channelInstructions: string[] = [];
    if (channels.includes("인스타그램"))
      channelInstructions.push(
        "인스타그램 게시물(캡션+해시태그+이미지)도 바로 작성해줘",
      );
    if (channels.includes("네이버 블로그"))
      channelInstructions.push(
        "네이버 블로그 포스트도 바로 작성해서 업로드해줘",
      );
    if (channels.includes("오프라인 포스터"))
      channelInstructions.push(
        "이벤트 포스터 HTML도 생성해줘 (별도 포스터 생성 기능 사용)",
      );

    const lines: string[] = [
      "이벤트 기획해줘.",
      `- 이벤트명: ${title.trim()}`,
      eventType && `- 이벤트 종류: ${eventType}`,
      `- 시작일: ${startDate}`,
      endDate && `- 종료일: ${endDate}`,
      benefit.trim() && `- 혜택·참여방법: ${benefit.trim()}`,
      channels.length > 0 && `- 홍보 채널: ${channels.join(", ")}`,
      ...channelInstructions,
      notes.trim() && `- 추가 요청사항: ${notes.trim()}`,
    ].filter(Boolean) as string[];

    setSubmitted(true);
    onSubmit(lines.join("\n"));
  };

  if (submitted) {
    return (
      <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 w-full max-w-[480px]">
        <p className="text-[13px] text-violet-600">
          이벤트 정보를 전달했어요. 잠시 기다려주세요...
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[13px] text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-violet-400 focus:bg-white transition-colors";
  const labelCls =
    "block text-[11px] font-semibold text-neutral-500 mb-1.5 uppercase tracking-wide";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden w-full max-w-[480px] shadow-md">
      {/* 헤더 */}
      <div className="px-5 py-4 bg-gradient-to-r from-violet-500 to-indigo-500">
        <span className="text-[12px] font-bold tracking-wide text-white">
          이벤트 기획
        </span>
        <p className="text-[11px] text-white/70 mt-0.5">
          정보를 입력하면 AI가 기획안을 바로 작성해드려요
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* 이벤트명 */}
        <div>
          <label className={labelCls}>
            이벤트명 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            className={inputCls}
            placeholder="예) 어버이날 감사 이벤트"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* 이벤트 종류 */}
        <div>
          <label className={labelCls}>이벤트 종류</label>
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setEventType(eventType === t ? "" : t)}
                className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                  eventType === t
                    ? "bg-violet-500 text-white border-violet-500"
                    : "bg-white text-neutral-600 border-neutral-200 hover:border-violet-300 hover:text-violet-600"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* 기간 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>
              시작일 <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              className={inputCls}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>종료일</label>
            <input
              type="date"
              className={inputCls}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        {/* 혜택·참여방법 */}
        <div>
          <label className={labelCls}>혜택 · 참여방법</label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={2}
            placeholder="예) 전 메뉴 20% 할인, 어린이 고객 음료 1잔 증정"
            value={benefit}
            onChange={(e) => setBenefit(e.target.value)}
          />
        </div>

        {/* 홍보 채널 */}
        <div>
          <label className={labelCls}>홍보 채널</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {Object.keys(CHANNEL_INFO).map((ch) => (
              <button
                key={ch}
                onClick={() => toggleChannel(ch)}
                className={`text-[12px] px-3 py-1 rounded-full border transition-colors ${
                  channels.includes(ch)
                    ? "bg-violet-500 text-white border-violet-500"
                    : "bg-white text-neutral-600 border-neutral-200 hover:border-violet-300 hover:text-violet-600"
                }`}
              >
                {ch}
              </button>
            ))}
          </div>

          {/* 선택된 채널 결과물 안내 */}
          {channels.length > 0 && (
            <div className="space-y-1.5">
              {channels.map((ch) => (
                <div
                  key={ch}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-100"
                >
                  <span className="text-[10px] font-semibold text-neutral-500 mt-0.5 shrink-0">
                    {CHANNEL_INFO[ch]?.label}
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    {CHANNEL_INFO[ch]?.desc}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 추가 요청사항 */}
        <div>
          <label className={labelCls}>추가 요청사항 (선택)</label>
          <textarea
            className={`${inputCls} resize-none`}
            rows={2}
            placeholder="예) 톤을 밝고 유머러스하게, 어린이 타겟으로"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* 제출 */}
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || !startDate}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 text-white text-[13px] font-semibold hover:from-violet-600 hover:to-indigo-600 transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          기획 시작
        </button>
      </div>
    </div>
  );
}

export function extractEventPlanForm(text: string): {
  cleaned: string;
  hasForm: boolean;
} {
  const start = "[[EVENT_PLAN_FORM]]";
  const end = "[[/EVENT_PLAN_FORM]]";
  const si = text.indexOf(start);
  const ei = text.indexOf(end);
  if (si === -1 || ei === -1) return { cleaned: text, hasForm: false };
  const cleaned = (text.slice(0, si) + text.slice(ei + end.length)).trim();
  return { cleaned, hasForm: true };
}
