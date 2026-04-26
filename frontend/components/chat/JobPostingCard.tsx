"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";

export type JobPostingsPayload = {
  karrot: string;
  albamon: string;
  saramin: string;
};

const _JP_RE = /\[\[JOB_POSTINGS_JSON\]\]([\s\S]*?)\[\[\/JOB_POSTINGS_JSON\]\]/;

export const extractJobPostingsPayload = (
  text: string,
): { cleaned: string; payload: JobPostingsPayload | null } => {
  const m = text.match(_JP_RE);
  if (!m) return { cleaned: text, payload: null };
  let payload: JobPostingsPayload | null = null;
  try {
    payload = JSON.parse(m[1]) as JobPostingsPayload;
  } catch {
    payload = null;
  }
  const cleaned = text.replace(_JP_RE, "").trim();
  return { cleaned, payload };
};

type Platform = "karrot" | "albamon" | "saramin";

const PLATFORMS: Array<{
  key: Platform;
  label: string;
  color: string;
  activeClass: string;
}> = [
  {
    key: "karrot",
    label: "당근알바",
    color: "#FF6F3C",
    activeClass: "bg-orange-500 text-white border-orange-500",
  },
  {
    key: "albamon",
    label: "알바천국",
    color: "#1B7FF6",
    activeClass: "bg-blue-500 text-white border-blue-500",
  },
  {
    key: "saramin",
    label: "사람인",
    color: "#0050D9",
    activeClass: "bg-blue-700 text-white border-blue-700",
  },
];

const MD_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="mb-2 leading-relaxed last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <p className="mb-1 font-bold text-sm">{children}</p>,
  h2: ({ children }) => <p className="mb-1 font-bold text-sm">{children}</p>,
  h3: ({ children }) => (
    <p className="mb-1 font-semibold text-sm">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 list-disc pl-4 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal pl-4 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-2 border-border" />,
};

export const JobPostingCard = ({
  payload,
}: {
  payload: JobPostingsPayload;
}) => {
  const [active, setActive] = useState<Platform>("karrot");

  const currentContent = payload[active];

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden w-full">
      {/* 플랫폼 탭 */}
      <div className="flex border-b border-border bg-muted/30">
        {PLATFORMS.map((p) => (
          <button
            key={p.key}
            onClick={() => setActive(p.key)}
            className={cn(
              "flex-1 py-2 px-3 text-xs font-medium border-b-2 transition-colors",
              active === p.key
                ? "border-current text-current"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            style={
              active === p.key
                ? { color: p.color, borderColor: p.color }
                : undefined
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 공고 내용 */}
      <div className="p-4 text-xs text-foreground leading-relaxed min-h-[120px]">
        {currentContent ? (
          <ReactMarkdown
            remarkPlugins={[[remarkGfm, { singleTilde: false }], remarkBreaks]}
            components={MD_COMPONENTS}
          >
            {currentContent}
          </ReactMarkdown>
        ) : (
          <p className="text-muted-foreground italic">내용 없음</p>
        )}
      </div>
    </div>
  );
};
