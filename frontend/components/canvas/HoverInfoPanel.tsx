"use client";

import { useEffect, useState } from "react";
import { Minus, Square } from "lucide-react";

type Domain = "recruitment" | "marketing" | "sales" | "documents";
type Kind = "anchor" | "domain" | "artifact" | "schedule" | "log";

type Relative = {
  id: string;
  title: string;
  kind: Kind;
  relation: string;
};

type HoverNode = {
  id: string;
  kind: Kind;
  type: string;
  title: string;
  content: string;
  status: string;
  domains: Domain[] | null;
  subDomain: { id: string; title: string } | null;
  metadata: Record<string, unknown>;
  created_at: string;
  parents: Relative[];
  children: Relative[];
};

type Props = {
  node: HoverNode | null;
};

const DOMAIN_HEX: Record<Domain, string> = {
  recruitment: "#c47865",
  marketing: "#d89a2b",
  sales: "#7f8f54",
  documents: "#8e5572",
};

const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return String(v);
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

const cleanTitle = (t: string): string =>
  (t || "").replace(/^\[MOCK\]\s*/, "").trim() || "(제목 없음)";

const extractFirstHeading = (content: string): string => {
  if (!content) return "";
  const lines = content.split("\n");
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) return m[1].trim();
  }
  const first = lines.find((l) => l.trim().length > 0);
  return first ? first.trim() : "";
};

const RELATION_COLOR: Record<string, string> = {
  contains: "text-[#8c7e66]",
  derives_from: "text-[#8c7e66]",
  scheduled_by: "text-[#8e5572]",
  revises: "text-[#d89a2b]",
  logged_from: "text-[#7f8f54]",
};

const renderRelatives = (label: string, list: Relative[]): React.ReactNode => (
  <div>
    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
      {label} ({list.length})
    </p>
    {list.length === 0 ? (
      <p className="mt-0.5 text-[11px] text-[#8c7e66]">—</p>
    ) : (
      <div className="mt-1 space-y-0.5 rounded border border-[#ddd0b4] bg-[#f2e9d5]/70 px-2 py-1.5">
        {list.map((r) => (
          <div
            key={`${r.relation}-${r.id}`}
            className="flex items-center gap-1.5 text-[11px]"
          >
            <span
              className={`shrink-0 font-mono text-[9px] uppercase tracking-wider ${
                RELATION_COLOR[r.relation] ?? "text-[#8c7e66]"
              }`}
            >
              {r.relation}
            </span>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-[#bfae8a]">
              {r.kind}
            </span>
            <span className="truncate text-[#2e2719]">
              {cleanTitle(r.title)}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
);

const formatDate = (iso: string): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const STORAGE_KEY = "boss2:hover-panel:minimized";

export const HoverInfoPanel = ({ node }: Props) => {
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    try {
      setMinimized(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
  }, []);

  const toggle = () => {
    setMinimized((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <div className="pointer-events-none absolute top-4 left-4 z-10 w-[320px]">
      <div className="pointer-events-auto rounded-lg border border-[#ddd0b4] bg-[#fffaf2]/95 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between gap-2 border-b border-[#ddd0b4] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#8c7e66]">
            Hover Inspector
          </p>
          <div className="flex items-center gap-1.5">
            {node && !minimized && (
              <span className="rounded-sm border border-[#ddd0b4] bg-[#ebe0ca] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#5a5040]">
                {node.kind}
              </span>
            )}
            <button
              type="button"
              onClick={toggle}
              title={minimized ? "펼치기" : "최소화"}
              className="rounded p-0.5 text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
              aria-label={minimized ? "expand" : "minimize"}
            >
              {minimized ? (
                <Square className="h-3 w-3" />
              ) : (
                <Minus className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>

        {minimized ? null : !node ? (
          <div className="px-3 py-6 text-center text-[11px] text-[#8c7e66]">
            노드 위에 마우스를 올려보세요
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto px-3 py-2.5 space-y-2.5">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                Title
              </p>
              <p className="mt-0.5 break-words text-[12px] font-semibold leading-snug text-[#2e2719]">
                {node.title || "—"}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                  Type
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-[#2e2719]">
                  {node.type || "—"}
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                  Status
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-[#2e2719]">
                  {node.status || "—"}
                </p>
              </div>
            </div>

            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                Domains
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {node.domains && node.domains.length > 0 ? (
                  node.domains.map((d) => (
                    <span
                      key={d}
                      className="rounded-full px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
                      style={{
                        color: DOMAIN_HEX[d] ?? "#8c7e66",
                        border: `1px solid ${DOMAIN_HEX[d] ?? "#bfae8a"}66`,
                        background: `${DOMAIN_HEX[d] ?? "#bfae8a"}14`,
                      }}
                    >
                      {d}
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-[#8c7e66]">—</span>
                )}
              </div>
              <div className="mt-1.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                  Sub-domain
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {node.subDomain ? (
                    <span
                      className="max-w-full truncate rounded-full border border-[#ddd0b4] bg-[#ebe0ca] px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-[#5a5040]"
                      title={cleanTitle(node.subDomain.title)}
                    >
                      {cleanTitle(node.subDomain.title)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[#8c7e66]">—</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                Created
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-[#2e2719]">
                {formatDate(node.created_at)}
              </p>
            </div>

            {node.content && extractFirstHeading(node.content) && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                  Content
                </p>
                <p className="mt-0.5 line-clamp-2 break-words rounded border border-[#ddd0b4] bg-[#f2e9d5]/70 px-2 py-1.5 text-[11px] font-medium leading-snug text-[#2e2719]">
                  {extractFirstHeading(node.content)}
                </p>
              </div>
            )}

            {renderRelatives("Parents", node.parents)}
            {renderRelatives("Children", node.children)}

            {node.metadata && Object.keys(node.metadata).length > 0 && (
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                  Metadata
                </p>
                <div className="mt-1 space-y-0.5 rounded border border-[#ddd0b4] bg-[#f2e9d5]/70 px-2 py-1.5">
                  {Object.entries(node.metadata).map(([k, v]) => (
                    <div
                      key={k}
                      className="grid grid-cols-[80px_minmax(0,1fr)] gap-2 text-[10.5px]"
                    >
                      <span className="truncate font-mono text-[#8c7e66]">
                        {k}
                      </span>
                      <pre className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono text-[#5a5040]">
                        {formatValue(v)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
                ID
              </p>
              <p className="mt-0.5 break-all font-mono text-[10px] text-[#8c7e66]">
                {node.id}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
