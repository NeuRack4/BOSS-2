"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** assistant 답변의 마크다운을 Sand/Paper 테마에 맞춰 렌더. */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold text-[#2e2719]">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="mb-1 mt-2 text-[13px] font-semibold text-[#2e2719]">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="mb-0.5 mt-1.5 text-[13px] font-semibold text-[#2e2719]">
      {children}
    </h5>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#2e2719]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-[#5a5040]">{children}</em>,
  code: ({ children, ...props }) => {
    // ReactMarkdown 은 inline 여부를 className 으로 구분 (code vs code.language-*)
    const isInline = !("className" in props);
    if (isInline) {
      return (
        <code className="rounded bg-[#ebe0ca] px-1 py-0.5 font-mono text-[12px] text-[#2e2719]">
          {children}
        </code>
      );
    }
    return (
      <code className="block overflow-x-auto rounded bg-[#f2e9d5] p-2 font-mono text-[12px] text-[#2e2719]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2">{children}</pre>,
  ul: ({ children }) => (
    <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-2 border-[#ddd0b4]" />,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-[#bfae8a] pl-2 text-[#5a5040]">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[#6a7843] underline underline-offset-2 hover:text-[#4f6b34]"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[#ddd0b4] bg-[#ebe0ca] px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[#ddd0b4] px-2 py-1">{children}</td>
  ),
};

export const MarkdownMessage = ({
  content,
  className,
}: {
  content: string;
  className?: string;
}) => (
  <div className={cn("text-sm leading-relaxed text-[#2e2719]", className)}>
    <ReactMarkdown
      remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
      components={COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  </div>
);
