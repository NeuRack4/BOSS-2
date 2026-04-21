"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pencil,
  Trash2,
  Check,
  X,
  Upload,
  ImageIcon,
  ExternalLink,
  Download,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
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

type SalesRecord = {
  id: string;
  recorded_date: string;
  item_name: string;
  category: string;
  quantity: number;
  unit_price: number;
  amount: number;
};

type CostRecord = {
  id: string;
  recorded_date: string;
  item_name: string;
  category: string;
  amount: number;
  memo: string;
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

  // Marketing actions
  const [blogUploading, setBlogUploading] = useState(false);
  const [blogResult, setBlogResult] = useState<string | null>(null);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(
    null,
  );

  // Sales records
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesDate, setSalesDate] = useState("");
  const [deletingRecord, setDeletingRecord] = useState<string | null>(null);

  // Cost records
  const [costRecords, setCostRecords] = useState<CostRecord[]>([]);
  const [costLoading, setCostLoading] = useState(false);
  const [costDate, setCostDate] = useState("");
  const [deletingCostRecord, setDeletingCostRecord] = useState<string | null>(
    null,
  );

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

  const fetchSalesRecords = useCallback(
    async (date: string) => {
      if (!accountId || !date) return;
      setSalesLoading(true);
      try {
        const res = await fetch(
          `${API}/api/sales?account_id=${accountId}&start_date=${date}&end_date=${date}&limit=100`,
        );
        const json = await res.json();
        setSalesRecords((json.data?.records as SalesRecord[]) ?? []);
      } finally {
        setSalesLoading(false);
      }
    },
    [accountId],
  );

  const handleDeleteRecord = useCallback(
    async (recordId: string) => {
      if (!accountId) return;
      if (!confirm("이 매출 항목을 삭제할까요?")) return;
      setDeletingRecord(recordId);
      try {
        await fetch(`${API}/api/sales/${recordId}?account_id=${accountId}`, {
          method: "DELETE",
        });
        setSalesRecords((prev) => prev.filter((r) => r.id !== recordId));
      } finally {
        setDeletingRecord(null);
      }
    },
    [accountId],
  );

  const fetchCostRecords = useCallback(
    async (date: string) => {
      if (!accountId || !date) return;
      setCostLoading(true);
      try {
        const res = await fetch(
          `${API}/api/costs?account_id=${accountId}&start_date=${date}&end_date=${date}&limit=100`,
        );
        const json = await res.json();
        setCostRecords((json.data?.records as CostRecord[]) ?? []);
      } finally {
        setCostLoading(false);
      }
    },
    [accountId],
  );

  const handleDeleteCostRecord = useCallback(
    async (recordId: string) => {
      if (!accountId) return;
      if (!confirm("이 비용 항목을 삭제할까요?")) return;
      setDeletingCostRecord(recordId);
      try {
        await fetch(`${API}/api/costs/${recordId}?account_id=${accountId}`, {
          method: "DELETE",
        });
        setCostRecords((prev) => prev.filter((r) => r.id !== recordId));
      } finally {
        setDeletingCostRecord(null);
      }
    },
    [accountId],
  );

  useEffect(() => {
    if (open && node && accountId) {
      setDraft("");
      setEditing(null);
      fetchMemos();
      if (
        node.domains?.includes("sales") &&
        node.kind === "artifact" &&
        node.type === "revenue_entry"
      ) {
        const date =
          (node.metadata?.recorded_date as string) ||
          (node.created_at
            ? node.created_at.split("T")[0]
            : new Date().toISOString().split("T")[0]);
        setSalesDate(date);
        fetchSalesRecords(date);
      }
      if (
        node.domains?.includes("sales") &&
        node.kind === "artifact" &&
        node.type === "cost_report"
      ) {
        const date =
          (node.metadata?.recorded_date as string) ||
          (node.created_at
            ? node.created_at.split("T")[0]
            : new Date().toISOString().split("T")[0]);
        setCostDate(date);
        fetchCostRecords(date);
      }
    }
  }, [open, node, accountId, fetchMemos, fetchSalesRecords, fetchCostRecords]);

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

  const handleNaverUpload = useCallback(async () => {
    if (!node || !accountId) return;
    setBlogUploading(true);
    setBlogResult(null);
    try {
      const res = await fetch(`${API}/api/marketing/blog/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, artifact_id: node.id }),
      });
      const json = await res.json();
      setBlogResult(res.ok ? "업로드 완료!" : json.detail || "업로드 실패");
    } catch {
      setBlogResult("업로드 실패");
    } finally {
      setBlogUploading(false);
    }
  }, [node, accountId]);

  const handleGenerateImage = useCallback(async () => {
    if (!node || !accountId) return;
    setImageGenerating(true);
    setGeneratedImageUrl(null);
    try {
      const res = await fetch(`${API}/api/marketing/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, artifact_id: node.id }),
      });
      const json = await res.json();
      if (res.ok && json.data?.url) setGeneratedImageUrl(json.data.url);
    } finally {
      setImageGenerating(false);
    }
  }, [node, accountId]);

  if (!node) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={cleanTitle(node.title)}
      widthClass="w-[820px]"
    >
      <div className="flex min-h-0 flex-1 flex-col">
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

        <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4 min-h-0 flex-1">
          <ScrollArea className="h-full min-h-0 min-w-0 pr-2">
            <div className="min-w-0 space-y-3">
              {node.content ? (
                node.type === "job_posting_poster" ? (
                  <Section label="Poster">
                    <PosterPreview
                      html={node.content}
                      publicUrl={
                        typeof node.metadata?.public_url === "string"
                          ? (node.metadata.public_url as string)
                          : undefined
                      }
                      filename={
                        typeof node.metadata?.storage_path === "string"
                          ? ((node.metadata.storage_path as string)
                              .split("/")
                              .pop() ?? "poster.html")
                          : "poster.html"
                      }
                    />
                  </Section>
                ) : (
                  <Section label="Content">
                    <div className="min-w-0 rounded-md border border-[#ddd0b4] bg-[#f2e9d5]/70 px-3 py-2">
                      <MarkdownMessage
                        content={node.content}
                        className="text-[12px]"
                      />
                    </div>
                  </Section>
                )
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
                        className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 text-[11px]"
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
                </Section>
              )}

              {node.domains?.includes("marketing") &&
                node.kind === "artifact" && (
                  <Section label="Marketing Actions">
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleGenerateImage}
                          disabled={imageGenerating}
                          className="flex items-center gap-1.5 rounded-md border border-[#ddd0b4] bg-[#ebe0ca] px-2.5 py-1.5 text-[11px] text-[#2e2719] hover:bg-[#ddd0b4] disabled:opacity-40"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          {imageGenerating ? "생성 중…" : "이미지 생성"}
                        </button>
                        {node.type === "blog_post" && (
                          <button
                            type="button"
                            onClick={handleNaverUpload}
                            disabled={blogUploading}
                            className="flex items-center gap-1.5 rounded-md border border-[#ddd0b4] bg-[#ebe0ca] px-2.5 py-1.5 text-[11px] text-[#2e2719] hover:bg-[#ddd0b4] disabled:opacity-40"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            {blogUploading
                              ? "업로드 중…"
                              : "네이버 블로그 업로드"}
                          </button>
                        )}
                      </div>
                      {generatedImageUrl && (
                        <img
                          src={generatedImageUrl}
                          alt="generated"
                          className="rounded-md border border-[#ddd0b4] max-w-full"
                        />
                      )}
                      {blogResult && (
                        <p className="text-[11px] text-[#5a5040]">
                          {blogResult}
                        </p>
                      )}
                    </div>
                  </Section>
                )}

              {node.domains?.includes("sales") &&
                node.kind === "artifact" &&
                node.type === "revenue_entry" && (
                  <Section label="Sales Records">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={salesDate}
                          onChange={(e) => {
                            setSalesDate(e.target.value);
                            fetchSalesRecords(e.target.value);
                          }}
                          className="rounded border border-[#ddd0b4] bg-transparent px-2 py-1 font-mono text-[11px] text-[#5a5040] focus:border-[#bfae8a] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => fetchSalesRecords(salesDate)}
                          className="rounded border border-[#ddd0b4] bg-[#ebe0ca] px-2 py-1 text-[11px] text-[#2e2719] hover:bg-[#ddd0b4]"
                        >
                          새로고침
                        </button>
                      </div>

                      {salesLoading ? (
                        <p className="py-2 text-[11px] text-[#8c7e66]">
                          불러오는 중…
                        </p>
                      ) : salesRecords.length === 0 ? (
                        <p className="py-2 text-[11px] text-[#8c7e66]">
                          {salesDate} 매출 기록이 없습니다.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-md border border-[#ddd0b4] bg-[#f2e9d5]/70">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="border-b border-[#ddd0b4] text-left text-[#8c7e66]">
                                <th className="px-2 py-1.5 font-medium">
                                  상품
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                  카테고리
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                  수량
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                  금액
                                </th>
                                <th className="w-6 px-1" />
                              </tr>
                            </thead>
                            <tbody>
                              {salesRecords.map((r) => (
                                <tr
                                  key={r.id}
                                  className="border-b border-[#ddd0b4]/50 last:border-0"
                                >
                                  <td className="px-2 py-1.5 text-[#2e2719]">
                                    {r.item_name}
                                  </td>
                                  <td className="px-2 py-1.5 text-[#5a5040]">
                                    {r.category}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-[#2e2719]">
                                    {r.quantity}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-[#2e2719]">
                                    {r.amount.toLocaleString()}원
                                  </td>
                                  <td className="px-1 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteRecord(r.id)}
                                      disabled={deletingRecord === r.id}
                                      className="rounded p-0.5 text-[#bfae8a] hover:bg-[#ebe0ca] hover:text-[#c47865] disabled:opacity-40"
                                      aria-label="삭제"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-[#ddd0b4]">
                                <td
                                  colSpan={3}
                                  className="px-2 py-1.5 text-right text-[10px] font-semibold text-[#2e2719]"
                                >
                                  합계
                                </td>
                                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-[#2e2719]">
                                  {salesRecords
                                    .reduce((s, r) => s + r.amount, 0)
                                    .toLocaleString()}
                                  원
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>
                  </Section>
                )}

              {node.domains?.includes("sales") &&
                node.kind === "artifact" &&
                node.type === "cost_report" && (
                  <Section label="Cost Records">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="date"
                          value={costDate}
                          onChange={(e) => {
                            setCostDate(e.target.value);
                            fetchCostRecords(e.target.value);
                          }}
                          className="rounded border border-[#ddd0b4] bg-transparent px-2 py-1 font-mono text-[11px] text-[#5a5040] focus:border-[#bfae8a] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => fetchCostRecords(costDate)}
                          className="rounded border border-[#ddd0b4] bg-[#ebe0ca] px-2 py-1 text-[11px] text-[#2e2719] hover:bg-[#ddd0b4]"
                        >
                          새로고침
                        </button>
                      </div>

                      {costLoading ? (
                        <p className="py-2 text-[11px] text-[#8c7e66]">
                          불러오는 중…
                        </p>
                      ) : costRecords.length === 0 ? (
                        <p className="py-2 text-[11px] text-[#8c7e66]">
                          {costDate} 비용 기록이 없습니다.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-md border border-[#ddd0b4] bg-[#f2e9d5]/70">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="border-b border-[#ddd0b4] text-left text-[#8c7e66]">
                                <th className="px-2 py-1.5 font-medium">
                                  항목
                                </th>
                                <th className="px-2 py-1.5 font-medium">
                                  분류
                                </th>
                                <th className="px-2 py-1.5 text-right font-medium">
                                  금액
                                </th>
                                <th className="w-6 px-1" />
                              </tr>
                            </thead>
                            <tbody>
                              {costRecords.map((r) => (
                                <tr
                                  key={r.id}
                                  className="border-b border-[#ddd0b4]/50 last:border-0"
                                >
                                  <td className="px-2 py-1.5 text-[#2e2719]">
                                    {r.item_name}
                                  </td>
                                  <td className="px-2 py-1.5 text-[#5a5040]">
                                    {r.category}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-[#2e2719]">
                                    {r.amount.toLocaleString()}원
                                  </td>
                                  <td className="px-1 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleDeleteCostRecord(r.id)
                                      }
                                      disabled={deletingCostRecord === r.id}
                                      className="rounded p-0.5 text-[#bfae8a] hover:bg-[#ebe0ca] hover:text-[#c47865] disabled:opacity-40"
                                      aria-label="삭제"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-[#ddd0b4]">
                                <td
                                  colSpan={2}
                                  className="px-2 py-1.5 text-right text-[10px] font-semibold text-[#2e2719]"
                                >
                                  합계
                                </td>
                                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-[#2e2719]">
                                  {costRecords
                                    .reduce((s, r) => s + r.amount, 0)
                                    .toLocaleString()}
                                  원
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
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

type PosterPreviewProps = {
  html: string;
  publicUrl?: string;
  filename: string;
};

const PosterPreview = ({ html, publicUrl, filename }: PosterPreviewProps) => {
  const handleDownload = useCallback(() => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".html") ? filename : `${filename}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [html, filename]);

  return (
    <div className="space-y-2">
      <iframe
        title="poster-preview"
        srcDoc={html}
        sandbox="allow-same-origin"
        className="h-[560px] w-full rounded-md border border-[#ddd0b4] bg-white"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-md border border-[#ddd0b4] bg-[#ebe0ca] px-2.5 py-1.5 text-[11px] text-[#2e2719] hover:bg-[#ddd0b4]"
        >
          <Download className="h-3.5 w-3.5" />
          HTML 다운로드
        </button>
        {publicUrl ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-[#ddd0b4] bg-[#ebe0ca] px-2.5 py-1.5 text-[11px] text-[#2e2719] hover:bg-[#ddd0b4]"
          >
            <ExternalLink className="h-3.5 w-3.5" />새 탭에서 열기
          </a>
        ) : null}
      </div>
    </div>
  );
};
