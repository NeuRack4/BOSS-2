"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Video,
  Upload,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Link,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type ShortsWizardPayload = {
  topic: string;
  slide_count: number;
  duration: number;
};

const _SHORTS_RE = /\[\[SHORTS_WIZARD\]\]([\s\S]*?)\[\[\/SHORTS_WIZARD\]\]/;

export const extractShortsWizardPayload = (
  text: string,
): { cleaned: string; payload: ShortsWizardPayload | null } => {
  const m = text.match(_SHORTS_RE);
  if (!m) return { cleaned: text, payload: null };
  try {
    return {
      cleaned: text.replace(_SHORTS_RE, "").trimEnd(),
      payload: JSON.parse(m[1]),
    };
  } catch {
    return { cleaned: text.replace(_SHORTS_RE, "").trimEnd(), payload: null };
  }
};

type Step = "upload" | "subtitles" | "settings" | "generate";
type GenState = "idle" | "generating" | "uploading" | "done" | "error";

type SlideItem = {
  file: File;
  preview: string;
  subtitle: string;
};

const STEP_LABELS: Record<Step, string> = {
  upload: "① 사진 업로드",
  subtitles: "② 자막 편집",
  settings: "③ 설정",
  generate: "④ 게시",
};
const STEPS: Step[] = ["upload", "subtitles", "settings", "generate"];

export const ShortsWizardCard = ({
  payload,
}: {
  payload: ShortsWizardPayload;
}) => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL;
  const [step, setStep] = useState<Step>("upload");
  const [unlockedSteps, setUnlockedSteps] = useState<Set<Step>>(
    new Set(["upload"]),
  );
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // settings
  const [title, setTitle] = useState(payload.topic);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [duration, setDuration] = useState(payload.duration ?? 3);
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">(
    "private",
  );

  // youtube 연결 상태
  const [ytConnected, setYtConnected] = useState<boolean | null>(null);

  // generate
  const [genState, setGenState] = useState<GenState>("idle");
  const [youtubeUrl, setVideoUrl] = useState("");
  const [storageUrl, setStorageUrl] = useState("");
  const [genError, setGenError] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  const getAccountId = async () => {
    const sb = createClient();
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? "";
  };

  // YouTube 연결 상태 확인
  const checkYtStatus = useCallback(async () => {
    const accountId = await getAccountId();
    const res = await fetch(
      `${apiBase}/api/marketing/youtube/oauth/status?account_id=${accountId}`,
    );
    const json = await res.json();
    setYtConnected(json.connected ?? false);
  }, [apiBase]);

  useEffect(() => {
    checkYtStatus();
  }, [checkYtStatus]);

  // 스텝 이동 (unlock 포함)
  const goToStep = (s: Step) => {
    setStep(s);
    setUnlockedSteps((prev) => new Set([...prev, s]));
  };

  // 파일 선택
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const newSlides: SlideItem[] = files.map((f) => ({
      file: f,
      preview: URL.createObjectURL(f),
      subtitle: "",
    }));
    setSlides((prev) => [...prev, ...newSlides].slice(0, 10));
    if (fileRef.current) fileRef.current.value = "";
  };

  const removeSlide = (i: number) => {
    setSlides((prev) => prev.filter((_, idx) => idx !== i));
  };

  // 드래그 앤 드롭
  const handleDragStart = (i: number) => setDragIndex(i);
  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    setDragOverIndex(i);
  };
  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setSlides((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(null);
    setDragOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // 자막 AI 생성
  const handleGenerateSubtitles = async () => {
    if (slides.length < 2) return;
    setLoadingSubtitles(true);
    try {
      const accountId = await getAccountId();
      const form = new FormData();
      form.append("account_id", accountId);
      form.append("context", payload.topic);
      slides.forEach((s) => form.append("images", s.file));
      const res = await fetch(
        `${apiBase}/api/marketing/youtube/shorts/preview-subtitles`,
        {
          method: "POST",
          body: form,
        },
      );
      const json = await res.json();
      const subs: string[] = json.data?.subtitles ?? [];
      setSlides((prev) =>
        prev.map((s, i) => ({ ...s, subtitle: subs[i] ?? s.subtitle })),
      );
      goToStep("subtitles");
    } catch (err) {
      alert(err instanceof Error ? err.message : "자막 생성 실패");
    } finally {
      setLoadingSubtitles(false);
    }
  };

  // YouTube OAuth 팝업
  const handleConnectVideo = async () => {
    const accountId = await getAccountId();
    const res = await fetch(
      `${apiBase}/api/marketing/youtube/oauth/start?account_id=${accountId}`,
    );
    const { url } = await res.json();
    const popup = window.open(
      url,
      "youtube_oauth",
      "popup=true,width=600,height=700",
    );
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "youtube_connected") {
        window.removeEventListener("message", onMsg);
        popup?.close();
        if (e.data.success) {
          setYtConnected(true);
        } else {
          alert(`연결 실패: ${e.data.error ?? "알 수 없는 오류"}`);
        }
      }
    };
    window.addEventListener("message", onMsg);
  };

  // 영상 생성 + 업로드
  const handleGenerate = async () => {
    if (!ytConnected) {
      alert("먼저 YouTube를 연결해주세요.");
      return;
    }
    setGenState("generating");
    setGenError("");
    try {
      const accountId = await getAccountId();
      const form = new FormData();
      form.append("account_id", accountId);
      form.append("title", title);
      form.append("description", description);
      form.append(
        "tags",
        JSON.stringify(
          tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      );
      form.append("subtitles", JSON.stringify(slides.map((s) => s.subtitle)));
      form.append("duration_per_slide", String(duration));
      form.append("privacy_status", privacy);
      slides.forEach((s) => form.append("images", s.file));

      setGenState("uploading");
      const res = await fetch(
        `${apiBase}/api/marketing/youtube/shorts/generate`,
        {
          method: "POST",
          body: form,
        },
      );
      const json = await res.json();
      if (!json.success && !json.storage_url)
        throw new Error(json.error || "생성 실패");
      setVideoUrl(json.youtube_url ?? "");
      setStorageUrl(json.storage_url ?? "");
      setGenError(json.error ?? "");
      setGenState("done");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "오류 발생");
      setGenState("error");
    }
  };

  return (
    <div className="w-[340px] overflow-hidden rounded-xl border border-[#ddd0b4] bg-white shadow-md">
      {/* Header */}
      <div className="flex items-center gap-2 bg-[#ff0000] px-4 py-3">
        <Video className="h-5 w-5 text-white" />
        <span className="text-[13px] font-semibold text-white">
          YouTube Shorts 제작
        </span>
      </div>

      {/* Step indicator */}
      <div className="flex border-b border-[#f0ece4] bg-[#fbf6eb]">
        {STEPS.map((s) => {
          const unlocked = unlockedSteps.has(s);
          return (
            <button
              key={s}
              type="button"
              disabled={!unlocked}
              onClick={() => unlocked && goToStep(s)}
              className={`flex-1 py-1.5 text-center text-[10px] font-medium transition-colors ${
                step === s
                  ? "border-b-2 border-[#ff0000] text-[#ff0000]"
                  : unlocked
                    ? "cursor-pointer text-[#5a5040] hover:text-[#ff0000]"
                    : "cursor-not-allowed text-[#c4b89a]"
              }`}
            >
              {STEP_LABELS[s]}
            </button>
          );
        })}
      </div>

      <div className="p-4">
        {/* ── Step 1: 사진 업로드 ── */}
        {step === "upload" && (
          <div className="space-y-3">
            <p className="text-[12px] text-[#5a5040]">
              슬라이드로 사용할 사진을 <strong>2~10장</strong> 업로드하세요.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            {slides.length === 0 ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[#ddd0b4] py-8 text-[#8c7e66] transition-colors hover:border-[#ff0000]/50 hover:bg-[#fff5f5]"
              >
                <Upload className="h-7 w-7 opacity-50" />
                <span className="text-[12px]">
                  사진을 업로드하세요 (최대 10장)
                </span>
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {slides.map((s, i) => (
                  <div
                    key={i}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => handleDragOver(e, i)}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    className={`relative cursor-grab transition-opacity active:cursor-grabbing ${
                      dragIndex === i ? "opacity-40" : "opacity-100"
                    } ${
                      dragOverIndex === i && dragIndex !== i
                        ? "rounded-lg ring-2 ring-[#ff0000] ring-offset-1"
                        : ""
                    }`}
                  >
                    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-[#f0ece4]">
                      <Image
                        src={s.preview}
                        alt={`slide-${i}`}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSlide(i)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] text-white hover:bg-black/80"
                    >
                      ✕
                    </button>
                    <div className="mt-0.5 text-center text-[10px] text-[#8c7e66]">
                      {i + 1}
                    </div>
                  </div>
                ))}
                {slides.length < 10 && (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border-2 border-dashed border-[#ddd0b4] text-2xl text-[#8c7e66] transition-colors hover:border-[#ff0000]/50 hover:bg-[#fff5f5]"
                  >
                    +
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleGenerateSubtitles}
              disabled={slides.length < 2 || loadingSubtitles}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#ff0000] py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {loadingSubtitles ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  자막 생성 중...
                </>
              ) : (
                <>
                  AI 자막 생성 <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        )}

        {/* ── Step 2: 자막 편집 ── */}
        {step === "subtitles" && (
          <div className="space-y-3">
            <p className="text-[12px] text-[#5a5040]">
              각 사진의 자막을 확인하고 수정하세요.
            </p>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {slides.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="relative h-12 w-8 shrink-0 overflow-hidden rounded bg-[#f0ece4]">
                    <Image
                      src={s.preview}
                      alt={`s${i}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <input
                    type="text"
                    value={s.subtitle}
                    maxLength={25}
                    onChange={(e) =>
                      setSlides((prev) =>
                        prev.map((sl, idx) =>
                          idx === i ? { ...sl, subtitle: e.target.value } : sl,
                        )
                      )
                    }
                    className="flex-1 rounded-lg border border-[#ddd0b4] px-2 py-1.5 text-[12px] outline-none focus:border-[#ff0000]"
                    placeholder="자막 없음"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToStep("upload")}
                className="flex items-center gap-1 rounded-lg border border-[#ddd0b4] px-3 py-2 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> 이전
              </button>
              <button
                type="button"
                onClick={() => goToStep("settings")}
                className="ml-auto flex items-center gap-1 rounded-lg bg-[#ff0000] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90"
              >
                다음 <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: 설정 ── */}
        {step === "settings" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#5a5040]">
                제목
              </label>
              <input
                type="text"
                value={title}
                maxLength={100}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-[#ddd0b4] px-3 py-2 text-[12px] outline-none focus:border-[#ff0000]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#5a5040]">
                설명 (선택)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-[#ddd0b4] px-3 py-2 text-[12px] outline-none focus:border-[#ff0000]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#5a5040]">
                태그 (쉼표 구분)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="소상공인, 맛집, 신메뉴"
                className="w-full rounded-lg border border-[#ddd0b4] px-3 py-2 text-[12px] outline-none focus:border-[#ff0000]"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-medium text-[#5a5040]">
                  슬라이드당 초
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full rounded-lg border border-[#ddd0b4] px-2 py-2 text-[12px] outline-none"
                >
                  {[2, 3, 4, 5].map((v) => (
                    <option key={v} value={v}>
                      {v}초
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-medium text-[#5a5040]">
                  공개 범위
                </label>
                <select
                  value={privacy}
                  onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
                  className="w-full rounded-lg border border-[#ddd0b4] px-2 py-2 text-[12px] outline-none"
                >
                  <option value="private">비공개</option>
                  <option value="unlisted">미등록</option>
                  <option value="public">공개</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => goToStep("subtitles")}
                className="flex items-center gap-1 rounded-lg border border-[#ddd0b4] px-3 py-2 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> 이전
              </button>
              <button
                type="button"
                onClick={() => goToStep("generate")}
                className="ml-auto flex items-center gap-1 rounded-lg bg-[#ff0000] px-4 py-2 text-[12px] font-semibold text-white hover:opacity-90"
              >
                다음 <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: 게시 ── */}
        {step === "generate" && (
          <div className="space-y-3">
            {/* YouTube 연결 상태 */}
            <div
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-[12px] ${ytConnected ? "bg-[#f0fff4] text-[#276749]" : "bg-[#fff5f5] text-[#8a3a28]"}`}
            >
              <span>
                {ytConnected ? "✅ YouTube 연결됨" : "❌ YouTube 미연결"}
              </span>
              {!ytConnected && (
                <button
                  type="button"
                  onClick={handleConnectVideo}
                  className="rounded-md bg-[#ff0000] px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                >
                  연결하기
                </button>
              )}
            </div>

            {/* 요약 */}
            <div className="space-y-1 rounded-lg border border-[#f0ece4] p-3 text-[12px] text-[#5a5040]">
              <div>
                <strong>제목:</strong> {title}
              </div>
              <div>
                <strong>슬라이드:</strong> {slides.length}장 × {duration}초
              </div>
              <div>
                <strong>공개 범위:</strong>{" "}
                {privacy === "private"
                  ? "비공개"
                  : privacy === "unlisted"
                    ? "미등록"
                    : "공개"}
              </div>
            </div>

            {genState === "done" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[12px] text-[#276749]">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>완료!</span>
                </div>
                {youtubeUrl && (
                  <a
                    href={youtubeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg bg-[#ff0000] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90"
                  >
                    <Link className="h-3.5 w-3.5" /> YouTube에서 보기
                  </a>
                )}
                {storageUrl && !youtubeUrl && (
                  <a
                    href={storageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-[#ddd0b4] px-3 py-2 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
                  >
                    <Link className="h-3.5 w-3.5" /> 영상 다운로드
                  </a>
                )}
                {genError && (
                  <p className="text-[11px] text-[#8a3a28]">{genError}</p>
                )}
              </div>
            ) : genState === "error" ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[12px] text-[#8a3a28]">
                  <XCircle className="h-4 w-4" />
                  <span className="truncate">{genError}</span>
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="w-full rounded-lg border border-[#ddd0b4] py-2 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
                >
                  다시 시도
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {(genState === "generating" || genState === "uploading") && (
                  <div className="flex items-center gap-2 text-[12px] text-[#5a5040]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {genState === "generating"
                      ? "영상 생성 중..."
                      : "YouTube 업로드 중..."}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => goToStep("settings")}
                    disabled={genState !== "idle"}
                    className="flex items-center gap-1 rounded-lg border border-[#ddd0b4] px-3 py-2 text-[12px] text-[#5a5040] hover:bg-[#f0ece4] disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> 이전
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!ytConnected || genState !== "idle"}
                    className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#ff0000] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <Video className="h-4 w-4" />
                    Shorts 게시
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
