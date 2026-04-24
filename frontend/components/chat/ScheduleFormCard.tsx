"use client";

import { useState } from "react";

const TASK_TYPES = [
  { label: "인스타그램 게시물", value: "인스타그램 게시물 (캡션 + 해시태그)" },
  { label: "네이버 블로그", value: "네이버 블로그 포스팅" },
  { label: "광고 카피", value: "광고 카피 작성" },
  { label: "유튜브 Shorts", value: "유튜브 Shorts 스크립트 작성" },
];

const FREQUENCIES = [
  { label: "매일", value: "daily" },
  { label: "매주", value: "weekly" },
  { label: "격주", value: "biweekly" },
  { label: "매월", value: "monthly" },
];

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_CRON = ["1", "2", "3", "4", "5", "6", "0"];

const MONTHLY_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function buildCron(
  frequency: string,
  weekday: string,
  monthDay: string,
  hour: string,
  minute: string,
): string {
  const h = hour || "9";
  const m = minute || "0";
  if (frequency === "daily") return `${m} ${h} * * *`;
  if (frequency === "weekly") return `${m} ${h} * * ${weekday || "1"}`;
  if (frequency === "biweekly") return `${m} ${h} * * ${weekday || "1"}/2`;
  if (frequency === "monthly") return `${m} ${h} ${monthDay || "1"} * *`;
  return `${m} ${h} * * 1`;
}

function describeCron(
  frequency: string,
  weekday: string,
  monthDay: string,
  hour: string,
  minute: string,
): string {
  const h = (hour || "9").padStart(2, "0");
  const m = (minute || "0").padStart(2, "0");
  const dayIdx = WEEKDAY_CRON.indexOf(weekday || "1");
  const dayLabel = dayIdx >= 0 ? WEEKDAYS[dayIdx] : "월";
  if (frequency === "daily") return `매일 ${h}:${m}`;
  if (frequency === "weekly") return `매주 ${dayLabel}요일 ${h}:${m}`;
  if (frequency === "biweekly") return `격주 ${dayLabel}요일 ${h}:${m}`;
  if (frequency === "monthly") return `매월 ${monthDay || "1"}일 ${h}:${m}`;
  return `매주 ${dayLabel}요일 ${h}:${m}`;
}

export function ScheduleFormCard({
  onSubmit,
}: {
  onSubmit: (message: string) => void;
}) {
  const [taskType, setTaskType] = useState("");
  const [customTask, setCustomTask] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [weekday, setWeekday] = useState("1"); // 월요일
  const [monthDay, setMonthDay] = useState("1");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const taskLabel = taskType === "직접 입력" ? customTask.trim() : taskType;
  const canSubmit = taskLabel.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;

    const cron = buildCron(frequency, weekday, monthDay, hour, minute);
    const schedule = describeCron(frequency, weekday, monthDay, hour, minute);
    const taskFull = taskLabel + (details.trim() ? ` (${details.trim()})` : "");

    const message = [
      `자동화 스케줄 설정해줘.`,
      `- 작업: ${taskFull}`,
      `- 실행 주기: ${schedule}`,
      `- cron: ${cron}`,
    ].join("\n");

    setSubmitted(true);
    onSubmit(message);
  };

  if (submitted) {
    return (
      <div className="rounded-[5px] border border-neutral-200 bg-white p-4 w-full max-w-[480px]">
        <p className="text-[13px] text-neutral-500">
          스케줄 정보를 전달했어요. 잠시 기다려주세요...
        </p>
      </div>
    );
  }

  const inputCls =
    "w-full rounded-[4px] border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 transition-colors";
  const labelCls = "block text-[11px] font-medium text-neutral-500 mb-1";
  const chipBase =
    "text-[12px] px-3 py-1 rounded-full border transition-colors cursor-pointer";
  const chipOn = "bg-neutral-800 text-white border-neutral-800";
  const chipOff =
    "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400";

  const showWeekday =
    frequency === "weekly" || frequency === "biweekly";
  const showMonthDay = frequency === "monthly";

  return (
    <div className="rounded-[5px] border border-neutral-200 bg-white overflow-hidden w-full max-w-[480px] shadow-sm">
      {/* 헤더 */}
      <div className="px-4 py-3 bg-neutral-50 border-b border-neutral-200">
        <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          자동화 스케줄 설정
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* 작업 종류 */}
        <div>
          <label className={labelCls}>
            자동 실행할 작업 <span className="text-red-400">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {TASK_TYPES.map((t) => (
              <button
                key={t.label}
                onClick={() => setTaskType(t.value)}
                className={`${chipBase} ${taskType === t.value ? chipOn : chipOff}`}
              >
                {t.label}
              </button>
            ))}
            <button
              onClick={() => setTaskType("직접 입력")}
              className={`${chipBase} ${taskType === "직접 입력" ? chipOn : chipOff}`}
            >
              직접 입력
            </button>
          </div>
          {taskType === "직접 입력" && (
            <input
              type="text"
              className={`${inputCls} mt-2`}
              placeholder="예) 네이버 플레이스 리뷰 답글 작성"
              value={customTask}
              onChange={(e) => setCustomTask(e.target.value)}
            />
          )}
        </div>

        {/* 세부 지시사항 */}
        {taskType && taskType !== "직접 입력" && (
          <div>
            <label className={labelCls}>세부 지시사항 (선택)</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={2}
              placeholder="예) 오늘의 신메뉴 소개 위주로, 감성적인 톤으로 작성"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
        )}

        {/* 실행 주기 */}
        <div>
          <label className={labelCls}>실행 주기</label>
          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                onClick={() => setFrequency(f.value)}
                className={`${chipBase} ${frequency === f.value ? chipOn : chipOff}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 요일 선택 (매주/격주) */}
        {showWeekday && (
          <div>
            <label className={labelCls}>요일</label>
            <div className="flex gap-1.5">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setWeekday(WEEKDAY_CRON[i])}
                  className={`w-9 h-9 rounded-full text-[12px] border transition-colors ${
                    weekday === WEEKDAY_CRON[i] ? chipOn : chipOff
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 날짜 선택 (매월) */}
        {showMonthDay && (
          <div>
            <label className={labelCls}>매월 몇 일</label>
            <select
              className={inputCls}
              value={monthDay}
              onChange={(e) => setMonthDay(e.target.value)}
            >
              {MONTHLY_DAYS.map((d) => (
                <option key={d} value={String(d)}>
                  {d}일
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 실행 시간 */}
        <div>
          <label className={labelCls}>실행 시간 (UTC 기준)</label>
          <div className="flex items-center gap-2">
            <select
              className={`${inputCls} w-24`}
              value={hour}
              onChange={(e) => setHour(e.target.value)}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={String(i)}>
                  {String(i).padStart(2, "0")}시
                </option>
              ))}
            </select>
            <span className="text-[13px] text-neutral-500">:</span>
            <select
              className={`${inputCls} w-24`}
              value={minute}
              onChange={(e) => setMinute(e.target.value)}
            >
              {["0", "15", "30", "45"].map((m) => (
                <option key={m} value={m}>
                  {m.padStart(2, "0")}분
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            한국 시간(KST)은 UTC+9 — 예) KST 오전 9시 = UTC 00시
          </p>
        </div>

        {/* 미리보기 */}
        {taskLabel && (
          <div className="rounded-[4px] bg-neutral-50 border border-neutral-100 px-3 py-2.5">
            <p className="text-[11px] text-neutral-400 mb-0.5">설정 미리보기</p>
            <p className="text-[13px] text-neutral-700 font-medium">
              {describeCron(frequency, weekday, monthDay, hour, minute)}마다{" "}
              <span className="text-neutral-900">{taskLabel}</span> 자동 실행
            </p>
          </div>
        )}

        {/* 제출 */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-2 rounded-[4px] bg-neutral-800 text-white text-[13px] font-medium hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          스케줄 등록
        </button>
      </div>
    </div>
  );
}

export function extractScheduleForm(text: string): {
  cleaned: string;
  hasForm: boolean;
} {
  const start = "[[SCHEDULE_FORM]]";
  const end = "[[/SCHEDULE_FORM]]";
  const si = text.indexOf(start);
  const ei = text.indexOf(end);
  if (si === -1 || ei === -1) return { cleaned: text, hasForm: false };
  const cleaned = (text.slice(0, si) + text.slice(ei + end.length)).trim();
  return { cleaned, hasForm: true };
}
