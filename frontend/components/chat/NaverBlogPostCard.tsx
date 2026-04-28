"use client";

import { useState } from "react";
import Image from "next/image";
import {
  ThumbsUp,
  MessageSquare,
  Share2,
  Bookmark,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type NaverBlogPayload = {
  title: string;
  content: string;
  tags: string[];
  image_urls: string[];
};

const _MARKER_RE = /\[\[NAVER_BLOG_POST\]\]([\s\S]*?)\[\[\/NAVER_BLOG_POST\]\]/;

export const extractNaverBlogPayload = (
  text: string,
): { cleaned: string; payload: NaverBlogPayload | null } => {
  const m = text.match(_MARKER_RE);
  if (!m) return { cleaned: text, payload: null };
  let payload: NaverBlogPayload | null = null;
  try {
    payload = JSON.parse(m[1]) as NaverBlogPayload;
  } catch {
    payload = null;
  }
  return { cleaned: text.replace(_MARKER_RE, "").trimEnd(), payload };
};

/** 마크다운 본문을 섹션별로 렌더링 */
function BlogBody({
  content,
  expanded,
}: {
  content: string;
  expanded: boolean;
}) {
  const lines = content.split("\n");
  const visible = expanded ? lines : lines.slice(0, 10);

  return (
    <div className="space-y-1.5 text-[13.5px] leading-[1.85] text-[#333]">
      {visible.map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-2" />;
        if (t.startsWith("### "))
          return (
            <p key={i} className="mt-2 font-bold text-[14px] text-[#1a1a1a]">
              {t.slice(4)}
            </p>
          );
        if (t.startsWith("## "))
          return (
            <p key={i} className="mt-2 font-bold text-[15px] text-[#1a1a1a]">
              {t.slice(3)}
            </p>
          );
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
}

export const NaverBlogPostCard = ({
  payload,
  accountId,
}: {
  payload: NaverBlogPayload;
  accountId?: string;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    post_url?: string;
    error?: string;
  } | null>(null);

  const handleUpload = async () => {
    if (!accountId) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/marketing/blog/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          title: payload.title,
          content: payload.content,
          tags: payload.tags,
          image_urls: payload.image_urls ?? [],
        }),
      });
      const json = await res.json();
      setUploadResult(json);
    } catch {
      setUploadResult({ success: false, error: "네트워크 오류가 발생했어요." });
    } finally {
      setUploading(false);
    }
  };

  const isCookieError = uploadResult?.error?.includes("쿠키") ?? false;

  const images = payload.image_urls ?? [];
  const hasImages = images.length > 0;
  const isLong = payload.content.split("\n").length > 10;
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="w-[420px] overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-lg">
      {/* ── 상단 네이버 블로그 헤더 바 ── */}
      <div className="flex items-center gap-2.5 bg-[#03C75A] px-4 py-2.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M13.5 12.5L10 7H7v10h3.5V11.5L15 17h3V7h-3.5v5.5z"
            fill="white"
          />
        </svg>
        <span className="text-[12px] font-bold tracking-widest text-white">
          NAVER Blog
        </span>
        <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white">
          AI 미리보기
        </span>
      </div>

      {/* ── 블로거 프로필 행 ── */}
      <div className="flex items-center gap-3 border-b border-[#f0f0f0] px-5 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#03C75A] text-[13px] font-bold text-white shadow-sm">
          내
        </div>
        <div>
          <p className="text-[13px] font-semibold text-[#222]">내 블로그</p>
          <p className="text-[11px] text-[#aaa]">{today}</p>
        </div>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-[#aaa]">
          <Eye className="h-3.5 w-3.5" />
          <span>1</span>
        </div>
      </div>

      {/* ── 대표 이미지 슬라이더 ── */}
      {hasImages && (
        <div className="relative aspect-video w-full bg-[#f5f5f5]">
          <Image
            src={images[imgIdx]}
            alt="블로그 이미지"
            fill
            className="object-cover"
            unoptimized
          />
          {images.length > 1 && (
            <>
              {imgIdx > 0 && (
                <button
                  type="button"
                  onClick={() => setImgIdx((i) => i - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 hover:bg-black/60"
                >
                  <ChevronLeft className="h-4 w-4 text-white" />
                </button>
              )}
              {imgIdx < images.length - 1 && (
                <button
                  type="button"
                  onClick={() => setImgIdx((i) => i + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 hover:bg-black/60"
                >
                  <ChevronRight className="h-4 w-4 text-white" />
                </button>
              )}
              <div className="absolute bottom-2.5 right-3 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
                {imgIdx + 1} / {images.length}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 제목 + 본문 ── */}
      <div className="px-5 py-4">
        {payload.title && (
          <h2 className="mb-3 text-[17px] font-bold leading-snug text-[#111]">
            {payload.title}
          </h2>
        )}

        <BlogBody content={payload.content} expanded={expanded} />

        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 flex items-center gap-1 text-[12.5px] font-medium text-[#03C75A] hover:underline"
          >
            {expanded ? "▲ 접기" : "▼ 더 보기"}
          </button>
        )}
      </div>

      {/* ── 태그 ── */}
      {payload.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-[#f0f0f0] px-5 py-3">
          {payload.tags.slice(0, 15).map((tag) => (
            <span
              key={tag}
              className="cursor-pointer rounded-full bg-[#f0fff6] px-2.5 py-0.5 text-[11.5px] text-[#03C75A] hover:bg-[#d6f5e6] transition-colors"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* ── 공감 / 댓글 / 공유 / 저장 ── */}
      <div className="flex items-center border-t border-[#f0f0f0] px-5 py-2.5">
        <div className="flex flex-1 items-center gap-4">
          <button
            type="button"
            onClick={() => setLiked((v) => !v)}
            className="flex items-center gap-1.5 text-[12.5px] transition-colors"
          >
            <ThumbsUp
              className="h-4 w-4"
              fill={liked ? "#03C75A" : "none"}
              stroke={liked ? "#03C75A" : "#aaa"}
              strokeWidth={1.8}
            />
            <span
              className={liked ? "text-[#03C75A] font-medium" : "text-[#aaa]"}
            >
              공감 {liked ? 1 : 0}
            </span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[12.5px] text-[#aaa]"
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
            <span>댓글 0</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[12.5px] text-[#aaa]"
          >
            <Share2 className="h-4 w-4" strokeWidth={1.8} />
            <span>공유</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setSaved((v) => !v)}
          className="flex items-center gap-1 text-[12px] text-[#aaa]"
        >
          <Bookmark
            className="h-4 w-4"
            fill={saved ? "#03C75A" : "none"}
            stroke={saved ? "#03C75A" : "#aaa"}
            strokeWidth={1.8}
          />
        </button>
      </div>

      {/* ── 게시 버튼 ── */}
      <div className="border-t border-[#f0f0f0] px-5 py-3 space-y-2">
        {uploadResult?.success ? (
          <div className="flex flex-col items-center gap-1.5 py-1">
            <div className="flex items-center gap-1.5 text-[#03C75A]">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-[13px] font-semibold">게시 완료!</span>
            </div>
            {uploadResult.post_url && (
              <a
                href={uploadResult.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[12px] text-[#03C75A] underline hover:text-[#02a84a]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                게시된 포스트 보기
              </a>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !accountId}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#03C75A] py-2.5 text-[13.5px] font-bold text-white shadow-sm hover:bg-[#02a84a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  게시 중...
                </>
              ) : (
                <>
                  <ExternalLink className="h-4 w-4" />
                  네이버 블로그에 게시하기
                </>
              )}
            </button>
            {uploadResult?.error && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-center text-[11.5px] text-red-500">
                  {uploadResult.error}
                </p>
                {isCookieError && (
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("boss:open-integrations-modal", {
                          detail: { tab: "naver" },
                        }),
                      )
                    }
                    className="text-[12px] font-medium text-[#03C75A] underline hover:text-[#02a84a]"
                  >
                    플랫폼 연결 설정 열기 →
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
