"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { createClient } from "@/lib/supabase/client";
import { PhotoLibraryModal } from "./PhotoLibraryModal";

export type InstagramPayload = {
  title: string;
  caption: string;
  hashtags: string[];
  best_time: string;
  image_url: string;
};

/** 인스타그램 피드 스타일 마크다운 컴포넌트 */
const IG_COMPONENTS: Components = {
  p: ({ children }) => (
    <span className="block leading-relaxed">{children}</span>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <span className="font-bold">{children}</span>,
  h2: ({ children }) => <span className="font-bold">{children}</span>,
  h3: ({ children }) => <span className="font-semibold">{children}</span>,
  ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
};

const _IG_POST_RE = /\[\[INSTAGRAM_POST\]\]([\s\S]*?)\[\[\/INSTAGRAM_POST\]\]/;

export const extractInstagramPayload = (
  text: string,
): { cleaned: string; payload: InstagramPayload | null } => {
  const m = text.match(_IG_POST_RE);
  if (!m) return { cleaned: text, payload: null };
  let payload: InstagramPayload | null = null;
  try {
    payload = JSON.parse(m[1]) as InstagramPayload;
  } catch {
    payload = null;
  }
  return { cleaned: text.replace(_IG_POST_RE, "").trimEnd(), payload };
};

type PublishState = "idle" | "uploading" | "done" | "error";

export const InstagramPostCard = ({
  payload,
}: {
  payload: InstagramPayload;
}) => {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [publishUrl, setPublishUrl] = useState("");
  const [publishError, setPublishError] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewUrls, setPreviewUrls] = useState<string[]>(
    payload.image_url ? [payload.image_url] : [],
  );

  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  const handlePublishWithImages = async (imageUrls: string[]) => {
    setShowLibrary(false);
    if (publishState === "uploading" || imageUrls.length === 0) return;
    setPreviewUrls(imageUrls);
    setPreviewIndex(0);
    setPublishState("uploading");
    setPublishError("");

    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const accountId = data.user?.id ?? "";

      const res = await fetch(`${apiBase}/api/marketing/instagram/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          image_urls: imageUrls,
          caption: payload.caption,
          hashtags: payload.hashtags,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "게시 실패");
      setPublishUrl(json.post_url);
      setPublishState("done");
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "게시 실패");
      setPublishState("error");
    }
  };

  const prepareCaption = (text: string): string => {
    // 문장 끝(! ? ~ .) 뒤 공백에 줄바꿈 삽입
    // 마침표는 숫자·영문 약어 오탐 방지를 위해 뒤에 한글/이모지가 올 때만 적용
    const withBreaks = text
      .replace(/([!?~！？])\s+(?=\S)/g, "$1\n")
      .replace(/([.])\s+(?=[가-힣\uD83C-􏰀-\uDFFF])/g, "$1\n")
      .trim();

    return withBreaks
      .split("\n")
      .reduce<string[]>((acc, line) => {
        const trimmed = line.trim();
        if (!trimmed) return acc;
        // 해시태그만 있는 줄 제거 (styled chips로 별도 표시)
        if (/^(#[\w가-힣A-Za-z0-9]+\s*)+$/.test(trimmed)) return acc;
        // 이모지만 있는 줄은 앞 줄에 붙임
        const isEmojiOnly = !/[\w가-힣a-zA-Z0-9]/.test(trimmed);
        if (isEmojiOnly && acc.length > 0) {
          acc[acc.length - 1] = acc[acc.length - 1].trimEnd() + " " + trimmed;
        } else {
          acc.push(trimmed);
        }
        return acc;
      }, [])
      .join("\n");
  };

  const caption = prepareCaption(payload.caption || "");
  const hashtags = payload.hashtags || [];

  const isCarousel = previewUrls.length > 1;
  const currentImage = previewUrls[previewIndex] ?? payload.image_url;

  return (
    <>
      {showLibrary && (
        <PhotoLibraryModal
          aiImageUrl={payload.image_url}
          onSelect={handlePublishWithImages}
          onClose={() => setShowLibrary(false)}
        />
      )}
      <div className="w-[300px] overflow-hidden rounded-xl border border-[#ddd0b4] bg-white shadow-md">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] text-xs font-bold text-white">
            내
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-[#1a1a1a]">
              내 계정
            </div>
            <div className="text-[10px] text-[#8c8c8c]">AI 미리보기</div>
          </div>
          <MoreHorizontal className="h-4 w-4 text-[#8c8c8c]" />
        </div>

        {/* Image (캐러셀 슬라이더) */}
        <div className="relative aspect-square w-full bg-[#f0ece4]">
          {currentImage ? (
            <Image
              src={currentImage}
              alt={payload.title || "SNS 포스트 이미지"}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-4xl opacity-30">🖼️</span>
            </div>
          )}

          {/* 캐러셀 좌우 버튼 */}
          {isCarousel && (
            <>
              {previewIndex > 0 && (
                <button
                  type="button"
                  onClick={() => setPreviewIndex((i) => i - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 hover:bg-black/60"
                >
                  <ChevronLeft className="h-4 w-4 text-white" />
                </button>
              )}
              {previewIndex < previewUrls.length - 1 && (
                <button
                  type="button"
                  onClick={() => setPreviewIndex((i) => i + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 hover:bg-black/60"
                >
                  <ChevronRight className="h-4 w-4 text-white" />
                </button>
              )}
              {/* 점 인디케이터 */}
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                {previewUrls.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setPreviewIndex(idx)}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === previewIndex
                        ? "w-4 bg-white"
                        : "w-1.5 bg-white/50"
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center px-3 py-2">
          <div className="flex flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => setLiked((v) => !v)}
              className="transition-transform active:scale-90"
              aria-label="좋아요"
            >
              <Heart
                className="h-6 w-6"
                fill={liked ? "#e74c3c" : "none"}
                stroke={liked ? "#e74c3c" : "#1a1a1a"}
                strokeWidth={1.8}
              />
            </button>
            <button type="button" aria-label="댓글">
              <MessageCircle
                className="h-6 w-6 text-[#1a1a1a]"
                strokeWidth={1.8}
              />
            </button>
            <button type="button" aria-label="공유">
              <Send className="h-6 w-6 text-[#1a1a1a]" strokeWidth={1.8} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSaved((v) => !v)}
            aria-label="저장"
          >
            <Bookmark
              className="h-6 w-6"
              fill={saved ? "#1a1a1a" : "none"}
              stroke="#1a1a1a"
              strokeWidth={1.8}
            />
          </button>
        </div>

        {/* Caption + Hashtags */}
        <div className="px-3 pb-2 pt-1">
          {caption && (
            <div className="text-[12.5px] leading-relaxed text-[#1a1a1a]">
              <span className="mr-1.5 font-semibold">내 계정</span>
              <span
                className={
                  captionExpanded
                    ? "block whitespace-pre-wrap"
                    : "line-clamp-2 block whitespace-pre-wrap"
                }
              >
                {caption}
              </span>
              <button
                type="button"
                onClick={() => setCaptionExpanded((v) => !v)}
                className="ml-1 text-[11px] text-[#8c8c8c] hover:text-[#555]"
              >
                {captionExpanded ? "접기" : "더 보기"}
              </button>
            </div>
          )}
          {hashtags.length > 0 && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-[#3b7aba]">
              {hashtags
                .slice(0, 20)
                .map((t) => `#${t}`)
                .join(" ")}
            </p>
          )}
          {payload.best_time && (
            <p className="mt-1 text-[11px] text-[#8c7e66]">
              {payload.best_time}
            </p>
          )}
        </div>

        {/* 피드에 게시 버튼 */}
        <div className="border-t border-[#f0ece4] px-3 py-2.5">
          {publishState === "done" ? (
            <div className="flex items-center gap-1.5 text-[12px] text-[#3b6a4a]">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                게시 완료{isCarousel ? ` (${previewUrls.length}장 캐러셀)` : ""}
                !
              </span>
              {publishUrl && (
                <a
                  href={publishUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-[#3b7aba] underline"
                >
                  보기
                </a>
              )}
            </div>
          ) : publishState === "error" ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12px] text-[#8a3a28]">
                <XCircle className="h-4 w-4 shrink-0" />
                <span className="truncate">{publishError}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowLibrary(true)}
                className="w-full rounded-lg border border-[#ddd0b4] py-1.5 text-[12px] text-[#5a5040] hover:bg-[#f0ece4]"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              disabled={publishState === "uploading"}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {publishState === "uploading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  게시 중...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  인스타그램에 게시
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </>
  );
};
