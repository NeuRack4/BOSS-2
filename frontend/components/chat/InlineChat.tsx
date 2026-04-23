"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowUpIcon,
  Bot,
  Loader2,
  Paperclip,
  PlusIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useChat } from "./ChatContext";
import {
  ReviewResultCard,
  extractReviewPayload,
  type ReviewPayload,
} from "./ReviewResultCard";
import {
  InstagramPostCard,
  extractInstagramPayload,
  type InstagramPayload,
} from "./InstagramPostCard";
import {
  ReviewReplyCard,
  extractReviewReplyPayload,
  type ReviewReplyPayload,
} from "./ReviewReplyCard";
import { MarkdownMessage } from "./MarkdownMessage";
import { SalesInputTable, type SalesActionData } from "./SalesInputTable";
import { CostInputTable, type CostActionData } from "./CostInputTable";
import {
  ShortsWizardCard,
  extractShortsWizardPayload,
  type ShortsWizardPayload,
} from "./ShortsWizardCard";
import {
  MenuAnalysisCard,
  extractMenuChartPayload,
  type MenuAnalysisPayload,
} from "./MenuAnalysisCard";
import { useNodeDetail } from "@/components/detail/NodeDetailContext";
import { OnboardingFormCard } from "./OnboardingFormCard";
import {
  EmployeePickerCard,
  extractEmployeePickerPayload,
  type EmployeePickerPayload,
} from "./EmployeePickerCard";

type UploadCategory =
  | "documents"
  | "receipt"
  | "invoice"
  | "tax"
  | "id"
  | "other";

type ConfirmPayload = {
  artifactId: string;
  autoCategory: UploadCategory;
  autoDocType: string;
  userCategory: UploadCategory;
  userDocType: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  choices?: string[];
  review?: ReviewPayload;
  instagram?: InstagramPayload;
  reviewReply?: ReviewReplyPayload;
  attachment?: {
    status: "uploading" | "done" | "error";
    filename: string;
    sizeKb?: number;
    error?: string;
  };
  confirm?: ConfirmPayload;
  salesAction?: SalesActionData;
  costAction?: CostActionData;
  shortsWizard?: ShortsWizardPayload;
  menuChart?: MenuAnalysisPayload;
  employeePicker?: EmployeePickerPayload;
  savedArtifactId?: string;
  savedDomain?: string;
  savedArtifactMeta?: { type: string; recordedDate: string; title: string };
  suggested?: boolean;
};

const UPLOAD_ACCEPT =
  ".pdf,.docx,.doc,.txt,.rtf,.xlsx,.csv," +
  ".jpg,.jpeg,.png,.webp,.bmp,.tiff,.gif,.heic,.heif," +
  "application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/msword," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "text/plain,text/csv,application/rtf," +
  "image/jpeg,image/png,image/webp,image/bmp,image/tiff,image/gif,image/heic,image/heif";
const UPLOAD_MAX_MB = 20;

const UPLOAD_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "auto", label: "auto" },
  { value: "contract", label: "계약서" },
  { value: "proposal", label: "제안서" },
  { value: "estimate", label: "견적서" },
  { value: "notice", label: "공지문" },
  { value: "checklist", label: "체크리스트" },
  { value: "guide", label: "가이드" },
  { value: "receipt", label: "영수증" },
  { value: "invoice", label: "청구서" },
  { value: "tax", label: "세금계산서" },
  { value: "id", label: "신분증" },
  { value: "other", label: "기타" },
];

const CATEGORY_LABEL: Record<UploadCategory, string> = {
  documents: "문서",
  receipt: "영수증",
  invoice: "청구서",
  tax: "세금계산서",
  id: "신분증",
  other: "기타",
};

const NON_DOC_HINT: Partial<Record<UploadCategory, string>> = {
  receipt:
    "영수증으로 분류했어요. 저장은 됐지만 자동 분석/기록은 아직 지원하지 않아요.",
  invoice:
    "청구서로 분류했어요. 저장은 됐지만 자동 분석/기록은 아직 지원하지 않아요.",
  tax: "세금계산서로 분류했어요. 저장은 됐지만 자동 분석/기록은 아직 지원하지 않아요.",
  id: "신분증으로 분류했어요. 민감 정보라 저장만 하고 별도 처리는 하지 않아요.",
  other:
    "사업용 문서 분류에 해당하지 않아 저장만 해뒀어요. 필요하면 위 드롭다운에서 타입을 지정해 다시 올려주세요.",
};

const DOMAIN_CAPABILITIES: Array<{
  label: string;
  accent: string;
  bg: string;
  items: Array<{ name: string; prompt: string }>;
}> = [
  {
    label: "Sales",
    accent: "#7ba8a4",
    bg: "#c4dbd9",
    items: [
      { name: "매출 입력", prompt: "오늘 매출 입력하기" },
      { name: "비용 입력", prompt: "오늘 비용 입력하기" },
      { name: "매출 리포트", prompt: "이번 달 매출 요약 정리해줘" },
      { name: "비용 분석", prompt: "비용 지출 분석해줘" },
      { name: "가격 전략", prompt: "가격 전략 추천해줘" },
      { name: "고객 스크립트", prompt: "고객 응대 스크립트 만들어줘" },
      { name: "고객 분석", prompt: "고객 분석 리포트 만들어줘" },
      { name: "프로모션", prompt: "프로모션 기획해줘" },
    ],
  },
  {
    label: "Recruitment",
    accent: "#d4a588",
    bg: "#f7e6da",
    items: [
      { name: "채용 공고 작성", prompt: "채용 공고 초안 작성해줘" },
      {
        name: "3개 플랫폼 동시 공고",
        prompt: "3개 플랫폼에 채용 공고 동시에 올려줘",
      },
      { name: "채용 공고 포스터", prompt: "채용 공고 포스터 이미지 만들어줘" },
      { name: "면접 질문", prompt: "면접 질문 5개 뽑아줘" },
      {
        name: "온보딩 체크리스트",
        prompt: "신규 직원 온보딩 체크리스트 만들어줘",
      },
      { name: "면접 평가표", prompt: "면접 평가표 양식 만들어줘" },
      { name: "채용 가이드", prompt: "직원 근태 관리 가이드 만들어줘" },
      { name: "인건비 계산", prompt: "주휴수당 포함 월 인건비 계산해줘" },
    ],
  },
  {
    label: "Marketing",
    accent: "#c78897",
    bg: "#f0d7df",
    items: [
      { name: "SNS 포스트", prompt: "인스타 포스트 3개 기획해줘" },
      { name: "블로그 포스트", prompt: "블로그 포스트 작성해줘" },
      { name: "광고 카피", prompt: "광고 카피 3가지 버전 만들어줘" },
      { name: "마케팅 플랜", prompt: "마케팅 플랜 짜줘" },
      { name: "이벤트 기획", prompt: "프로모션 이벤트 기획해줘" },
      { name: "캠페인 전략", prompt: "캠페인 전략 세워줘" },
      { name: "리뷰 답글", prompt: "리뷰 답글 작성해줘" },
      { name: "공지사항", prompt: "공지사항 작성해줘" },
      { name: "상품 포스트", prompt: "신상품 포스트 만들어줘" },
      { name: "YouTube Shorts", prompt: "유튜브 Shorts 영상 만들어줘" },
    ],
  },
  {
    label: "Documents",
    accent: "#7977a0",
    bg: "#c8c7d6",
    items: [
      { name: "근로계약서", prompt: "근로계약서 초안 작성해줘" },
      { name: "임대차 계약서", prompt: "임대차 계약서 작성해줘" },
      { name: "용역 계약서", prompt: "용역 계약서 작성해줘" },
      { name: "NDA", prompt: "NDA 계약서 작성해줘" },
      { name: "견적서", prompt: "견적서 만들어줘" },
      { name: "제안서", prompt: "제안서 작성해줘" },
      { name: "공지문", prompt: "공지문 작성해줘" },
      { name: "계약서 공정성 분석", prompt: "업로드한 계약서 공정성 분석해줘" },
      { name: "지원사업 추천", prompt: "지원사업 추천해줘" },
      { name: "행정 신청서", prompt: "행정 신청서 작성해줘" },
      { name: "급여명세서", prompt: "급여명세서 만들어줘" },
      { name: "세무 캘린더", prompt: "세무 캘린더 만들어줘" },
      { name: "법률 자문", prompt: "법률 자문 받고 싶어" },
    ],
  },
];

const SUGGESTED_POOL: Record<string, string[]> = {
  recruitment: ["채용 공고 초안 작성해줘"],
  marketing: ["인스타 포스트 3개 기획해줘"],
  sales: ["이번 달 매출 요약 정리해줘"],
  documents: ["근로계약서 초안 작성해줘"],
};

const DOMAIN_ORDER = [
  "recruitment",
  "marketing",
  "sales",
  "documents",
] as const;

const pickSuggested = (): string[] =>
  DOMAIN_ORDER.map((d) => {
    const pool = SUGGESTED_POOL[d];
    return pool[Math.floor(Math.random() * pool.length)];
  });

function parseSalesAction(text: string): {
  clean: string;
  action: SalesActionData | undefined;
} {
  const PREFIX = "[ACTION:OPEN_SALES_TABLE:";
  const start = text.indexOf(PREFIX);
  if (start === -1) return { clean: text, action: undefined };
  const jsonStart = start + PREFIX.length;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i;
        break;
      }
    }
  }
  if (jsonEnd === -1) return { clean: text, action: undefined };
  let markerEnd = jsonEnd + 1;
  while (markerEnd < text.length && text[markerEnd] !== "]") markerEnd++;
  markerEnd++;
  let action: SalesActionData | undefined;
  try {
    action = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch {
    /* ignore */
  }
  const clean = (text.slice(0, start) + text.slice(markerEnd)).trim();
  return { clean, action };
}

function parseCostAction(text: string): {
  clean: string;
  action: CostActionData | undefined;
} {
  const PREFIX = "[ACTION:OPEN_COST_TABLE:";
  const start = text.indexOf(PREFIX);
  if (start === -1) return { clean: text, action: undefined };
  const jsonStart = start + PREFIX.length;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i;
        break;
      }
    }
  }
  if (jsonEnd === -1) return { clean: text, action: undefined };
  let markerEnd = jsonEnd + 1;
  while (markerEnd < text.length && text[markerEnd] !== "]") markerEnd++;
  markerEnd++;
  let action: CostActionData | undefined;
  try {
    action = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch {
    /* ignore */
  }
  const clean = (text.slice(0, start) + text.slice(markerEnd)).trim();
  return { clean, action };
}

const MIN_TEXTAREA = 56;
const MAX_TEXTAREA = 160;

// 초기 상태에서 보여줄 빈 메시지 리스트 — 실제 메시지 대신 추천 프롬프트 블록을 중앙에 렌더
const emptyMessages = (): Message[] => [];

const isOtherChoice = (choice: string) =>
  /^기타\b/.test(choice) || choice.includes("직접 입력");

const adjustHeight = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = `${MIN_TEXTAREA}px`;
  const next = Math.min(Math.max(el.scrollHeight, MIN_TEXTAREA), MAX_TEXTAREA);
  el.style.height = `${next}px`;
};

export const InlineChat = () => {
  const {
    registerSender,
    currentSessionId,
    setCurrentSessionId,
    setSessions,
    newSessionTick,
    loadSessionTick,
    pendingLoadSessionId,
    pendingBriefing,
    consumeBriefing,
    setLastSpeaker,
  } = useChat();

  const [messages, setMessages] = useState<Message[]>(emptyMessages);
  const [initialSuggestions, setInitialSuggestions] = useState<string[]>(() =>
    pickSuggested(),
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<string>("auto");
  const [userId, setUserId] = useState<string | null>(null);
  const [showSalesTable, setShowSalesTable] = useState(false);
  const [salesTableData, setSalesTableData] = useState<SalesActionData | null>(
    null,
  );
  const [showCostTable, setShowCostTable] = useState(false);
  const [costTableData, setCostTableData] = useState<CostActionData | null>(
    null,
  );
  const { openDetail } = useNodeDetail();
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  // v0.10 — 업로드된 문서는 이제 DB artifact 로 만들지 않고, 다음 chat POST 에
  // upload_payload 로 실어 보낸다. 리뷰가 완료되면(응답에 [[REVIEW_JSON]] 등장) 클리어.
  // sessionStorage 에 미러링해서 탭 새로고침에도 살아남게 한다.
  const PENDING_UPLOAD_KEY = "boss2:pending-upload";
  const PENDING_RECEIPT_KEY = "boss2:pending-receipt";
  const pendingUploadRef = useRef<Record<string, unknown> | null>(null);
  const pendingReceiptRef = useRef<Record<string, unknown> | null>(null);
  // SalesInputTable / CostInputTable Save 경로. 한 번에 하나만 대기.
  const pendingSaveRef = useRef<Record<string, unknown> | null>(null);
  const setPendingUpload = useCallback(
    (payload: Record<string, unknown> | null) => {
      pendingUploadRef.current = payload;
      try {
        if (payload)
          sessionStorage.setItem(PENDING_UPLOAD_KEY, JSON.stringify(payload));
        else sessionStorage.removeItem(PENDING_UPLOAD_KEY);
      } catch {
        /* storage 사용 불가 환경은 ref 만 사용 */
      }
    },
    [],
  );
  const setPendingReceipt = useCallback(
    (payload: Record<string, unknown> | null) => {
      pendingReceiptRef.current = payload;
      try {
        if (payload)
          sessionStorage.setItem(PENDING_RECEIPT_KEY, JSON.stringify(payload));
        else sessionStorage.removeItem(PENDING_RECEIPT_KEY);
      } catch {
        /* noop */
      }
    },
    [],
  );
  // mount 시 sessionStorage 에서 복원
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_UPLOAD_KEY);
      if (raw)
        pendingUploadRef.current = JSON.parse(raw) as Record<string, unknown>;
      const rawR = sessionStorage.getItem(PENDING_RECEIPT_KEY);
      if (rawR)
        pendingReceiptRef.current = JSON.parse(rawR) as Record<string, unknown>;
    } catch {
      /* noop */
    }
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<
    ((text: string, messageIndex?: number) => Promise<void>) | null
  >(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const fetchSessions = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(
        `${apiBase}/api/chat/sessions?account_id=${userId}&limit=50`,
      );
      const json = await res.json();
      setSessions(json?.data ?? []);
    } catch {
      /* noop */
    }
  }, [apiBase, userId, setSessions]);

  useEffect(() => {
    if (userId) fetchSessions();
  }, [userId, fetchSessions]);

  useEffect(() => {
    if (pendingBriefing) {
      setMessages([{ role: "assistant", content: pendingBriefing }]);
      consumeBriefing();
      setCurrentSessionId(null);
    }
  }, [pendingBriefing, consumeBriefing, setCurrentSessionId]);

  useEffect(() => {
    if (newSessionTick === 0) return;
    setMessages(emptyMessages());
    setInitialSuggestions(pickSuggested());
    setInput("");
    setStagedFiles([]);
    setLastSpeaker(null);
    adjustHeight(textareaRef.current);
    textareaRef.current?.focus();
  }, [newSessionTick, setLastSpeaker]);

  useEffect(() => {
    if (loadSessionTick === 0 || !pendingLoadSessionId || !userId) return;
    const id = pendingLoadSessionId;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${apiBase}/api/chat/sessions/${id}/messages?account_id=${userId}`,
        );
        const json = await res.json();
        const msgs = json?.data?.messages ?? [];
        const mapped: Message[] = msgs.map(
          (m: {
            role: string;
            content: string;
            choices?: string[] | null;
            attachment?: {
              filename?: string;
              size_kb?: number | null;
              status?: "uploading" | "done" | "error";
            } | null;
          }) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
            choices: m.choices ?? undefined,
            attachment: m.attachment?.filename
              ? {
                  status: m.attachment.status ?? "done",
                  filename: m.attachment.filename,
                  sizeKb: m.attachment.size_kb ?? undefined,
                }
              : undefined,
          }),
        );
        // 마지막 assistant 메시지의 speaker 로 배지 복원
        const lastAssistant = [...msgs]
          .reverse()
          .find(
            (m: { role: string; speaker?: string[] | null }) =>
              m.role === "assistant",
          );
        const sp = (lastAssistant as { speaker?: string[] | null } | undefined)
          ?.speaker;
        setLastSpeaker(
          sp && sp.length
            ? (sp as (
                | "orchestrator"
                | "recruitment"
                | "marketing"
                | "sales"
                | "documents"
              )[])
            : null,
        );
        setCurrentSessionId(id);
        setMessages(mapped.length ? mapped : emptyMessages());
        if (mapped.length === 0) setInitialSuggestions(pickSuggested());
      } catch {
        setMessages(emptyMessages());
        setInitialSuggestions(pickSuggested());
        setLastSpeaker(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [
    loadSessionTick,
    pendingLoadSessionId,
    userId,
    apiBase,
    setCurrentSessionId,
    setLastSpeaker,
  ]);

  const analyzeReviewImage = useCallback(
    async (file: File) => {
      if (!userId) return;
      const placeholderIdx = messages.length;
      setMessages((prev) => [
        ...prev,
        {
          role: "user" as const,
          content: "",
          attachment: { status: "uploading", filename: file.name },
        },
      ]);
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${apiBase}/api/marketing/review/analyze`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        setMessages((prev) => {
          const next = [...prev];
          if (next[placeholderIdx]) {
            next[placeholderIdx] = {
              ...next[placeholderIdx],
              attachment: { status: "done", filename: file.name },
            };
          }
          return next;
        });

        if (data.error) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `⚠️ ${data.error}` },
          ]);
          return;
        }

        const platformLabel: Record<string, string> = {
          naver: "네이버 플레이스",
          kakao: "카카오맵",
          google: "구글맵",
          other: "플랫폼",
        };
        const platform = platformLabel[data.platform] ?? "플랫폼";
        const stars = data.star_rating
          ? `별점 ${data.star_rating}점`
          : "별점 미확인";
        const reviewText = data.review_text
          ? `\n리뷰 내용: ${data.review_text}`
          : "";

        await sendRef.current?.(
          `${platform} ${stars} 리뷰 답글 작성해줘.${reviewText}`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "분석 실패";
        setMessages((prev) => {
          const next = [...prev];
          if (next[placeholderIdx]) {
            next[placeholderIdx] = {
              ...next[placeholderIdx],
              attachment: { status: "error", filename: file.name, error: msg },
            };
          }
          return next;
        });
      } finally {
        setUploading(false);
      }
    },
    [apiBase, userId, messages.length],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!userId || uploading || loading) return;
      if (files.length === 0) return;

      const oversize = files.find((f) => f.size > UPLOAD_MAX_MB * 1024 * 1024);
      if (oversize) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `"${oversize.name}" 가 너무 큽니다 (${UPLOAD_MAX_MB}MB 이하만 업로드 가능).`,
          },
        ]);
        return;
      }

      setUploading(true);

      const firstPlaceholderIndex = messages.length;
      setMessages((prev) => [
        ...prev,
        ...files.map<Message>((f) => ({
          role: "user",
          content: "",
          attachment: {
            status: "uploading",
            filename: f.name,
            sizeKb: Math.round(f.size / 1024),
          },
        })),
      ]);

      try {
        const form = new FormData();
        form.append("account_id", userId);
        form.append("user_declared_type", uploadType);
        for (const f of files) form.append("files", f);

        const res = await fetch(`${apiBase}/api/uploads/document`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: "업로드 실패" }));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
        const json = await res.json();
        const data = json?.data ?? {};
        const items: Array<{
          artifact_id: string | null;
          title: string;
          classification?: {
            category: UploadCategory;
            doc_type: string;
            auto?: {
              category: UploadCategory;
              doc_type: string;
              confidence: number;
            };
          };
          needs_confirmation?: boolean;
          final_category?: UploadCategory;
          // v0.10 ephemeral 업로드 — 다음 chat POST 에 실어 보낼 payload 필드들
          content?: string;
          storage_path?: string;
          bucket?: string;
          mime_type?: string;
          size_bytes?: number;
          original_name?: string;
          parsed_len?: number;
        }> = Array.isArray(data.items) ? data.items : [];
        const errors: Array<{ filename?: string; detail?: string }> =
          Array.isArray(data.errors) ? data.errors : [];

        setMessages((prev) => {
          const next = [...prev];
          files.forEach((f, i) => {
            const idx = firstPlaceholderIndex + i;
            const errMatch = errors.find((e) => e.filename === f.name);
            if (next[idx]) {
              next[idx] = {
                ...next[idx],
                attachment: {
                  status: errMatch ? "error" : "done",
                  filename: f.name,
                  sizeKb: Math.round(f.size / 1024),
                  error: errMatch?.detail,
                },
              };
            }
          });
          return next;
        });

        window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));

        // v0.10 — artifact 가 생성된 legacy 케이스만 confirm 흐름 사용.
        // 새 업로드 경로(artifact_id=null)에서는 classification 이 바로 final_category 로 확정된다.
        const confirms = items.filter(
          (it): it is typeof it & { artifact_id: string } =>
            !!it.needs_confirmation && typeof it.artifact_id === "string",
        );
        const docsOk = items.filter(
          (it) => !it.needs_confirmation && it.final_category === "documents",
        );

        // v0.10 — 가장 최근에 업로드된 documents 파일을 pending upload 로 저장.
        // (현재는 한 번에 하나만 리뷰하므로 마지막 것만 유지)
        const latestDoc = docsOk[docsOk.length - 1];
        if (latestDoc && latestDoc.content && latestDoc.storage_path) {
          setPendingUpload({
            title: latestDoc.title,
            content: latestDoc.content,
            storage_path: latestDoc.storage_path,
            bucket: latestDoc.bucket,
            mime_type: latestDoc.mime_type,
            size_bytes: latestDoc.size_bytes,
            original_name: latestDoc.original_name,
            parsed_len: latestDoc.parsed_len,
            classification: latestDoc.classification,
            uploaded_at: new Date().toISOString(),
          });
        }
        const nonDocs = items.filter(
          (it) =>
            !it.needs_confirmation &&
            it.final_category &&
            it.final_category !== "documents",
        );

        if (confirms.length > 0) {
          setMessages((prev) => [
            ...prev,
            ...confirms.map<Message>((it) => {
              const auto = it.classification?.auto;
              const autoCategory = (auto?.category ??
                "other") as UploadCategory;
              const autoDocType =
                auto?.doc_type ?? CATEGORY_LABEL[autoCategory];
              const userCategory = (it.final_category ??
                "other") as UploadCategory;
              const userDocType =
                it.classification?.doc_type ?? CATEGORY_LABEL[userCategory];
              return {
                role: "assistant",
                content: `"${it.title}" — 자동 분류는 **${autoDocType}**, 선택하신 건 **${userDocType}** 인데 어느 쪽이 맞나요?`,
                choices: [
                  `자동 분류(${autoDocType})`,
                  `내 선택(${userDocType})`,
                ],
                confirm: {
                  artifactId: it.artifact_id,
                  autoCategory,
                  autoDocType,
                  userCategory,
                  userDocType,
                },
              };
            }),
          ]);
        }

        const receiptItems = nonDocs.filter(
          (it) => it.final_category === "receipt",
        );
        const otherNonDocs = nonDocs.filter(
          (it) => it.final_category !== "receipt",
        );

        if (otherNonDocs.length > 0) {
          const lines = otherNonDocs.map((it) => {
            const cat = (it.final_category ?? "other") as UploadCategory;
            return `- **${it.title}** → ${NON_DOC_HINT[cat] ?? "저장만 해뒀어요."}`;
          });
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: lines.join("\n") },
          ]);
        }

        if (receiptItems.length > 0 && userId) {
          // v1.0.2 — OCR 은 이제 sales agent 의 `sales_parse_receipt` capability 가 수행.
          // 프론트는 storage 메타만 pendingReceiptRef 에 담고 chat 으로 라우팅한다.
          const latestReceipt = receiptItems[receiptItems.length - 1];
          if (latestReceipt.storage_path) {
            setPendingReceipt({
              storage_path: latestReceipt.storage_path,
              bucket: latestReceipt.bucket,
              mime_type: latestReceipt.mime_type,
              original_name: latestReceipt.original_name,
              size_bytes: latestReceipt.size_bytes,
            });
            await sendRef.current?.(
              `방금 업로드한 영수증 "${latestReceipt.title}" 을 매출/비용으로 기록해줘.`,
            );
          }
        }

        if (docsOk.length === 1 && confirms.length === 0) {
          const autoMessage = `방금 업로드한 "${docsOk[0].title}" 문서를 공정성 분석해주세요.`;
          await sendRef.current?.(autoMessage);
        } else if (docsOk.length > 1) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `문서 ${docsOk.length}개가 업로드됐어요. 어느 문서부터 분석할까요?`,
              choices: docsOk.map((it) => `"${it.title}" 분석해줘`),
            },
          ]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "업로드 실패";
        setMessages((prev) => {
          const next = [...prev];
          files.forEach((f, i) => {
            const idx = firstPlaceholderIndex + i;
            if (next[idx]) {
              next[idx] = {
                ...next[idx],
                attachment: {
                  status: "error",
                  filename: f.name,
                  sizeKb: Math.round(f.size / 1024),
                  error: msg,
                },
              };
            }
          });
          return next;
        });
      } finally {
        setUploading(false);
      }
    },
    [apiBase, userId, uploading, loading, messages.length, uploadType],
  );

  const send = useCallback(
    async (text: string, messageIndex?: number) => {
      const trimmed = text.trim();
      if ((!trimmed && stagedFiles.length === 0) || loading || !userId) return;

      if (stagedFiles.length > 0) {
        const files = [...stagedFiles];
        setStagedFiles([]);
        setInput("");
        adjustHeight(textareaRef.current);

        const textLower = trimmed.toLowerCase();
        const recentText = messages
          .slice(-6)
          .map((m) => m.content)
          .join(" ")
          .toLowerCase();
        const hasReviewCtx =
          textLower.includes("리뷰") || recentText.includes("리뷰");

        if (
          files.length === 1 &&
          files[0].type.startsWith("image/") &&
          hasReviewCtx
        ) {
          if (trimmed) {
            setMessages((prev) => [
              ...prev,
              { role: "user" as const, content: trimmed },
            ]);
          }
          await analyzeReviewImage(files[0]);
          return;
        }
        await uploadFiles(files);
        if (trimmed) {
          await send(trimmed, messageIndex);
        }
        return;
      }

      if (!trimmed) return;
      setInput("");
      adjustHeight(textareaRef.current);
      setMessages((prev) => {
        const next = [...prev, { role: "user" as const, content: trimmed }];
        if (messageIndex !== undefined && next[messageIndex]) {
          next[messageIndex] = { ...next[messageIndex], choices: undefined };
        }
        return next;
      });
      setLoading(true);

      try {
        const chatBody: Record<string, unknown> = {
          message: trimmed,
          account_id: userId,
          session_id: currentSessionId,
        };
        if (pendingUploadRef.current) {
          chatBody.upload_payload = pendingUploadRef.current;
        }
        if (pendingReceiptRef.current) {
          chatBody.receipt_payload = pendingReceiptRef.current;
        }
        if (pendingSaveRef.current) {
          chatBody.save_payload = pendingSaveRef.current;
        }
        const res = await fetch(`${apiBase}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatBody),
        });
        const data = await res.json();
        const _replyPeek: string = data?.data?.reply ?? "";
        // 문서 리뷰 완료 → upload_payload 클리어
        if (
          pendingUploadRef.current &&
          _replyPeek.includes("[[REVIEW_JSON]]")
        ) {
          setPendingUpload(null);
        }
        // 영수증 파싱 완료 (ACTION 마커 emit) → receipt_payload 클리어
        if (
          pendingReceiptRef.current &&
          (_replyPeek.includes("[ACTION:OPEN_SALES_TABLE") ||
            _replyPeek.includes("[ACTION:OPEN_COST_TABLE"))
        ) {
          setPendingReceipt(null);
        }
        // 저장 완료 → save_payload 클리어
        if (
          pendingSaveRef.current &&
          (_replyPeek.includes("저장됐어요") ||
            _replyPeek.includes("중복은 건너뛰"))
        ) {
          pendingSaveRef.current = null;
        }
        const newSessionId: string | undefined = data?.data?.session_id;
        const sessionCreated: boolean = !!data?.data?.session_created;
        if (newSessionId && newSessionId !== currentSessionId) {
          setCurrentSessionId(newSessionId);
        }
        const rawReply = data?.data?.reply ?? "응답을 받지 못했습니다.";
        const { clean: afterSales, action: salesAction } =
          parseSalesAction(rawReply);
        const { clean: afterCost, action: costAction } =
          parseCostAction(afterSales);
        const { cleaned: afterShorts, payload: shortsWizard } =
          extractShortsWizardPayload(afterCost);
        const { cleaned: afterMenu, payload: menuChart } =
          extractMenuChartPayload(afterShorts);
        const { cleaned: cleanReply, payload: employeePicker } =
          extractEmployeePickerPayload(afterMenu);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: cleanReply,
            choices: data?.data?.choices?.length
              ? data.data.choices
              : undefined,
            salesAction,
            costAction,
            shortsWizard: shortsWizard ?? undefined,
            menuChart: menuChart ?? undefined,
            employeePicker: employeePicker ?? undefined,
          },
        ]);
        const sp = data?.data?.speaker;
        if (Array.isArray(sp) && sp.length) {
          setLastSpeaker(
            sp as (
              | "orchestrator"
              | "recruitment"
              | "marketing"
              | "sales"
              | "documents"
            )[],
          );
        }
        window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
        if (sessionCreated) {
          setTimeout(fetchSessions, 1200);
        } else {
          fetchSessions();
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "서버 연결 오류가 발생했습니다." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [
      apiBase,
      currentSessionId,
      fetchSessions,
      loading,
      messages,
      setCurrentSessionId,
      stagedFiles,
      analyzeReviewImage,
      uploadFiles,
      userId,
      setLastSpeaker,
    ],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    return registerSender((text: string) => {
      send(text);
    });
  }, [registerSender, send]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    // FileList 는 live 객체 — `e.target.value = ""` 로 input 을 리셋하면 비워진다.
    // StrictMode 의 updater 이중 호출 시 두 번째 호출에서 [] 가 되지 않도록
    // 여기서 바로 plain array 로 스냅샷한다.
    const picked = Array.from(list);
    e.target.value = "";
    setStagedFiles((prev) => [...prev, ...picked]);
    textareaRef.current?.focus();
  };

  const removeStagedFile = (idx: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const confirmClassification = useCallback(
    async (messageIndex: number, chosen: "auto" | "user") => {
      const msg = messages[messageIndex];
      if (!msg?.confirm || !userId) return;
      const {
        artifactId,
        autoCategory,
        autoDocType,
        userCategory,
        userDocType,
      } = msg.confirm;
      const finalCategory = chosen === "auto" ? autoCategory : userCategory;
      const finalDocType = chosen === "auto" ? autoDocType : userDocType;

      setMessages((prev) => {
        const next = [...prev];
        if (next[messageIndex]) {
          next[messageIndex] = {
            ...next[messageIndex],
            choices: undefined,
            confirm: undefined,
            content: `${next[messageIndex].content}\n\n→ **${finalDocType}** 로 확정했어요.`,
          };
        }
        return next;
      });

      try {
        await fetch(
          `${apiBase}/api/uploads/document/${artifactId}/classification?account_id=${userId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: finalCategory,
              doc_type: finalDocType,
            }),
          },
        );
        window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
      } catch {
        /* noop */
      }

      if (finalCategory === "documents") {
        await send(`방금 업로드한 문서를 공정성 분석해주세요.`);
      } else {
        const hint = NON_DOC_HINT[finalCategory];
        if (hint) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: hint },
          ]);
        }
      }
    },
    [apiBase, messages, send, userId],
  );

  const handleChoiceClick = (choice: string, messageIndex: number) => {
    const msg = messages[messageIndex];
    if (msg?.confirm) {
      confirmClassification(
        messageIndex,
        choice.startsWith("자동 분류") ? "auto" : "user",
      );
      return;
    }
    if (isOtherChoice(choice)) {
      setMessages((prev) => {
        const next = [...prev];
        if (next[messageIndex]) {
          next[messageIndex] = { ...next[messageIndex], choices: undefined };
        }
        return next;
      });
      textareaRef.current?.focus();
      return;
    }
    send(choice, messageIndex);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    const files = imageItems
      .map((item) => {
        const file = item.getAsFile();
        if (!file) return null;
        const ext = file.type.split("/")[1] ?? "png";
        const name = `screenshot-${Date.now()}.${ext}`;
        return new File([file], name, { type: file.type });
      })
      .filter((f): f is File => f !== null);
    if (files.length > 0) {
      e.preventDefault();
      setStagedFiles((prev) => [...prev, ...files]);
    }
  };

  const canSend = useMemo(
    () => !loading && (!!input.trim() || stagedFiles.length > 0),
    [loading, input, stagedFiles],
  );

  return (
    <>
      {showSalesTable && salesTableData && (
        <SalesInputTable
          data={salesTableData}
          onClose={() => setShowSalesTable(false)}
          onConfirm={(items, date) => {
            pendingSaveRef.current = {
              kind: "revenue",
              recorded_date: date,
              items,
              source: "chat",
            };
            setShowSalesTable(false);
            sendRef.current?.(`확인한 매출 ${items.length}건 저장해줘.`);
          }}
        />
      )}
      {showCostTable && costTableData && (
        <CostInputTable
          data={costTableData}
          onClose={() => setShowCostTable(false)}
          onConfirm={(items, date) => {
            pendingSaveRef.current = {
              kind: "cost",
              recorded_date: date,
              items,
              source: "chat",
            };
            setShowCostTable(false);
            sendRef.current?.(`확인한 비용 ${items.length}건 저장해줘.`);
          }}
        />
      )}
      <div className="flex h-full min-h-0 flex-col">
        {messages.length === 0 && !loading ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
            <div className="mb-4 text-center font-mono text-lg font-semibold uppercase tracking-[0.15em] text-[#030303]/70">
              Ask the chatbot.
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex max-w-md flex-col gap-4 pb-2">
                {DOMAIN_CAPABILITIES.map((domain) => (
                  <div key={domain.label}>
                    <div
                      className="mb-2 inline-block rounded-[4px] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: domain.bg,
                        color: domain.accent,
                      }}
                    >
                      {domain.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {domain.items.map((item) => (
                        <button
                          key={item.name}
                          type="button"
                          disabled={loading}
                          onClick={() => send(item.prompt)}
                          className="rounded-[5px] border border-[#030303]/[0.07] bg-[#fcfcfc] px-2.5 py-1 text-[12px] text-[#030303]/75 transition-colors hover:bg-[#030303]/[0.05] hover:text-[#030303] disabled:opacity-40"
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <ScrollArea
          className={cn(
            "min-h-0 flex-1 px-3 py-2",
            messages.length === 0 && !loading && "hidden",
          )}
          viewportRef={scrollViewportRef}
        >
          <div className="space-y-2.5">
            {messages.map((msg, i) => {
              let displayText = msg.content;
              let reviewPayload: ReviewPayload | null = msg.review ?? null;
              let instagramPayload: InstagramPayload | null =
                msg.instagram ?? null;
              let reviewReplyPayload: ReviewReplyPayload | null =
                msg.reviewReply ?? null;
              let menuChartPayload: MenuAnalysisPayload | null =
                msg.menuChart ?? null;

              const isOnboardingForm =
                msg.role === "assistant" &&
                (displayText || "").includes("[[ONBOARDING_FORM]]");
              if (isOnboardingForm) {
                displayText = (displayText || "")
                  .replace("[[ONBOARDING_FORM]]", "")
                  .trim();
              }

              if (msg.role === "assistant") {
                const rrExtracted = extractReviewReplyPayload(
                  displayText || "",
                );
                displayText = rrExtracted.cleaned;
                if (rrExtracted.payload)
                  reviewReplyPayload = rrExtracted.payload;

                const igExtracted = extractInstagramPayload(displayText || "");
                displayText = igExtracted.cleaned;
                if (igExtracted.payload) instagramPayload = igExtracted.payload;

                const rvExtracted = extractReviewPayload(displayText || "");
                displayText = rvExtracted.cleaned;
                if (rvExtracted.payload) reviewPayload = rvExtracted.payload;

                const mcExtracted = extractMenuChartPayload(displayText || "");
                displayText = mcExtracted.cleaned;
                if (mcExtracted.payload) menuChartPayload = mcExtracted.payload;
              }

              return (
                <div key={i} className="space-y-1.5">
                  <div
                    className={cn(
                      "flex gap-2",
                      msg.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7f8f54]/20">
                        <Bot className="h-3.5 w-3.5 text-[#6a7843]" />
                      </div>
                    )}
                    {msg.attachment ? (
                      <div
                        className={cn(
                          "flex max-w-[85%] items-center gap-2 rounded-[5px] border px-3 py-2 text-sm",
                          msg.attachment.status === "error"
                            ? "border-[#d9a191] bg-[#f4dcd2] text-[#8a3a28]"
                            : msg.attachment.status === "uploading"
                              ? "border-[#030303]/10 bg-[#fcfcfc] text-[#030303]/70"
                              : "border-[#bccab6] bg-[#e3ece2] text-[#3b6a4a]",
                        )}
                      >
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium">
                            {msg.attachment.filename}
                          </div>
                          <div className="text-[10px] opacity-70">
                            {msg.attachment.sizeKb
                              ? `${msg.attachment.sizeKb} KB · `
                              : ""}
                            {msg.attachment.status === "uploading"
                              ? "업로드 중..."
                              : msg.attachment.status === "error"
                                ? msg.attachment.error || "실패"
                                : "업로드 완료"}
                          </div>
                        </div>
                        {msg.attachment.status === "uploading" && (
                          <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" />
                        )}
                      </div>
                    ) : displayText ? (
                      <div
                        className={cn(
                          "max-w-[85%] rounded-[5px] px-3 py-2 text-[13px] leading-relaxed",
                          msg.role === "user"
                            ? "whitespace-pre-wrap bg-[#030303] text-[#fcfcfc]"
                            : "bg-[#f1ece2] text-[#030303]",
                        )}
                      >
                        {msg.role === "assistant" ? (
                          <MarkdownMessage content={displayText} />
                        ) : (
                          displayText
                        )}
                      </div>
                    ) : null}
                  </div>
                  {reviewPayload && msg.role === "assistant" && (
                    <div className="ml-8 max-w-[85%]">
                      <ReviewResultCard payload={reviewPayload} />
                    </div>
                  )}
                  {instagramPayload && msg.role === "assistant" && (
                    <div className="ml-8">
                      <InstagramPostCard payload={instagramPayload} />
                    </div>
                  )}
                  {reviewReplyPayload && msg.role === "assistant" && (
                    <div className="ml-8 max-w-[85%]">
                      <ReviewReplyCard payload={reviewReplyPayload} />
                    </div>
                  )}
                  {isOnboardingForm && userId && (
                    <div className="ml-8">
                      <OnboardingFormCard
                        accountId={userId}
                        onComplete={(summary) => {
                          setMessages((prev) => [
                            ...prev,
                            {
                              role: "assistant" as const,
                              content: `프로필이 저장됐어요! (${summary})\n\n이제 맞춤 도움을 드릴 수 있어요. 무엇부터 시작할까요?`,
                            },
                          ]);
                        }}
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.employeePicker && userId && (
                    <div className="ml-8 max-w-[85%]">
                      <EmployeePickerCard
                        payload={msg.employeePicker}
                        accountId={userId}
                        onConfirm={(confirmMsg) => send(confirmMsg, i)}
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.shortsWizard && (
                    <div className="ml-8">
                      <ShortsWizardCard payload={msg.shortsWizard} />
                    </div>
                  )}
                  {msg.role === "assistant" && menuChartPayload && (
                    <div className="ml-8 max-w-[85%]">
                      <MenuAnalysisCard payload={menuChartPayload} />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.choices && (
                    <div
                      className={cn(
                        "ml-8 gap-1.5",
                        msg.suggested
                          ? "flex w-1/2 flex-col"
                          : "grid grid-cols-2",
                      )}
                    >
                      {msg.choices.map((choice, idx) => (
                        <Button
                          key={idx}
                          variant="outline"
                          size="sm"
                          disabled={loading}
                          onClick={() => handleChoiceClick(choice, i)}
                          className={cn(
                            "h-auto justify-start whitespace-normal rounded-[5px] py-1.5 px-2.5 text-left text-[12px] font-normal leading-snug",
                            "border-[#030303]/10 bg-[#fcfcfc] text-[#030303] hover:bg-[#030303]/[0.05] hover:text-[#030303]",
                            isOtherChoice(choice) &&
                              !msg.suggested &&
                              "col-span-2 border-dashed text-[#030303]/60",
                          )}
                        >
                          {choice}
                        </Button>
                      ))}
                    </div>
                  )}
                  {msg.role === "assistant" && msg.savedArtifactId && (
                    <div className="ml-8 mt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (msg.savedArtifactId) {
                            openDetail(msg.savedArtifactId);
                          } else if (msg.savedDomain) {
                            window.location.href = `/${msg.savedDomain}`;
                          }
                        }}
                        className="rounded-[5px] border-[#030303]/15 bg-white text-[#030303]/70 hover:bg-[#030303]/[0.05] hover:text-[#030303] text-xs font-medium"
                      >
                        Open detail
                      </Button>
                    </div>
                  )}
                  {msg.role === "assistant" && msg.salesAction && (
                    <div className="ml-8 flex flex-col gap-1.5">
                      {msg.salesAction.items.length > 0 && (
                        <div className="overflow-hidden rounded-[5px] border border-[#030303]/10 bg-white">
                          <div className="flex items-center justify-between border-b border-[#030303]/[0.08] px-3 py-1.5">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                              Revenue preview
                            </span>
                            <span className="font-mono text-[11px] text-[#030303]/60">
                              {msg.salesAction.date}
                            </span>
                          </div>
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-[#030303]/10 text-left font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                                <th className="px-3 py-1.5 font-medium">
                                  Item
                                </th>
                                <th className="px-3 py-1.5 font-medium">
                                  Category
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  Qty
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  Unit
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  Amount
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {msg.salesAction.items.map((it, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-[#030303]/5 last:border-b-0"
                                >
                                  <td className="px-3 py-1.5 text-[#030303]">
                                    {it.item_name}
                                  </td>
                                  <td className="px-3 py-1.5 text-[#030303]/70">
                                    {it.category}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]">
                                    {it.quantity}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]">
                                    {it.unit_price.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]">
                                    {(
                                      it.quantity * it.unit_price
                                    ).toLocaleString()}
                                    <span className="ml-1 text-[10px] uppercase tracking-wider text-[#030303]/50">
                                      won
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-[#030303]/10 bg-[#f4f1ed]">
                                <td
                                  colSpan={4}
                                  className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-wider text-[#030303]/60"
                                >
                                  Total
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[13px] font-semibold text-[#030303]">
                                  {msg.salesAction.items
                                    .reduce(
                                      (s, it) =>
                                        s + it.quantity * it.unit_price,
                                      0,
                                    )
                                    .toLocaleString()}
                                  <span className="ml-1 text-[10px] uppercase tracking-wider text-[#030303]/50">
                                    won
                                  </span>
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5">
                        {msg.salesAction.items.length === 0 ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={loading}
                              onClick={() => {
                                send("오늘 매출 글로 입력하기");
                              }}
                              className="w-full rounded-[5px] border-[#6e6254] bg-[#f3f0ec] text-[#6e6254] hover:bg-[#e8e3db] text-xs font-medium disabled:opacity-40"
                            >
                              Type it out
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSalesTableData(msg.salesAction!);
                                setShowSalesTable(true);
                              }}
                              className="w-full rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium disabled:opacity-40"
                            >
                              Enter in table
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={loading}
                              onClick={() => {
                                const action = msg.salesAction!;
                                pendingSaveRef.current = {
                                  kind: "revenue",
                                  recorded_date: action.date,
                                  items: action.items.map((it) => ({
                                    item_name: it.item_name,
                                    category: it.category,
                                    quantity: it.quantity,
                                    unit_price: it.unit_price,
                                    amount: it.quantity * it.unit_price,
                                    recorded_date: action.date,
                                    source: "chat",
                                  })),
                                  source: "chat",
                                };
                                sendRef.current?.(
                                  `확인한 매출 ${action.items.length}건 저장해줘.`,
                                );
                              }}
                              className="w-full rounded-[5px] border-[#547244] bg-[#edf2e8] text-[#547244] hover:bg-[#dde9d1] text-xs font-medium disabled:opacity-40"
                            >
                              Save
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSalesTableData(msg.salesAction!);
                                setShowSalesTable(true);
                              }}
                              className="w-full rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium disabled:opacity-40"
                            >
                              Edit in table
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {msg.role === "assistant" && msg.costAction && (
                    <div className="ml-8 flex flex-col gap-1.5">
                      {msg.costAction.items.length > 0 && (
                        <div className="overflow-hidden rounded-[5px] border border-[#030303]/10 bg-white">
                          <div className="flex items-center justify-between border-b border-[#030303]/[0.08] px-3 py-1.5">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                              Cost preview
                            </span>
                            <span className="font-mono text-[11px] text-[#030303]/60">
                              {msg.costAction.date}
                            </span>
                          </div>
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-[#030303]/10 text-left font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                                <th className="px-3 py-1.5 font-medium">
                                  Item
                                </th>
                                <th className="px-3 py-1.5 font-medium">
                                  Category
                                </th>
                                <th className="px-3 py-1.5 font-medium">
                                  Memo
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  Amount
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {msg.costAction.items.map((it, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-[#030303]/5 last:border-b-0"
                                >
                                  <td className="px-3 py-1.5 text-[#030303]">
                                    {it.item_name}
                                  </td>
                                  <td className="px-3 py-1.5 text-[#030303]/70">
                                    {it.category}
                                  </td>
                                  <td className="px-3 py-1.5 text-[#030303]/60">
                                    {it.memo}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]">
                                    {it.amount.toLocaleString()}
                                    <span className="ml-1 text-[10px] uppercase tracking-wider text-[#030303]/50">
                                      won
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-[#030303]/10 bg-[#f4f1ed]">
                                <td
                                  colSpan={3}
                                  className="px-3 py-1.5 text-right font-mono text-[10px] uppercase tracking-wider text-[#030303]/60"
                                >
                                  Total
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[13px] font-semibold text-[#030303]">
                                  {msg.costAction.items
                                    .reduce((s, it) => s + it.amount, 0)
                                    .toLocaleString()}
                                  <span className="ml-1 text-[10px] uppercase tracking-wider text-[#030303]/50">
                                    won
                                  </span>
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5">
                        {msg.costAction.items.length === 0 ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCostTableData(msg.costAction!);
                              setShowCostTable(true);
                            }}
                            className="col-span-2 w-full rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium disabled:opacity-40"
                          >
                            Enter in table
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={loading}
                              onClick={() => {
                                const action = msg.costAction!;
                                pendingSaveRef.current = {
                                  kind: "cost",
                                  recorded_date: action.date,
                                  items: action.items.map((it) => ({
                                    item_name: it.item_name,
                                    category: it.category,
                                    amount: it.amount,
                                    memo: it.memo,
                                    recorded_date: action.date,
                                    source: "chat",
                                  })),
                                  source: "chat",
                                };
                                sendRef.current?.(
                                  `확인한 비용 ${action.items.length}건 저장해줘.`,
                                );
                              }}
                              className="w-full rounded-[5px] border-[#547244] bg-[#edf2e8] text-[#547244] hover:bg-[#dde9d1] text-xs font-medium disabled:opacity-40"
                            >
                              Save
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCostTableData(msg.costAction!);
                                setShowCostTable(true);
                              }}
                              className="w-full rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium disabled:opacity-40"
                            >
                              Edit in table
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {loading && (
              <div className="flex justify-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#7f8f54]/20">
                  <Bot className="h-3.5 w-3.5 text-[#6a7843]" />
                </div>
                <div className="rounded-[5px] bg-[#f1ece2] px-3 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#030303]/60" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="bg-[#fcfcfc] px-3 py-2">
          <div className="relative rounded-[5px] border border-[#030303]/30 bg-[#ffffff] focus-within:border-[#030303]/50">
            {stagedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-[#030303]/10 px-2.5 pt-2 pb-1.5">
                {stagedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-[5px] border border-[#030303]/10 bg-[#fcfcfc] px-2 py-1 text-[11.5px] text-[#030303]"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-[#030303]/60" />
                    <span className="max-w-[140px] truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeStagedFile(i)}
                      className="ml-0.5 rounded p-0.5 hover:bg-[#030303]/[0.08]"
                      aria-label="첨부 파일 제거"
                    >
                      <X className="h-3 w-3 text-[#030303]/60" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="overflow-y-auto">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  adjustHeight(e.target);
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Type a message…"
                className={cn(
                  "w-full resize-none border-none bg-transparent px-3 py-2 text-[13px] text-[#030303]",
                  "placeholder:text-[13px] placeholder:text-[#030303]/40",
                  "focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                )}
                style={{ overflow: "hidden", minHeight: `${MIN_TEXTAREA}px` }}
              />
            </div>

            <div className="flex items-center justify-between px-2 pb-1.5">
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploading || loading || !userId}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded p-1.5 transition-colors hover:bg-[#030303]/[0.05] disabled:opacity-50"
                  aria-label="Attachment"
                  title="Attachment"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#030303]/70" />
                  ) : (
                    <Paperclip className="h-4 w-4 text-[#030303]/70" />
                  )}
                </button>
                <select
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value)}
                  disabled={uploading || loading}
                  className="rounded border border-[#030303]/10 bg-transparent px-1.5 py-0.5 text-[11px] text-[#030303]/80 focus:border-[#030303]/25 focus:outline-none disabled:opacity-50"
                  aria-label="업로드 파일 타입"
                >
                  {UPLOAD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => send(input)}
                disabled={!canSend}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-40",
                  canSend
                    ? "bg-[#030303] text-[#fcfcfc] hover:bg-[#2a2a2a]"
                    : "bg-[#030303]/[0.05] text-[#030303]/40",
                )}
                aria-label="보내기"
              >
                <ArrowUpIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="pt-1 text-center font-mono text-[9.5px] text-[#030303]/40">
            <PlusIcon className="mr-0.5 inline h-2.5 w-2.5 -translate-y-px" />
            BOSS · Orchestrator
          </div>
        </div>
      </div>
    </>
  );
};
