"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Search, StickyNote } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Domain = "recruitment" | "marketing" | "sales" | "documents";
type Kind = "domain" | "artifact" | "schedule" | "log";

type SearchResult = {
  artifact_id: string;
  kind: Kind;
  type: string;
  title: string;
  domains: Domain[];
  status: string;
  match: "content" | "memo";
  snippet: string;
  score: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const DOMAIN_HEX: Record<Domain, string> = {
  recruitment: "#c47865",
  marketing: "#d89a2b",
  sales: "#7f8f54",
  documents: "#8e5572",
};

const API = process.env.NEXT_PUBLIC_API_URL;

const cleanTitle = (t: string): string =>
  (t || "").replace(/^\[MOCK\]\s*/, "").trim() || "(제목 없음)";

export const SearchPalette = ({ open, onClose }: Props) => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => setAccountId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults([]);
    setActive(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !accountId) return;
    const query = q.trim();
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    const t = window.setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setLoading(true);
      try {
        const res = await fetch(
          `${API}/api/search?q=${encodeURIComponent(query)}&account_id=${accountId}&limit=15`,
          { signal: abortRef.current.signal },
        );
        const json = await res.json();
        setResults((json.data as SearchResult[]) ?? []);
        setActive(0);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, accountId, open]);

  const focusNode = useCallback(
    (id: string) => {
      window.dispatchEvent(
        new CustomEvent("boss:focus-node", { detail: { id } }),
      );
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) =>
          results.length ? Math.min(i + 1, results.length - 1) : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const picked = results[active];
        if (picked) {
          e.preventDefault();
          focusNode(picked.artifact_id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, active, focusNode, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-start justify-center bg-[#2e2719]/40 backdrop-blur-sm pt-24"
      onClick={onClose}
    >
      <div
        className="w-[640px] rounded-xl border border-[#ddd0b4] bg-[#fffaf2] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#ddd0b4]">
          <Search className="h-4 w-4 text-[#8c7e66] shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="노드 제목·내용·메모·메타데이터 검색…"
            className="flex-1 bg-transparent text-[13px] text-[#2e2719] placeholder-[#8c7e66]/70 focus:outline-none"
          />
          <kbd className="font-mono text-[9px] uppercase tracking-wider text-[#8c7e66] border border-[#ddd0b4] rounded px-1 py-0.5">
            ESC
          </kbd>
        </div>

        <div className="max-h-[460px] overflow-y-auto">
          {!q.trim() ? (
            <p className="px-4 py-5 text-center text-[11px] text-[#8c7e66]">
              제목·내용·메모·메타데이터를 검색합니다. ↑↓로 탐색, Enter로 이동.
            </p>
          ) : loading && results.length === 0 ? (
            <p className="px-4 py-5 text-center text-[11px] text-[#8c7e66]">
              검색 중…
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-5 text-center text-[11px] text-[#8c7e66]">
              일치하는 결과가 없어요.
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.artifact_id}-${r.match}-${i}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => focusNode(r.artifact_id)}
                className={`block w-full text-left px-3 py-2 border-b border-[#ddd0b4]/50 last:border-b-0 transition-colors ${
                  i === active ? "bg-[#ebe0ca]" : "hover:bg-[#f2e9d5]/60"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {r.match === "memo" ? (
                    <StickyNote className="h-3 w-3 text-[#8e5572] shrink-0" />
                  ) : (
                    <FileText className="h-3 w-3 text-[#8c7e66] shrink-0" />
                  )}
                  <span className="text-[12.5px] font-semibold text-[#2e2719] truncate">
                    {cleanTitle(r.title)}
                  </span>
                  <span className="ml-auto font-mono text-[9px] uppercase tracking-wider text-[#8c7e66] shrink-0">
                    {r.kind}
                    {r.type ? `·${r.type}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-wrap mb-1">
                  {r.domains?.map((d) => (
                    <span
                      key={d}
                      className="rounded-full px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider"
                      style={{
                        color: DOMAIN_HEX[d],
                        border: `1px solid ${DOMAIN_HEX[d]}66`,
                        background: `${DOMAIN_HEX[d]}14`,
                      }}
                    >
                      {d}
                    </span>
                  ))}
                  {r.match === "memo" && (
                    <span className="rounded-full border border-[#8e5572]/40 bg-[#8e5572]/10 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-[#8e5572]">
                      memo 매치
                    </span>
                  )}
                  {r.status && r.status !== "draft" && (
                    <span className="rounded-full border border-[#ddd0b4] bg-[#ebe0ca] px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider text-[#5a5040]">
                      {r.status}
                    </span>
                  )}
                </div>
                {r.snippet && (
                  <p className="text-[11px] text-[#5a5040] line-clamp-2">
                    {r.snippet}
                  </p>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[#ddd0b4] bg-[#f2e9d5]/60 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-[#8c7e66]">
          <span>↑↓ 탐색</span>
          <span>↵ 이동</span>
          <span className="ml-auto">
            {results.length > 0 ? `${results.length}개 결과` : ""}
          </span>
        </div>
      </div>
    </div>
  );
};
