"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createClient } from "@/lib/supabase/client";

type Domain = "recruitment" | "marketing" | "sales" | "documents";
type Kind = "anchor" | "domain" | "artifact" | "schedule" | "log";

type Relative = {
  id: string;
  title: string;
  kind: Kind;
  relation: string;
};

export type NodeDetailData = {
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

type Memo = {
  id: string;
  artifact_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  node: NodeDetailData | null;
};

const DOMAIN_HEX: Record<Domain, string> = {
  recruitment: "#c47865",
  marketing: "#d89a2b",
  sales: "#7f8f54",
  documents: "#8e5572",
};

const RELATION_COLOR: Record<string, string> = {
  contains: "text-[#8c7e66]",
  derives_from: "text-[#8c7e66]",
  scheduled_by: "text-[#8e5572]",
  revises: "text-[#d89a2b]",
  logged_from: "text-[#7f8f54]",
};

const cleanTitle = (t: string): string =>
  (t || "").replace(/^\[MOCK\]\s*/, "").trim() || "(제목 없음)";

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

const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

const API = process.env.NEXT_PUBLIC_API_URL;

export const NodeDetailModal = ({ open, onClose, node }: Props) => {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => setAccountId(data.user?.id ?? null));
  }, []);

  const fetchMemos = useCallback(async () => {
    if (!node || !accountId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/api/memos?artifact_id=${node.id}&account_id=${accountId}`,
      );
      const json = await res.json();
      setMemos((json.data as Memo[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [node, accountId]);

  useEffect(() => {
    if (open && node && accountId) {
      setDraft("");
      setEditing(null);
      fetchMemos();
    }
  }, [open, node, accountId, fetchMemos]);

  const handleCreate = useCallback(async () => {
    if (!node || !accountId) return;
    const content = draft.trim();
    if (!content) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          artifact_id: node.id,
          content,
        }),
      });
      if (res.ok) {
        setDraft("");
        await fetchMemos();
      }
    } finally {
      setSubmitting(false);
    }
  }, [draft, node, accountId, fetchMemos]);

  const handleUpdate = useCallback(
    async (memoId: string) => {
      if (!accountId) return;
      const content = editDraft.trim();
      if (!content) return;
      const res = await fetch(`${API}/api/memos/${memoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, content }),
      });
      if (res.ok) {
        setEditing(null);
        setEditDraft("");
        await fetchMemos();
      }
    },
    [editDraft, accountId, fetchMemos],
  );

  const handleDelete = useCallback(
    async (memoId: string) => {
      if (!accountId) return;
      if (!confirm("메모를 삭제할까요?")) return;
      const res = await fetch(
        `${API}/api/memos/${memoId}?account_id=${accountId}`,
        { method: "DELETE" },
      );
      if (res.ok) await fetchMemos();
    },
    [accountId, fetchMemos],
  );

  if (!node) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={cleanTitle(node.title)}
      widthClass="w-[820px]"
    >
      <div className="flex items-center gap-1.5 border-b border-[#ddd0b4] pb-2 mb-3">
        <span className="rounded-sm border border-[#ddd0b4] bg-[#ebe0ca] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#5a5040]">
          {node.kind}
        </span>
        {node.type && (
          <span className="rounded-sm border border-[#ddd0b4] bg-[#f2e9d5] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#5a5040]">
            {node.type}
          </span>
        )}
        <span className="rounded-sm border border-[#ddd0b4] bg-[#f2e9d5] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#5a5040]">
          {node.status}
        </span>
        {node.domains?.map((d) => (
          <span
            key={d}
            className="rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={{
              color: DOMAIN_HEX[d],
              border: `1px solid ${DOMAIN_HEX[d]}66`,
              background: `${DOMAIN_HEX[d]}14`,
            }}
          >
            {d}
          </span>
        ))}
        <span className="ml-auto font-mono text-[10px] text-[#8c7e66]">
          {formatDate(node.created_at)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_360px] gap-4">
        <ScrollArea className="max-h-[520px] pr-2">
          <div className="space-y-3">
            {node.content ? (
              <Section label="Content">
                <pre className="whitespace-pre-wrap break-words rounded-md border border-[#ddd0b4] bg-[#f2e9d5]/70 px-3 py-2 text-[12px] leading-relaxed text-[#2e2719]">
                  {node.content}
                </pre>
              </Section>
            ) : null}

            {node.subDomain && (
              <Section label="Sub-domain">
                <span className="inline-block max-w-full truncate rounded-full border border-[#ddd0b4] bg-[#ebe0ca] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[#5a5040]">
                  {cleanTitle(node.subDomain.title)}
                </span>
              </Section>
            )}

            {node.metadata && Object.keys(node.metadata).length > 0 && (
              <Section label="Metadata">
                <div className="space-y-0.5 rounded-md border border-[#ddd0b4] bg-[#f2e9d5]/70 px-3 py-2">
                  {Object.entries(node.metadata).map(([k, v]) => (
                    <div
                      key={k}
                      className="grid grid-cols-[100px_1fr] gap-2 text-[11px]"
                    >
                      <span className="truncate font-mono text-[#8c7e66]">
                        {k}
                      </span>
                      <pre className="whitespace-pre-wrap break-words font-mono text-[#5a5040]">
                        {formatValue(v)}
                      </pre>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <RelativesBlock label="Parents" list={node.parents} />
            <RelativesBlock label="Children" list={node.children} />

            <Section label="ID">
              <p className="break-all font-mono text-[10px] text-[#8c7e66]">
                {node.id}
              </p>
            </Section>
          </div>
        </ScrollArea>

        <div className="flex flex-col border-l border-[#ddd0b4] pl-4">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
            Memo ({memos.length})
          </p>
          <div className="mb-2">
            <textarea
              ref={draftRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="이 노드에 대한 메모를 남겨보세요. (검색/대화 컨텍스트에 반영됨)"
              className="w-full min-h-[72px] resize-none rounded-md border border-[#ddd0b4] bg-[#fbf6eb] px-2 py-1.5 text-[12px] text-[#2e2719] placeholder-[#8c7e66]/60 focus:border-[#bfae8a] focus:outline-none"
            />
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={handleCreate}
                disabled={submitting || !draft.trim() || !accountId}
                className="rounded-md border border-[#ddd0b4] bg-[#ebe0ca] px-2.5 py-1 text-[11px] text-[#2e2719] hover:bg-[#ddd0b4] disabled:opacity-40"
              >
                {submitting ? "저장 중…" : "메모 추가"}
              </button>
            </div>
          </div>

          <ScrollArea className="flex-1 max-h-[420px] pr-1">
            {loading ? (
              <p className="py-4 text-center text-[11px] text-[#8c7e66]">
                불러오는 중…
              </p>
            ) : memos.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-[#8c7e66]">
                아직 메모가 없습니다.
              </p>
            ) : (
              <div className="space-y-2">
                {memos.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-md border border-[#ddd0b4] bg-[#fbf6eb] px-2.5 py-2"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[9px] text-[#8c7e66]">
                        {formatDate(m.updated_at || m.created_at)}
                      </span>
                      <div className="flex gap-0.5">
                        {editing === m.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleUpdate(m.id)}
                              className="rounded p-0.5 text-[#7f8f54] hover:bg-[#ebe0ca]"
                              aria-label="save"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(null);
                                setEditDraft("");
                              }}
                              className="rounded p-0.5 text-[#8c7e66] hover:bg-[#ebe0ca]"
                              aria-label="cancel"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(m.id);
                                setEditDraft(m.content);
                              }}
                              className="rounded p-0.5 text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
                              aria-label="edit"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(m.id)}
                              className="rounded p-0.5 text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#c47865]"
                              aria-label="delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {editing === m.id ? (
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        className="w-full min-h-[60px] resize-none rounded border border-[#ddd0b4] bg-[#fffaf2] px-2 py-1 text-[12px] text-[#2e2719] focus:border-[#bfae8a] focus:outline-none"
                      />
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-[#2e2719]">
                        {m.content}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </Modal>
  );
};

const Section = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#8c7e66]">
      {label}
    </p>
    {children}
  </div>
);

const RelativesBlock = ({
  label,
  list,
}: {
  label: string;
  list: Relative[];
}) => (
  <Section label={`${label} (${list.length})`}>
    {list.length === 0 ? (
      <p className="text-[11px] text-[#8c7e66]">—</p>
    ) : (
      <div className="space-y-0.5 rounded-md border border-[#ddd0b4] bg-[#f2e9d5]/70 px-2 py-1.5">
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
  </Section>
);
