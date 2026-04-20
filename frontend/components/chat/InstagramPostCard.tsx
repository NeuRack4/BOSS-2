"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Heart,
  MessageCircle,
  Send,
  Bookmark,
  MoreHorizontal,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

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
  // 인스타 캡션에 제목/코드블록/표는 없으므로 그냥 텍스트로
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

export const InstagramPostCard = ({
  payload,
}: {
  payload: InstagramPayload;
}) => {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);

  const caption = payload.caption || "";
  const hashtags = payload.hashtags || [];
  const isLongCaption = caption.length > 90;
  const displayCaption =
    captionExpanded || !isLongCaption ? caption : caption.slice(0, 90) + "…";

  return (
    <div className="w-[320px] overflow-hidden rounded-xl border border-[#ddd0b4] bg-white shadow-md">
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

      {/* Image */}
      <div className="relative aspect-square w-full bg-[#f0ece4]">
        {payload.image_url ? (
          <Image
            src={payload.image_url}
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

      {/* Caption */}
      <div className="px-3 pb-1">
        {caption && (
          <div className="text-[12.5px] leading-relaxed text-[#1a1a1a]">
            <span className="mr-1.5 font-semibold">내 계정</span>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={IG_COMPONENTS}
            >
              {displayCaption}
            </ReactMarkdown>
            {isLongCaption && !captionExpanded && (
              <button
                type="button"
                onClick={() => setCaptionExpanded(true)}
                className="ml-1 text-[#8c8c8c]"
              >
                더 보기
              </button>
            )}
          </div>
        )}

        {/* Hashtags */}
        {hashtags.length > 0 && (
          <p className="mt-1 text-[12px] leading-relaxed text-[#3b7aba]">
            {hashtags
              .slice(0, 20)
              .map((t) => `#${t}`)
              .join(" ")}
          </p>
        )}
      </div>

      {/* Best time */}
      {payload.best_time && (
        <div className="border-t border-[#f0ece4] px-3 py-2 text-[11px] text-[#8c7e66]">
          {payload.best_time}
        </div>
      )}
    </div>
  );
};
