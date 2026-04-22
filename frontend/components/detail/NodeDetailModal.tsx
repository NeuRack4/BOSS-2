"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  CircleCheck,
  CirclePause,
  Clock,
  Download,
  FileCheck2,
  FileText,
  Link2,
  ListChecks,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Save,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from "next/image";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import {
  extractReviewPayload,
  ReviewResultCard,
  type ReviewPayload,
} from "@/components/chat/ReviewResultCard";
import { ReviewReplyCard } from "@/components/chat/ReviewReplyCard";
import {
  MenuAnalysisCard,
  type MenuAnalysisPayload,
} from "@/components/chat/MenuAnalysisCard";
import { RevenueStatsPanel } from "@/components/sales/RevenueStatsPanel";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useNodeDetail } from "./NodeDetailContext";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Neighbor = {
  id: string;
  title: string;
  kind: string | null;
  type: string | null;
  relation: string;
  status?: string | null;
};

type MemoRow = {
  id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
};

type LogRow = {
  id: string;
  title: string;
  status: string;
  executed_at?: string | null;
};

type ArtifactRow = {
  id: string;
  account_id: string;
  domains: string[] | null;
  kind: string;
  type: string | null;
  title: string;
  content: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type DetailPayload = {
  artifact: ArtifactRow;
  parent_hub: { domain: Neighbor | null; sub: Neighbor | null };
  edges: { parents: Neighbor[]; children: Neighbor[] };
  memos: MemoRow[];
  evaluation: { up: number; down: number; my_rating: "up" | "down" | null };
  logs: LogRow[];
};

type Attachment = {
  storage_path: string;
  bucket?: string;
  original_name?: string;
  mime_type?: string;
  size_bytes?: number;
};

type SaleRecord = {
  id: string;
  item_name: string;
  category: string;
  quantity: number;
  unit_price: number;
  amount: number;
  recorded_date: string;
  memo?: string;
};

type CostRecord = {
  id: string;
  item_name: string;
  category: string;
  amount: number;
  recorded_date: string;
  memo?: string;
};

type LedgerRecord = SaleRecord | CostRecord;

const SALE_CATS = ["음료", "음식", "디저트", "상품", "서비스", "기타"] as const;
const COST_CATS = [
  "재료비",
  "인건비",
  "임대료",
  "공과금",
  "마케팅",
  "기타",
] as const;

type MetaPatch = {
  period_enabled?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  due_date?: string | null;
  due_label?: string | null;
  schedule_enabled?: boolean;
  cron?: string | null;
  schedule_status?: "active" | "paused";
};

const relativeTime = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

const metaString = (
  meta: Record<string, unknown> | null,
  key: string,
): string => {
  const v = meta?.[key];
  return typeof v === "string" ? v : "";
};
const metaBool = (
  meta: Record<string, unknown> | null,
  key: string,
): boolean => {
  return Boolean(meta?.[key]);
};

const IMPORTANCE_STARS = [0.2, 0.4, 0.6, 0.8, 1.0] as const;

// ── 마케팅 타입별 Content 프리뷰 ───────────────────────────────────────────

const MARKETING_RICH_TYPES = new Set([
  "sns_post",
  "product_post",
  "blog_post",
  "review_reply",
  "shorts_video",
]);

const HASHTAG_LINE_RE = /^(#[\w가-힣A-Za-z]+\s*)+$/;
const HASHTAG_RE = /#([\w가-힣A-Za-z]+)/g;

const parseSnsContent = (
  raw: string,
): {
  caption: string;
  hashtags: string[];
  bestTime: string;
} => {
  const lines = raw.split("\n");
  const captionLines: string[] = [];
  const hashtags: string[] = [];
  let bestTime = "";
  let inTail = false;
  for (const ln of lines) {
    const s = ln.trim();
    if (s.startsWith("💡")) {
      bestTime = s;
      inTail = true;
      continue;
    }
    if (HASHTAG_LINE_RE.test(s)) {
      hashtags.push(
        ...Array.from(s.matchAll(HASHTAG_RE), (m: RegExpMatchArray) => m[1]),
      );
      inTail = true;
      continue;
    }
    if (!inTail) captionLines.push(ln);
  }
  return {
    caption: captionLines.join("\n").trim(),
    hashtags,
    bestTime,
  };
};

const parseBlogContent = (
  raw: string,
): {
  title: string;
  body: string;
  tags: string[];
} => {
  const lines = raw.split("\n");
  let title = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith("# ") && s.length > 2) {
      title = s.slice(2).trim();
      bodyStart = i + 1;
      break;
    }
  }
  const bodyLines = lines.slice(bodyStart);
  const tags: string[] = [];
  let cutIdx = bodyLines.length;
  for (let i = bodyLines.length - 1; i >= 0; i--) {
    const s = bodyLines[i].trim();
    if (!s) continue;
    if (HASHTAG_LINE_RE.test(s)) {
      tags.push(
        ...Array.from(s.matchAll(HASHTAG_RE), (m: RegExpMatchArray) => m[1]),
      );
      cutIdx = i;
    }
    break;
  }
  return {
    title,
    body: bodyLines.slice(0, cutIdx).join("\n").trim(),
    tags,
  };
};

const metaStringArray = (
  meta: Record<string, unknown> | null,
  key: string,
): string[] => {
  const v = meta?.[key];
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  return [];
};

const metaNumber = (
  meta: Record<string, unknown> | null,
  key: string,
): number | null => {
  const v = meta?.[key];
  return typeof v === "number" ? v : null;
};

const SnsPreview = ({
  title,
  content,
  meta,
}: {
  title: string;
  content: string;
  meta: Record<string, unknown> | null;
}) => {
  const { caption, hashtags, bestTime } = useMemo(
    () => parseSnsContent(content),
    [content],
  );
  const metaCaption = metaString(meta, "caption");
  const metaHashtags = metaStringArray(meta, "hashtags");
  const metaBestTime = metaString(meta, "best_time");
  const imageUrl = metaString(meta, "image_url");
  const finalCaption = caption || metaCaption || title;
  const finalHashtags = hashtags.length > 0 ? hashtags : metaHashtags;
  const finalBestTime = bestTime || metaBestTime;

  return (
    <div className="flex justify-center">
      <div className="w-[260px] overflow-hidden rounded-[6px] border border-[#ddd0b4] bg-white">
        <div className="flex items-center gap-2.5 border-b border-[#ddd0b4]/60 px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888] text-[11px] font-bold text-white">
            IG
          </div>
          <div className="flex-1">
            <div className="text-[12px] font-semibold text-[#1a1a1a]">
              {title || "Instagram post"}
            </div>
            <div className="font-mono text-[9.5px] uppercase tracking-wider text-[#8c8c8c]">
              sns preview
            </div>
          </div>
        </div>
        <div className="relative aspect-[4/5] w-full bg-[#f0ece4]">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={title || "SNS 포스트 이미지"}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl opacity-30">
              🖼️
            </div>
          )}
        </div>
        {finalCaption && (
          <div className="whitespace-pre-wrap px-3 py-2.5 text-[12.5px] leading-relaxed text-[#1a1a1a]">
            {finalCaption}
          </div>
        )}
        {finalHashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t border-[#f0ece4] px-3 py-2">
            {finalHashtags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[#e8f0f9] px-2 py-0.5 text-[11px] text-[#3b7aba]"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
        {finalBestTime && (
          <div className="border-t border-[#f0ece4] px-3 py-1.5 font-mono text-[10.5px] text-[#8c7e66]">
            {finalBestTime}
          </div>
        )}
      </div>
    </div>
  );
};

const BlogPreview = ({
  title,
  content,
}: {
  title: string;
  content: string;
}) => {
  const parsed = useMemo(() => parseBlogContent(content), [content]);
  const displayTitle = parsed.title || title;
  return (
    <div className="overflow-hidden rounded-[6px] border border-[#030303]/10 bg-white">
      <div className="flex items-center justify-between border-b border-[#030303]/[0.08] bg-[#eaf4ea] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[#2d7a2d]">
          Naver blog preview
        </span>
        <span className="font-mono text-[10px] text-[#030303]/50">
          {parsed.body.length.toLocaleString()} chars
        </span>
      </div>
      <div className="px-4 py-4">
        {displayTitle && (
          <h1 className="mb-3 text-[18px] font-bold leading-snug text-[#030303]">
            {displayTitle}
          </h1>
        )}
        {parsed.body && (
          <MarkdownMessage
            content={parsed.body}
            className="text-[13px] text-[#030303]"
          />
        )}
        {parsed.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1 border-t border-[#030303]/[0.06] pt-3">
            {parsed.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[#eaf4ea] px-2 py-0.5 text-[11px] text-[#2d7a2d]"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ReviewReplyPreview = ({
  content,
  meta,
}: {
  content: string;
  meta: Record<string, unknown> | null;
}) => {
  const replyText = metaString(meta, "reply_text") || content.trim();
  const starRating = metaNumber(meta, "star_rating");
  const charCount = metaNumber(meta, "char_count") ?? replyText.length;
  return (
    <ReviewReplyCard
      payload={{
        reply_text: replyText,
        star_rating: starRating,
        char_count: charCount,
      }}
    />
  );
};

const ShortsVideoPreview = ({
  title,
  content,
  meta,
}: {
  title: string;
  content: string;
  meta: Record<string, unknown> | null;
}) => {
  const youtubeUrl = metaString(meta, "youtube_url");
  const storageUrl = metaString(meta, "storage_url");
  const tags = metaStringArray(meta, "tags");
  const subtitles = metaStringArray(meta, "subtitles");
  const duration = metaNumber(meta, "duration_per_slide");
  const slideCount = metaNumber(meta, "slide_count");
  const privacy = metaString(meta, "privacy_status");

  return (
    <div className="overflow-hidden rounded-[6px] border border-[#030303]/10 bg-white">
      <div className="flex items-center justify-between border-b border-[#030303]/[0.08] bg-[#1a1a1a] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/80">
          YouTube Shorts
        </span>
        {privacy && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-white/70">
            {privacy}
          </span>
        )}
      </div>
      <div className="relative aspect-[9/16] max-h-[420px] w-full bg-black">
        {storageUrl ? (
          <video
            src={storageUrl}
            controls
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/40">
            <span className="text-4xl">🎬</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 px-3 py-3">
        {title && (
          <div className="text-[14px] font-semibold text-[#030303]">
            {title}
          </div>
        )}
        {content && (
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#030303]/80">
            {content}
          </p>
        )}
        {(slideCount !== null || duration !== null) && (
          <div className="flex gap-3 font-mono text-[10.5px] text-[#030303]/50">
            {slideCount !== null && <span>{slideCount} slides</span>}
            {duration !== null && <span>{duration}s per slide</span>}
          </div>
        )}
        {subtitles.length > 0 && (
          <div className="mt-1 rounded-[4px] border border-[#030303]/10 bg-[#faf8f3] px-2.5 py-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#030303]/50">
              자막
            </div>
            <ol className="list-decimal space-y-0.5 pl-5 text-[12px] text-[#030303]/80">
              {subtitles.map((s, i) => (
                <li key={i}>
                  {s || (
                    <span className="text-[#030303]/30">(빈 슬라이드)</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[#030303]/5 px-2 py-0.5 text-[11px] text-[#030303]/70"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
        {youtubeUrl && (
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex w-full items-center justify-center gap-1.5 rounded-[4px] bg-[#ff0000] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#cc0000]"
          >
            ▶ Watch on YouTube
          </a>
        )}
      </div>
    </div>
  );
};

const SectionHeader = ({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) => (
  <div className="mb-2 flex items-center justify-between">
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#030303]/60">
      {icon}
      <span>{title}</span>
    </div>
    {hint && <span className="text-[11px] text-[#030303]/40">{hint}</span>}
  </div>
);

const Section = ({ children }: { children: React.ReactNode }) => (
  <section className="rounded-[5px] border border-[#030303]/10 bg-white px-3 py-3">
    {children}
  </section>
);

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex items-center gap-2 text-[12px] text-[#030303]/70"
  >
    <span
      className={cn(
        "relative inline-flex h-[18px] w-[30px] items-center rounded-full transition-colors",
        checked ? "bg-[#030303]" : "bg-[#030303]/20",
      )}
    >
      <span
        className={cn(
          "inline-block h-[14px] w-[14px] rounded-full bg-white transition-transform",
          checked ? "translate-x-[14px]" : "translate-x-[2px]",
        )}
      />
    </span>
    {label}
  </button>
);

export const NodeDetailModal = () => {
  const { currentId, closeDetail, openDetail } = useNodeDetail();
  const open = currentId !== null;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  // Local edit state
  const [editContent, setEditContent] = useState(false);
  const [contentDraft, setContentDraft] = useState("");
  const [savingContent, setSavingContent] = useState(false);

  const [periodEnabled, setPeriodEnabled] = useState(false);
  const [periodDraft, setPeriodDraft] = useState<{
    start_date: string;
    end_date: string;
    due_date: string;
    due_label: string;
  }>({ start_date: "", end_date: "", due_date: "", due_label: "" });

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [cronDraft, setCronDraft] = useState("");
  const [scheduleStatus, setScheduleStatus] = useState<"active" | "paused">(
    "active",
  );

  const [newMemo, setNewMemo] = useState("");
  const [savingMemo, setSavingMemo] = useState(false);

  const [boostStars, setBoostStars] = useState(3);
  const [boostNote, setBoostNote] = useState("");
  const [boosting, setBoosting] = useState(false);
  const [boostDone, setBoostDone] = useState(false);

  // Sales / cost records (revenue_entry · cost_report 노드 전용)
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<SaleRecord & CostRecord>>({});
  const [savingRecord, setSavingRecord] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  // Auth hydration (once)
  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setAccountId(user?.id ?? null);
    };
    run();
  }, []);

  const reload = useCallback(async () => {
    console.log("[Modal reload]", { currentId, accountId });
    if (!currentId || !accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/artifacts/${currentId}/detail?account_id=${accountId}`,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const payload = (json?.data ?? null) as DetailPayload | null;
      setData(payload);
      if (payload) {
        const meta = payload.artifact.metadata ?? {};
        setContentDraft(payload.artifact.content ?? "");
        setEditContent(false);
        const pe =
          metaBool(meta, "period_enabled") ||
          ["start_date", "end_date", "due_date"].some((k) =>
            metaString(meta, k),
          );
        setPeriodEnabled(pe);
        setPeriodDraft({
          start_date: metaString(meta, "start_date"),
          end_date: metaString(meta, "end_date"),
          due_date: metaString(meta, "due_date"),
          due_label: metaString(meta, "due_label"),
        });
        const se = metaBool(meta, "schedule_enabled");
        setScheduleEnabled(se);
        setCronDraft(metaString(meta, "cron"));
        const ss = metaString(meta, "schedule_status");
        setScheduleStatus(ss === "paused" ? "paused" : "active");
        setBoostStars(3);
        setBoostNote("");
        setBoostDone(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg.includes("Failed to fetch")
          ? "서버에 연결할 수 없어요. 백엔드가 실행 중인지 확인하고 다시 열어보세요."
          : msg,
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [currentId, accountId]);

  useEffect(() => {
    if (!open) return;
    reload();
  }, [open, reload]);

  const artifact = data?.artifact;
  const meta = artifact?.metadata ?? null;

  const analysisPayload: ReviewPayload | null = useMemo(() => {
    if (!artifact || artifact.type !== "analysis") return null;
    const raw = artifact.content ?? "";
    const { payload } = extractReviewPayload(raw);
    if (payload) return payload;
    // Fallback — build from metadata if content has no marker
    const m = (artifact.metadata ?? {}) as Record<string, unknown>;
    if (typeof m.gap_ratio === "number" && Array.isArray(m.risk_clauses)) {
      return {
        analysis_id: artifact.id,
        analyzed_doc_id:
          typeof m.analyzed_doc_id === "string" ? m.analyzed_doc_id : undefined,
        gap_ratio: Number(m.gap_ratio) || 0,
        eul_ratio: Number(m.eul_ratio) || 0,
        summary: typeof m.summary === "string" ? m.summary : "",
        risk_clauses: m.risk_clauses as ReviewPayload["risk_clauses"],
      };
    }
    return null;
  }, [artifact]);

  const attachment: Attachment | null = useMemo(() => {
    const m = (artifact?.metadata ?? {}) as Record<string, unknown>;
    const raw = m.attachment;
    if (!raw || typeof raw !== "object") return null;
    const a = raw as Record<string, unknown>;
    if (typeof a.storage_path !== "string") return null;
    return {
      storage_path: a.storage_path,
      bucket: typeof a.bucket === "string" ? a.bucket : "documents-uploads",
      original_name:
        typeof a.original_name === "string" ? a.original_name : undefined,
      mime_type: typeof a.mime_type === "string" ? a.mime_type : undefined,
      size_bytes: typeof a.size_bytes === "number" ? a.size_bytes : undefined,
    };
  }, [artifact]);

  const [downloading, setDownloading] = useState(false);
  const downloadAttachment = useCallback(async () => {
    if (!attachment) return;
    setDownloading(true);
    try {
      const supabase = createClient();
      const { data: signed, error: signErr } = await supabase.storage
        .from(attachment.bucket ?? "documents-uploads")
        .createSignedUrl(attachment.storage_path, 60, {
          download: attachment.original_name ?? true,
        });
      if (signErr || !signed?.signedUrl) {
        throw new Error(signErr?.message ?? "signed URL 생성 실패");
      }
      window.open(signed.signedUrl, "_blank", "noopener");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`다운로드 실패: ${msg}`);
    } finally {
      setDownloading(false);
    }
  }, [attachment]);

  const notifyArtifactsChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
  }, []);

  // ── Sales / cost records (revenue_entry · cost_report) ──────────────────
  const recordType: "sales" | "costs" | null = useMemo(() => {
    if (!artifact) return null;
    if (artifact.type === "revenue_entry") return "sales";
    if (artifact.type === "cost_report") return "costs";
    return null;
  }, [artifact]);

  const recordedDate: string = useMemo(() => {
    const v = (artifact?.metadata ?? {})["recorded_date"];
    return typeof v === "string" ? v : "";
  }, [artifact]);

  const loadRecords = useCallback(async () => {
    if (!recordType || !recordedDate || !accountId) {
      setRecords([]);
      return;
    }
    setRecordsLoading(true);
    setRecordsError(null);
    try {
      const endpoint =
        recordType === "sales"
          ? `${API}/api/sales?account_id=${accountId}&start_date=${recordedDate}&end_date=${recordedDate}&limit=500`
          : `${API}/api/costs?account_id=${accountId}&start_date=${recordedDate}&end_date=${recordedDate}&limit=500`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRecords((json?.data?.records ?? []) as LedgerRecord[]);
    } catch (e) {
      setRecordsError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setRecordsLoading(false);
    }
  }, [recordType, recordedDate, accountId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const startEditRecord = (rec: LedgerRecord) => {
    setEditingRecordId(rec.id);
    setEditBuf({ ...(rec as SaleRecord & CostRecord) });
  };

  const cancelEditRecord = () => {
    setEditingRecordId(null);
    setEditBuf({});
  };

  const saveEditRecord = async (id: string) => {
    if (!recordType || !accountId) return;
    setSavingRecord(true);
    try {
      const endpoint =
        recordType === "sales"
          ? `${API}/api/sales/${id}`
          : `${API}/api/costs/${id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, ...editBuf }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRecords();
      setEditingRecordId(null);
      setEditBuf({});
      notifyArtifactsChanged();
    } catch (e) {
      setRecordsError(e instanceof Error ? e.message : "수정 실패");
    } finally {
      setSavingRecord(false);
    }
  };

  const deleteRecord = async (id: string) => {
    if (!recordType || !accountId) return;
    if (!window.confirm("이 항목을 삭제할까요?")) return;
    setDeletingRecordId(id);
    try {
      const endpoint =
        recordType === "sales"
          ? `${API}/api/sales/${id}?account_id=${accountId}`
          : `${API}/api/costs/${id}?account_id=${accountId}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRecords();
      notifyArtifactsChanged();
    } catch (e) {
      setRecordsError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDeletingRecordId(null);
    }
  };

  const recordsTotal = useMemo(
    () => records.reduce((s, r) => s + (r.amount || 0), 0),
    [records],
  );

  // -- PATCH helpers ---------------------------------------------------------
  const patchArtifact = useCallback(
    async (body: Record<string, unknown>) => {
      if (!currentId || !accountId) return;
      const res = await fetch(`${API}/api/artifacts/${currentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, ...body }),
      });
      if (!res.ok) throw new Error(await res.text());
      notifyArtifactsChanged();
      await reload();
    },
    [currentId, accountId, reload, notifyArtifactsChanged],
  );

  const saveContent = async () => {
    setSavingContent(true);
    try {
      await patchArtifact({ content: contentDraft });
      setEditContent(false);
    } catch {
      // toast 붙이고 싶으면 여기
    } finally {
      setSavingContent(false);
    }
  };

  const applyPeriodPatch = async (patch: MetaPatch) => {
    await patchArtifact(patch);
  };

  const togglePeriod = async (v: boolean) => {
    setPeriodEnabled(v);
    await applyPeriodPatch({ period_enabled: v });
  };

  const savePeriodFields = async () => {
    await applyPeriodPatch({
      period_enabled: true,
      start_date: periodDraft.start_date || "",
      end_date: periodDraft.end_date || "",
      due_date: periodDraft.due_date || "",
      due_label: periodDraft.due_label || "",
    });
  };

  const toggleSchedule = async (v: boolean) => {
    setScheduleEnabled(v);
    if (v) {
      if (!cronDraft.trim()) {
        // open the input but don't call API yet
        return;
      }
      await patchArtifact({
        schedule_enabled: true,
        cron: cronDraft,
        schedule_status: scheduleStatus,
      });
    } else {
      await patchArtifact({ schedule_enabled: false });
    }
  };

  const saveCron = async () => {
    if (!cronDraft.trim()) return;
    await patchArtifact({
      schedule_enabled: true,
      cron: cronDraft,
      schedule_status: scheduleStatus,
    });
  };

  const toggleScheduleStatus = async () => {
    const next = scheduleStatus === "active" ? "paused" : "active";
    setScheduleStatus(next);
    await patchArtifact({ schedule_enabled: true, schedule_status: next });
  };

  // -- Memos -----------------------------------------------------------------
  const addMemo = async () => {
    if (!currentId || !accountId || !newMemo.trim()) return;
    setSavingMemo(true);
    try {
      await fetch(`${API}/api/memos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          artifact_id: currentId,
          content: newMemo.trim(),
        }),
      });
      setNewMemo("");
      await reload();
      notifyArtifactsChanged();
    } finally {
      setSavingMemo(false);
    }
  };

  const deleteMemo = async (id: string) => {
    if (!accountId) return;
    await fetch(`${API}/api/memos/${id}?account_id=${accountId}`, {
      method: "DELETE",
    });
    await reload();
    notifyArtifactsChanged();
  };

  // -- Feedback --------------------------------------------------------------
  const sendEvaluation = async (rating: "up" | "down") => {
    if (!currentId || !accountId) return;
    await fetch(`${API}/api/evaluations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        artifact_id: currentId,
        rating,
      }),
    });
    await reload();
    notifyArtifactsChanged();
  };

  // -- Memory Boost ----------------------------------------------------------
  const submitBoost = async () => {
    if (!currentId || !accountId) return;
    setBoosting(true);
    try {
      await fetch(`${API}/api/memory/boost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          artifact_id: currentId,
          importance: IMPORTANCE_STARS[boostStars - 1],
          note: boostNote.trim() || null,
        }),
      });
      setBoostDone(true);
      setBoostNote("");
      notifyArtifactsChanged();
    } finally {
      setBoosting(false);
    }
  };

  // -- Rendering -------------------------------------------------------------
  const kindBadge = artifact
    ? `${artifact.kind}${artifact.type ? ` · ${artifact.type}` : ""}`
    : "";

  return (
    <Modal
      open={open}
      onClose={closeDetail}
      title={artifact?.title ?? "Loading..."}
      widthClass="w-[min(1120px,95vw)]"
      variant="dashboard"
    >
      <div className="flex h-[min(86vh,920px)] min-h-[520px] flex-col">
        {loading && !data && (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/60">
            Loading...
          </div>
        )}

        {!loading && !data && error && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[#030303]/70">
            <span className="rounded-full bg-rose-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-rose-700">
              error
            </span>
            <p className="max-w-[560px] whitespace-pre-wrap">{error}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-1 rounded-[4px] bg-[#030303] px-3 py-1 text-[11px] text-white"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !data && !error && (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/50">
            Nothing here yet
          </div>
        )}

        {data && artifact && (
          <>
            {/* badges (breadcrumb 제거 — 허브는 여기서 열지 않는다) */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full border border-[#030303]/10 bg-white px-2 py-0.5 font-mono uppercase tracking-wider text-[10px] text-[#030303]/60">
                {kindBadge}
              </span>
              <span
                className={cn(
                  "ml-auto rounded-full border px-2 py-0.5 font-mono uppercase tracking-wider text-[10px]",
                  artifact.status === "active"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : artifact.status === "paused"
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : artifact.status === "failed"
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-[#030303]/15 bg-white text-[#030303]/60",
                )}
              >
                {artifact.status}
              </span>
              {(artifact.domains ?? []).map((d) => (
                <span
                  key={d}
                  className="rounded-full bg-[#030303]/5 px-2 py-0.5 text-[10px] text-[#030303]/70"
                >
                  {d}
                </span>
              ))}
            </div>

            <ScrollArea className="min-h-0 flex-1 pr-1">
              <div className="flex flex-col gap-2">
                {/* REVENUE 통계 패널 — revenue_entry 카드 상세에서 표시 */}
                {artifact.type === "revenue_entry" && accountId && (
                  <Section>
                    <RevenueStatsPanel accountId={accountId} />
                  </Section>
                )}

                {/* CONTENT */}
                <Section>
                  <SectionHeader
                    icon={<FileText size={13} />}
                    title="Content"
                    hint={
                      artifact.content
                        ? `${artifact.content.length.toLocaleString()} chars`
                        : undefined
                    }
                  />
                  {editContent ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={contentDraft}
                        onChange={(e) => setContentDraft(e.target.value)}
                        rows={10}
                        className="w-full resize-y rounded-[4px] border border-[#030303]/20 bg-[#f4f1ed] px-2 py-1.5 text-[12.5px] leading-relaxed text-[#030303] outline-none focus:border-[#030303]/40"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={saveContent}
                          disabled={savingContent}
                          className="flex items-center gap-1 rounded-[4px] bg-[#030303] px-2 py-1 text-[11px] text-white disabled:opacity-50"
                        >
                          <Save size={11} />
                          {savingContent ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditContent(false);
                            setContentDraft(artifact.content ?? "");
                          }}
                          className="flex items-center gap-1 rounded-[4px] border border-[#030303]/20 px-2 py-1 text-[11px] text-[#030303]/70"
                        >
                          <X size={11} />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="group relative">
                      <button
                        type="button"
                        onClick={() => setEditContent(true)}
                        className="absolute right-0 top-0 z-10 rounded p-1 text-[#030303]/40 opacity-0 transition-opacity hover:bg-[#030303]/5 hover:text-[#030303]/70 group-hover:opacity-100"
                        title="Edit content"
                      >
                        <Pencil size={13} />
                      </button>
                      {artifact.type &&
                      MARKETING_RICH_TYPES.has(artifact.type) ? (
                        (() => {
                          const raw = artifact.content ?? "";
                          const t = artifact.type;
                          if (t === "sns_post" || t === "product_post")
                            return (
                              <SnsPreview
                                title={artifact.title}
                                content={raw}
                                meta={meta}
                              />
                            );
                          if (t === "blog_post")
                            return (
                              <BlogPreview
                                title={artifact.title}
                                content={raw}
                              />
                            );
                          if (t === "review_reply")
                            return (
                              <ReviewReplyPreview content={raw} meta={meta} />
                            );
                          if (t === "shorts_video")
                            return (
                              <ShortsVideoPreview
                                title={artifact.title}
                                content={raw}
                                meta={meta}
                              />
                            );
                          return null;
                        })()
                      ) : artifact.type === "sales_report" &&
                        artifact.metadata?.menu_chart ? (
                        <MenuAnalysisCard
                          payload={
                            artifact.metadata.menu_chart as MenuAnalysisPayload
                          }
                        />
                      ) : artifact.content ? (
                        <MarkdownMessage
                          content={artifact.content}
                          className="text-[13px] text-[#030303]"
                        />
                      ) : (
                        <p className="text-[12px] text-[#030303]/40">
                          No content yet
                        </p>
                      )}
                    </div>
                  )}
                </Section>

                {/* RECORDS (revenue_entry · cost_report 전용 — sales_records/cost_records 편집) */}
                {recordType && (
                  <Section>
                    <SectionHeader
                      icon={<ListChecks size={13} />}
                      title="Records"
                      hint={
                        records.length > 0
                          ? `${records.length} rows · ${recordsTotal.toLocaleString()} won`
                          : undefined
                      }
                    />
                    {recordsError && (
                      <div className="mb-2 rounded-[4px] border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                        {recordsError}
                      </div>
                    )}
                    {recordsLoading && records.length === 0 ? (
                      <p className="text-[12px] text-[#030303]/40">
                        Loading...
                      </p>
                    ) : records.length === 0 ? (
                      <p className="text-[12px] text-[#030303]/40">
                        Nothing here yet
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-[5px] border border-[#030303]/10 bg-white">
                        <table className="w-full text-[12.5px]">
                          <thead>
                            <tr className="border-b border-[#030303]/10 text-left font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                              <th className="px-3 py-2 font-medium">Item</th>
                              <th className="px-3 py-2 font-medium">
                                Category
                              </th>
                              {recordType === "sales" && (
                                <th className="px-3 py-2 text-right font-medium">
                                  Qty
                                </th>
                              )}
                              {recordType === "sales" && (
                                <th className="px-3 py-2 text-right font-medium">
                                  Unit
                                </th>
                              )}
                              <th className="px-3 py-2 text-right font-medium">
                                Amount
                              </th>
                              <th className="px-3 py-2 font-medium">Memo</th>
                              <th className="w-16 px-2 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {records.map((rec) => {
                              const isEditing = editingRecordId === rec.id;
                              const isDeleting = deletingRecordId === rec.id;
                              const cats =
                                recordType === "sales" ? SALE_CATS : COST_CATS;
                              return (
                                <tr
                                  key={rec.id}
                                  className={cn(
                                    "group border-b border-[#030303]/5 last:border-b-0",
                                    isEditing && "bg-[#f4f1ed]",
                                  )}
                                >
                                  <td className="px-3 py-1.5">
                                    {isEditing ? (
                                      <input
                                        value={editBuf.item_name ?? ""}
                                        onChange={(e) =>
                                          setEditBuf((b) => ({
                                            ...b,
                                            item_name: e.target.value,
                                          }))
                                        }
                                        className="w-full rounded-[4px] border border-[#030303]/15 bg-white px-2 py-0.5 text-[#030303] focus:border-[#030303]/40 focus:outline-none"
                                      />
                                    ) : (
                                      <span className="text-[#030303]">
                                        {rec.item_name}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {isEditing ? (
                                      <select
                                        value={editBuf.category ?? rec.category}
                                        onChange={(e) =>
                                          setEditBuf((b) => ({
                                            ...b,
                                            category: e.target.value,
                                          }))
                                        }
                                        className="rounded-[4px] border border-[#030303]/15 bg-white px-1.5 py-0.5 text-[12px] text-[#030303] focus:outline-none"
                                      >
                                        {cats.map((c) => (
                                          <option key={c}>{c}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <span className="rounded-full bg-[#030303]/5 px-2 py-0.5 text-[10px] text-[#030303]/70">
                                        {rec.category}
                                      </span>
                                    )}
                                  </td>
                                  {recordType === "sales" && (
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                      {isEditing ? (
                                        <input
                                          type="number"
                                          min={1}
                                          value={
                                            editBuf.quantity ??
                                            (rec as SaleRecord).quantity
                                          }
                                          onChange={(e) =>
                                            setEditBuf((b) => ({
                                              ...b,
                                              quantity: Number(e.target.value),
                                            }))
                                          }
                                          className="w-16 rounded-[4px] border border-[#030303]/15 bg-white px-2 py-0.5 text-right text-[#030303] focus:outline-none"
                                        />
                                      ) : (
                                        <span className="text-[#030303]/80">
                                          {(rec as SaleRecord).quantity}
                                        </span>
                                      )}
                                    </td>
                                  )}
                                  {recordType === "sales" && (
                                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                      {isEditing ? (
                                        <input
                                          type="number"
                                          min={0}
                                          value={
                                            editBuf.unit_price ??
                                            (rec as SaleRecord).unit_price
                                          }
                                          onChange={(e) =>
                                            setEditBuf((b) => ({
                                              ...b,
                                              unit_price: Number(
                                                e.target.value,
                                              ),
                                            }))
                                          }
                                          className="w-24 rounded-[4px] border border-[#030303]/15 bg-white px-2 py-0.5 text-right text-[#030303] focus:outline-none"
                                        />
                                      ) : (
                                        <span className="text-[#030303]/80">
                                          {(rec as SaleRecord).unit_price > 0
                                            ? (
                                                rec as SaleRecord
                                              ).unit_price.toLocaleString()
                                            : "-"}
                                        </span>
                                      )}
                                    </td>
                                  )}
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                                    {isEditing ? (
                                      <input
                                        type="number"
                                        min={0}
                                        value={editBuf.amount ?? rec.amount}
                                        onChange={(e) =>
                                          setEditBuf((b) => ({
                                            ...b,
                                            amount: Number(e.target.value),
                                          }))
                                        }
                                        className="w-24 rounded-[4px] border border-[#030303]/15 bg-white px-2 py-0.5 text-right text-[#030303] focus:outline-none"
                                      />
                                    ) : (
                                      <span className="font-semibold text-[#030303]">
                                        {rec.amount.toLocaleString()}
                                        <span className="ml-1 text-[10px] uppercase tracking-wider text-[#030303]/50">
                                          won
                                        </span>
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    {isEditing ? (
                                      <input
                                        value={editBuf.memo ?? rec.memo ?? ""}
                                        onChange={(e) =>
                                          setEditBuf((b) => ({
                                            ...b,
                                            memo: e.target.value,
                                          }))
                                        }
                                        placeholder="memo"
                                        className="w-full rounded-[4px] border border-[#030303]/15 bg-white px-2 py-0.5 text-[#030303]/80 focus:outline-none"
                                      />
                                    ) : (
                                      <span className="text-[11.5px] text-[#030303]/60">
                                        {rec.memo || ""}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    {isEditing ? (
                                      <div className="flex items-center justify-end gap-1">
                                        <button
                                          type="button"
                                          onClick={() => saveEditRecord(rec.id)}
                                          disabled={savingRecord}
                                          className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                                          aria-label="save"
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelEditRecord}
                                          className="rounded p-1 text-[#030303]/50 hover:bg-[#030303]/5"
                                          aria-label="cancel"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                        <button
                                          type="button"
                                          onClick={() => startEditRecord(rec)}
                                          className="rounded p-1 text-[#030303]/40 hover:bg-[#030303]/5 hover:text-[#030303]/80"
                                          aria-label="edit"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => deleteRecord(rec.id)}
                                          disabled={isDeleting}
                                          className="rounded p-1 text-[#030303]/40 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40"
                                          aria-label="delete"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-[#030303]/10 bg-[#f4f1ed]">
                              <td
                                colSpan={recordType === "sales" ? 4 : 2}
                                className="px-3 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-[#030303]/60"
                              >
                                Total · {records.length} rows
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-[13px] font-semibold text-[#030303]">
                                {recordsTotal.toLocaleString()}
                                <span className="ml-1 text-[10px] uppercase tracking-wider text-[#030303]/50">
                                  won
                                </span>
                              </td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </Section>
                )}

                {/* ATTACHMENT (original file download) */}
                {attachment && (
                  <Section>
                    <SectionHeader
                      icon={<Paperclip size={13} />}
                      title="Attachment"
                    />
                    <div className="flex items-center gap-2 text-[12px]">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Paperclip
                          size={14}
                          className="shrink-0 text-[#030303]/50"
                        />
                        <span className="truncate text-[#030303]">
                          {attachment.original_name ??
                            attachment.storage_path.split("/").pop()}
                        </span>
                        {typeof attachment.size_bytes === "number" && (
                          <span className="shrink-0 font-mono text-[10.5px] text-[#030303]/50">
                            {(attachment.size_bytes / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={downloadAttachment}
                        disabled={downloading}
                        className="flex items-center gap-1 rounded-[4px] bg-[#030303] px-2 py-1 text-[11px] text-white disabled:opacity-50"
                      >
                        <Download size={11} />
                        {downloading ? "Opening..." : "Download"}
                      </button>
                    </div>
                  </Section>
                )}

                {/* ANALYSIS (if type=analysis) */}
                {analysisPayload && (
                  <Section>
                    <SectionHeader
                      icon={<FileCheck2 size={13} />}
                      title="Review"
                    />
                    <ReviewResultCard payload={analysisPayload} />
                  </Section>
                )}

                {/* PERIOD */}
                <Section>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#030303]/60">
                      <CalendarDays size={13} />
                      <span>Period</span>
                    </div>
                    <Toggle
                      checked={periodEnabled}
                      onChange={togglePeriod}
                      label={periodEnabled ? "Enabled" : "Off"}
                    />
                  </div>
                  {periodEnabled && (
                    <div className="grid grid-cols-2 gap-2 text-[12px]">
                      <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#030303]/50">
                          start
                        </span>
                        <input
                          type="date"
                          value={periodDraft.start_date}
                          onChange={(e) =>
                            setPeriodDraft((p) => ({
                              ...p,
                              start_date: e.target.value,
                            }))
                          }
                          onBlur={savePeriodFields}
                          className="rounded-[4px] border border-[#030303]/15 bg-white px-2 py-1 outline-none focus:border-[#030303]/40"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#030303]/50">
                          end
                        </span>
                        <input
                          type="date"
                          value={periodDraft.end_date}
                          onChange={(e) =>
                            setPeriodDraft((p) => ({
                              ...p,
                              end_date: e.target.value,
                            }))
                          }
                          onBlur={savePeriodFields}
                          className="rounded-[4px] border border-[#030303]/15 bg-white px-2 py-1 outline-none focus:border-[#030303]/40"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#030303]/50">
                          due
                        </span>
                        <input
                          type="date"
                          value={periodDraft.due_date}
                          onChange={(e) =>
                            setPeriodDraft((p) => ({
                              ...p,
                              due_date: e.target.value,
                            }))
                          }
                          onBlur={savePeriodFields}
                          className="rounded-[4px] border border-[#030303]/15 bg-white px-2 py-1 outline-none focus:border-[#030303]/40"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#030303]/50">
                          due label
                        </span>
                        <input
                          type="text"
                          placeholder="납품기한 / 계약 만료 …"
                          value={periodDraft.due_label}
                          onChange={(e) =>
                            setPeriodDraft((p) => ({
                              ...p,
                              due_label: e.target.value,
                            }))
                          }
                          onBlur={savePeriodFields}
                          className="rounded-[4px] border border-[#030303]/15 bg-white px-2 py-1 outline-none focus:border-[#030303]/40"
                        />
                      </label>
                    </div>
                  )}
                </Section>

                {/* SCHEDULE */}
                <Section>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#030303]/60">
                      <Clock size={13} />
                      <span>Schedule</span>
                    </div>
                    <Toggle
                      checked={scheduleEnabled}
                      onChange={toggleSchedule}
                      label={scheduleEnabled ? "Enabled" : "Off"}
                    />
                  </div>
                  {scheduleEnabled && (
                    <div className="flex flex-col gap-2 text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="cron (예: 0 9 * * *)"
                          value={cronDraft}
                          onChange={(e) => setCronDraft(e.target.value)}
                          className="flex-1 rounded-[4px] border border-[#030303]/15 bg-white px-2 py-1 font-mono outline-none focus:border-[#030303]/40"
                        />
                        <button
                          type="button"
                          onClick={saveCron}
                          className="rounded-[4px] bg-[#030303] px-2 py-1 text-[11px] text-white"
                        >
                          <Save size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={toggleScheduleStatus}
                          className={cn(
                            "flex items-center gap-1 rounded-[4px] border px-2 py-1 text-[11px]",
                            scheduleStatus === "active"
                              ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                              : "border-amber-300 bg-amber-50 text-amber-700",
                          )}
                          title="Toggle active/paused"
                        >
                          {scheduleStatus === "active" ? (
                            <CircleCheck size={11} />
                          ) : (
                            <CirclePause size={11} />
                          )}
                          {scheduleStatus}
                        </button>
                      </div>
                      {Boolean(meta?.next_run || meta?.executed_at) && (
                        <div className="flex gap-3 font-mono text-[10.5px] text-[#030303]/60">
                          {typeof meta?.next_run === "string" && (
                            <span>
                              next_run ·{" "}
                              {new Date(meta.next_run).toLocaleString("ko-KR")}
                            </span>
                          )}
                          {typeof meta?.executed_at === "string" && (
                            <span>
                              last · {relativeTime(meta.executed_at as string)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Section>

                {/* RELATED */}
                <Section>
                  <SectionHeader
                    icon={<Link2 size={13} />}
                    title="Related"
                    hint={`${data.edges.parents.length + data.edges.children.length} links`}
                  />
                  {data.edges.parents.length === 0 &&
                  data.edges.children.length === 0 ? (
                    <p className="text-[12px] text-[#030303]/40">
                      Nothing here yet
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-[12px]">
                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#030303]/50">
                          ↑ parents
                        </div>
                        <ul className="space-y-1">
                          {data.edges.parents.map((p) => (
                            <li key={`p-${p.id}`}>
                              <button
                                type="button"
                                onClick={() => openDetail(p.id)}
                                className="w-full rounded-[4px] border border-[#030303]/10 bg-white px-2 py-1 text-left hover:border-[#030303]/30"
                              >
                                <span className="mr-1 font-mono text-[9.5px] uppercase tracking-wider text-[#030303]/40">
                                  {p.relation}
                                </span>
                                <span className="text-[#030303]">
                                  {p.title || p.id.slice(0, 8)}
                                </span>
                              </button>
                            </li>
                          ))}
                          {data.edges.parents.length === 0 && (
                            <li className="text-[11px] text-[#030303]/40">
                              Nothing here yet
                            </li>
                          )}
                        </ul>
                      </div>
                      <div>
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#030303]/50">
                          ↓ children
                        </div>
                        <ul className="space-y-1">
                          {data.edges.children.map((c) => (
                            <li key={`c-${c.id}`}>
                              <button
                                type="button"
                                onClick={() => openDetail(c.id)}
                                className="w-full rounded-[4px] border border-[#030303]/10 bg-white px-2 py-1 text-left hover:border-[#030303]/30"
                              >
                                <span className="mr-1 font-mono text-[9.5px] uppercase tracking-wider text-[#030303]/40">
                                  {c.relation}
                                </span>
                                <span className="text-[#030303]">
                                  {c.title || c.id.slice(0, 8)}
                                </span>
                              </button>
                            </li>
                          ))}
                          {data.edges.children.length === 0 && (
                            <li className="text-[11px] text-[#030303]/40">
                              Nothing here yet
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}
                </Section>

                {/* RUN HISTORY (if schedule enabled) */}
                {scheduleEnabled && data.logs.length > 0 && (
                  <Section>
                    <SectionHeader
                      icon={<Clock size={13} />}
                      title="Run history"
                      hint={`${data.logs.length} runs`}
                    />
                    <ul className="space-y-1 text-[12px]">
                      {data.logs.map((l) => (
                        <li
                          key={l.id}
                          className="flex items-center justify-between rounded-[4px] border border-[#030303]/10 bg-white px-2 py-1"
                        >
                          <span
                            className={cn(
                              "font-mono text-[10px] uppercase tracking-wider",
                              l.status === "success"
                                ? "text-emerald-700"
                                : "text-rose-700",
                            )}
                          >
                            {l.status}
                          </span>
                          <span className="flex-1 truncate px-2 text-[#030303]">
                            {l.title}
                          </span>
                          <span className="font-mono text-[10.5px] text-[#030303]/50">
                            {relativeTime(l.executed_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                {/* MEMOS */}
                <Section>
                  <SectionHeader
                    icon={<MessageSquarePlus size={13} />}
                    title="Memos"
                    hint={`${data.memos.length}`}
                  />
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-1.5">
                      <textarea
                        value={newMemo}
                        onChange={(e) => setNewMemo(e.target.value)}
                        rows={2}
                        placeholder="Add a memo…"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                            addMemo();
                        }}
                        className="flex-1 resize-none rounded-[4px] border border-[#030303]/15 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-[#030303]/40"
                      />
                      <button
                        type="button"
                        onClick={addMemo}
                        disabled={savingMemo || !newMemo.trim()}
                        className="self-start rounded-[4px] bg-[#030303] px-2 py-1 text-[11px] text-white disabled:opacity-50"
                      >
                        {savingMemo ? "..." : "Add"}
                      </button>
                    </div>
                    {data.memos.length === 0 ? (
                      <p className="text-[11px] text-[#030303]/40">
                        Nothing here yet
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {data.memos.map((m) => (
                          <li
                            key={m.id}
                            className="group flex items-start gap-2 rounded-[4px] border border-[#030303]/10 bg-white px-2 py-1.5"
                          >
                            <p className="flex-1 whitespace-pre-wrap text-[12px] leading-snug text-[#030303]">
                              {m.content}
                            </p>
                            <span className="font-mono text-[10px] text-[#030303]/40">
                              {relativeTime(m.created_at)}
                            </span>
                            <button
                              type="button"
                              onClick={() => deleteMemo(m.id)}
                              className="rounded p-0.5 text-[#030303]/30 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                              title="Delete"
                            >
                              <Trash2 size={11} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Section>

                {/* FEEDBACK */}
                <Section>
                  <SectionHeader
                    icon={<ThumbsUp size={13} />}
                    title="Feedback"
                  />
                  <div className="flex items-center gap-2 text-[12px]">
                    <button
                      type="button"
                      onClick={() => sendEvaluation("up")}
                      className={cn(
                        "flex items-center gap-1 rounded-[4px] border px-2 py-1",
                        data.evaluation.my_rating === "up"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-[#030303]/15 bg-white text-[#030303]/60 hover:border-emerald-300",
                      )}
                    >
                      <ThumbsUp size={12} /> {data.evaluation.up}
                    </button>
                    <button
                      type="button"
                      onClick={() => sendEvaluation("down")}
                      className={cn(
                        "flex items-center gap-1 rounded-[4px] border px-2 py-1",
                        data.evaluation.my_rating === "down"
                          ? "border-rose-300 bg-rose-50 text-rose-700"
                          : "border-[#030303]/15 bg-white text-[#030303]/60 hover:border-rose-300",
                      )}
                    >
                      <ThumbsDown size={12} /> {data.evaluation.down}
                    </button>
                  </div>
                </Section>

                {/* MEMORY BOOST */}
                <Section>
                  <SectionHeader
                    icon={<Star size={13} />}
                    title="Memory Boost"
                    hint="장기기억에 더 중요하게"
                  />
                  <div className="flex flex-col gap-2 text-[12px]">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setBoostStars(n)}
                          className={cn(
                            "p-0.5 transition-transform",
                            boostStars >= n
                              ? "text-amber-400"
                              : "text-[#030303]/20",
                          )}
                        >
                          <Star
                            size={18}
                            fill={boostStars >= n ? "currentColor" : "none"}
                          />
                        </button>
                      ))}
                      <span className="ml-2 font-mono text-[10.5px] text-[#030303]/50">
                        importance {IMPORTANCE_STARS[boostStars - 1].toFixed(1)}
                      </span>
                    </div>
                    <textarea
                      value={boostNote}
                      onChange={(e) => setBoostNote(e.target.value)}
                      rows={2}
                      placeholder="요약/핵심 (비우면 본문 앞부분을 저장)"
                      className="w-full resize-none rounded-[4px] border border-[#030303]/15 bg-white px-2 py-1.5 outline-none focus:border-[#030303]/40"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={submitBoost}
                        disabled={boosting}
                        className="rounded-[4px] bg-[#030303] px-3 py-1 text-[11px] text-white disabled:opacity-50"
                      >
                        {boosting
                          ? "Saving..."
                          : boostDone
                            ? "Saved — boost again?"
                            : "Pin to long-term memory"}
                      </button>
                      {boostDone && (
                        <span className="text-[11px] text-emerald-700">
                          ✓ 저장됨
                        </span>
                      )}
                    </div>
                  </div>
                </Section>
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </Modal>
  );
};
