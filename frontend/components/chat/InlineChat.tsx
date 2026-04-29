"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowUpIcon,
  Camera,
  Loader2,
  Paperclip,
  PlusIcon,
  X,
} from "lucide-react";
import { BossAvatar, EmployeeAvatar } from "./ChatAvatars";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useChat } from "./ChatContext";
import {
  ReviewResultCard,
  extractReviewPayload,
  type ReviewPayload,
  extractAdminApplicationPayload,
  type AdminApplicationPayload,
} from "./ReviewResultCard";
import { AdminApplicationCard } from "./AdminApplicationCard";
import {
  InstagramPostCard,
  extractInstagramPayload,
  type InstagramPayload,
} from "./InstagramPostCard";
import {
  NaverBlogPostCard,
  extractNaverBlogPayload,
  type NaverBlogPayload,
} from "./NaverBlogPostCard";
import {
  ReviewReplyCard,
  extractReviewReplyPayload,
  type ReviewReplyPayload,
} from "./ReviewReplyCard";
import { MarkdownMessage } from "./MarkdownMessage";
import { SalesInputTable, type SalesActionData } from "./SalesInputTable";
import { CostInputTable, type CostActionData } from "./CostInputTable";
import { WorkTableCard, type WorkActionData } from "./WorkTableCard";
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
import {
  SalesInsightCard,
  extractInsightPayload,
  type SalesInsightPayload,
} from "./SalesInsightCard";
import {
  MarketingReportCard,
  extractMarketingReportPayload,
  type MarketingReportPayload,
} from "./MarketingReportCard";
import {
  EventPosterCard,
  extractEventPosterPayload,
  type EventPosterPayload,
} from "./EventPosterCard";
import { EventPlanFormCard, extractEventPlanForm } from "./EventPlanFormCard";
import { SnsPostFormCard, extractSnsPostForm } from "./SnsPostFormCard";
import { BlogPostFormCard, extractBlogPostForm } from "./BlogPostFormCard";
import {
  ReviewReplyFormCard,
  extractReviewReplyForm,
} from "./ReviewReplyFormCard";
import { ScheduleFormCard, extractScheduleForm } from "./ScheduleFormCard";
import { useNodeDetail } from "@/components/detail/NodeDetailContext";
import { OnboardingFormCard } from "./OnboardingFormCard";
import {
  EmployeePickerCard,
  extractEmployeePickerPayload,
  type EmployeePickerPayload,
} from "./EmployeePickerCard";
import {
  SubsidyRecommendCard,
  extractSubsidyPayload,
  type SubsidyPayload,
} from "./SubsidyRecommendCard";
import {
  JobPostingCard,
  extractJobPostingsPayload,
  type JobPostingsPayload,
} from "./JobPostingCard";
import {
  ResumeCard,
  extractResumePayloads,
  type ResumePayload,
} from "./ResumeCard";

type UploadCategory =
  | "documents"
  | "receipt"
  | "invoice"
  | "tax"
  | "id"
  | "menu"
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
  naverBlog?: NaverBlogPayload;
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
  workAction?: WorkActionData;
  workConfirmed?: boolean;
  shortsWizard?: ShortsWizardPayload;
  menuChart?: MenuAnalysisPayload;
  salesInsight?: SalesInsightPayload;
  marketingReport?: MarketingReportPayload;
  eventPoster?: EventPosterPayload;
  eventPosters?: EventPosterPayload[];
  eventPlanForm?: boolean;
  snsPostForm?: boolean;
  blogPostForm?: boolean;
  reviewReplyForm?: boolean;
  scheduleForm?: boolean;
  employeePicker?: EmployeePickerPayload;
  adminApp?: { payload: AdminApplicationPayload; content: string };
  jobPostings?: JobPostingsPayload;
  resumes?: ResumePayload[];
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
  { value: "menu", label: "메뉴" },
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
  menu: "메뉴판",
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
  items: Array<{ name: string; prompt: string; icon?: ReactNode }>;
}> = [
  {
    label: "Sales",
    accent: "#7ba8a4",
    bg: "#c4dbd9",
    items: [
      { name: "매출 입력", prompt: "오늘 매출 입력하기" },
      { name: "비용 입력", prompt: "오늘 비용 입력하기" },
      { name: "매출 리포트", prompt: "이번 달 매출 요약 정리해줘" },
    ],
  },
  {
    label: "Recruitment",
    accent: "#d4a588",
    bg: "#f7e6da",
    items: [
      { name: "채용 공고", prompt: "채용 공고 초안 작성해줘" },
      { name: "면접 질문지", prompt: "이력서 바탕으로 면접 질문 뽑아줘." },
      { name: "면접 평가표", prompt: "면접 평가표 양식 만들어줘" },
    ],
  },
  {
    label: "Marketing",
    accent: "#c78897",
    bg: "#f0d7df",
    items: [
      {
        name: "Instagram 포스트",
        prompt: "인스타그램 피드 기획해줘.",
        icon: (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
          >
            <defs>
              <linearGradient
                id="ig-grad"
                x1="0"
                y1="24"
                x2="24"
                y2="0"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#FFDC80" />
                <stop offset="15%" stopColor="#FCAF45" />
                <stop offset="35%" stopColor="#F77737" />
                <stop offset="50%" stopColor="#FD1D1D" />
                <stop offset="70%" stopColor="#E1306C" />
                <stop offset="85%" stopColor="#833AB4" />
                <stop offset="100%" stopColor="#405DE6" />
              </linearGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill="url(#ig-grad)" />
            <rect
              x="5"
              y="5"
              width="14"
              height="14"
              rx="4"
              stroke="white"
              strokeWidth="1.8"
              fill="none"
            />
            <circle
              cx="12"
              cy="12"
              r="3.3"
              stroke="white"
              strokeWidth="1.8"
              fill="none"
            />
            <circle cx="17" cy="7" r="1.1" fill="white" />
          </svg>
        ),
      },
      {
        name: "네이버 Blog 포스트",
        prompt: "블로그 포스트 작성해줘",
        icon: (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
          >
            <rect width="24" height="24" rx="4" fill="#03C75A" />
            <path
              d="M13.8 12.6L10.8 7.5H8.5v9h2.2v-5.1l3 5.1H16v-9h-2.2z"
              fill="white"
            />
          </svg>
        ),
      },
      {
        name: "YouTube Shorts",
        prompt: "유튜브 Shorts 영상 만들어줘",
        icon: (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0"
          >
            <rect width="24" height="24" rx="5" fill="#FF0000" />
            <polygon points="9.5,7.5 18,12 9.5,16.5" fill="white" />
          </svg>
        ),
      },
      { name: "성과 리포트", prompt: "인스타그램·유튜브 성과 리포트 보여줘" },
    ],
  },
  {
    label: "Documents",
    accent: "#7977a0",
    bg: "#c8c7d6",
    items: [
      { name: "공정성 분석", prompt: "업로드한 계약서 공정성 분석해줘" },
      { name: "지원사업", prompt: "지원사업 추천해줘" },
      { name: "신청서 초안", prompt: "행정 신청서 작성해줘" },
      { name: "법률 자문", prompt: "법률 자문 받고 싶어" },
    ],
  },
];

const SUGGESTED_POOL: Record<string, string[]> = {
  recruitment: ["채용 공고 초안 작성해줘"],
  marketing: ["인스타 포스트 3개 기획해줘"],
  sales: ["이번 달 매출 요약 정리해줘"],
  documents: ["업로드한 계약서 공정성 분석해줘"],
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

function parseWorkTableAction(text: string): {
  clean: string;
  action: WorkActionData | undefined;
} {
  const PREFIX = "[ACTION:OPEN_WORK_TABLE:";
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
  let action: WorkActionData | undefined;
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
    newSessionTick,
    loadSessionTick,
    pendingLoadSessionId,
    pendingBriefing,
    consumeBriefing,
    setLastSpeaker,
    messages: _messages,
    setMessages: _setMessages,
    loading,
    setLoading,
    userId,
    fetchSessions,
    avatarUrl,
  } = useChat();
  const messages = _messages as Message[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setMessages = _setMessages as any as Dispatch<
    SetStateAction<Message[]>
  >;

  const [initialSuggestions, setInitialSuggestions] = useState<string[]>(() =>
    pickSuggested(),
  );
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<string>("auto");
  const [showSalesTable, setShowSalesTable] = useState(false);
  const [salesTableData, setSalesTableData] = useState<SalesActionData | null>(
    null,
  );
  const [showCostTable, setShowCostTable] = useState(false);
  const [costTableData, setCostTableData] = useState<CostActionData | null>(
    null,
  );
  const [showWorkTable, setShowWorkTable] = useState(false);
  const [workTableData, setWorkTableData] = useState<WorkActionData | null>(
    null,
  );
  const { openDetail } = useNodeDetail();
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  // v0.10 — 업로드된 문서는 이제 DB artifact 로 만들지 않고, 다음 chat POST 에
  // upload_payload 로 실어 보낸다. 리뷰가 완료되면(응답에 [[REVIEW_JSON]] 등장) 클리어.
  // sessionStorage 에 미러링해서 탭 새로고침에도 살아남게 한다.
  const PENDING_UPLOAD_KEY = "boss2:pending-upload";
  const PENDING_RECEIPT_KEY = "boss2:pending-receipt";
  const PENDING_UPLOADS_KEY = "boss2:pending-uploads";
  const pendingUploadRef = useRef<Record<string, unknown> | null>(null);
  const pendingReceiptRef = useRef<Record<string, unknown> | null>(null);
  const pendingUploadsRef = useRef<Array<Record<string, unknown>> | null>(null);
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
  const setPendingUploads = useCallback(
    (payloads: Array<Record<string, unknown>> | null) => {
      pendingUploadsRef.current = payloads;
      try {
        if (payloads)
          sessionStorage.setItem(PENDING_UPLOADS_KEY, JSON.stringify(payloads));
        else sessionStorage.removeItem(PENDING_UPLOADS_KEY);
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
      const rawU = sessionStorage.getItem(PENDING_UPLOADS_KEY);
      if (rawU)
        pendingUploadsRef.current = JSON.parse(rawU) as Array<
          Record<string, unknown>
        >;
    } catch {
      /* noop */
    }
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<
    ((text: string, messageIndex?: number) => Promise<void>) | null
  >(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

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
          }) => {
            const raw = m.content ?? "";
            const { clean: afterSales, action: salesAction } =
              parseSalesAction(raw);
            const { clean: afterCost, action: costAction } =
              parseCostAction(afterSales);
            const { clean: afterWork, action: workAction } =
              parseWorkTableAction(afterCost);
            const { cleaned: afterShorts, payload: shortsWizard } =
              extractShortsWizardPayload(afterWork);
            const { cleaned: afterMenu, payload: menuChart } =
              extractMenuChartPayload(afterShorts);
            const { cleaned: afterMktReport, payload: mktReport } =
              extractMarketingReportPayload(afterMenu);
            const {
              cleaned: afterEventPoster,
              payload: eventPoster,
              payloads: eventPosters,
            } = extractEventPosterPayload(afterMktReport);
            const { cleaned: afterInstagram, payload: igPayload } =
              extractInstagramPayload(afterEventPoster);
            const { cleaned: afterEventForm, hasForm: eventPlanForm } =
              extractEventPlanForm(afterInstagram);
            const { cleaned: afterScheduleForm, hasForm: scheduleForm } =
              extractScheduleForm(afterEventForm);
            const { cleaned: afterEmployeePicker, payload: employeePicker } =
              extractEmployeePickerPayload(afterScheduleForm);
            const { cleaned: cleanedContent, payloads: resumes } =
              extractResumePayloads(afterEmployeePicker);
            return {
              role: m.role === "user" ? "user" : "assistant",
              content: cleanedContent,
              choices: m.choices ?? undefined,
              attachment: m.attachment?.filename
                ? {
                    status: m.attachment.status ?? "done",
                    filename: m.attachment.filename,
                    sizeKb: m.attachment.size_kb ?? undefined,
                  }
                : undefined,
              salesAction,
              costAction,
              workAction: workAction ?? undefined,
              shortsWizard: shortsWizard ?? undefined,
              menuChart: menuChart ?? undefined,
              marketingReport: mktReport ?? undefined,
              eventPoster: eventPoster ?? undefined,
              eventPosters: eventPosters.length > 0 ? eventPosters : undefined,
              instagram: igPayload ?? undefined,
              eventPlanForm: eventPlanForm || undefined,
              scheduleForm: scheduleForm || undefined,
              employeePicker: employeePicker ?? undefined,
              resumes: resumes.length > 0 ? resumes : undefined,
            };
          },
        );
        // workConfirmed 복원: workAction이 있는 assistant 메시지 뒤에
        // 매칭되는 __WORK_TABLE_CONFIRMED__ 유저 메시지가 있으면 true 로 표시
        for (let mi = 0; mi < mapped.length; mi++) {
          const m = mapped[mi];
          if (m.role !== "assistant" || !m.workAction) continue;
          const { employee_id, pay_month } = m.workAction;
          const prefix = `__WORK_TABLE_CONFIRMED__:`;
          const confirmed = mapped.slice(mi + 1).some((nm) => {
            if (nm.role !== "user") return false;
            const raw2 = msgs[mapped.indexOf(nm)]?.content ?? nm.content ?? "";
            if (!raw2.startsWith(prefix)) return false;
            try {
              const p = JSON.parse(raw2.slice(prefix.length).trim());
              return p.employee_id === employee_id && p.pay_month === pay_month;
            } catch {
              return false;
            }
          });
          if (confirmed) mapped[mi] = { ...m, workConfirmed: true };
        }
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
            // ephemeral 업로드(artifact_id=null)는 needs_confirmation 무관하게 즉시 처리
            (!it.needs_confirmation || it.artifact_id === null) &&
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
        const menuItems = nonDocs.filter((it) => it.final_category === "menu");
        const otherNonDocs = nonDocs.filter(
          (it) =>
            it.final_category !== "receipt" && it.final_category !== "menu",
        );

        if (otherNonDocs.length > 0) {
          // "other" 카테고리 파일(이력서 등)은 upload_payloads 로 즉시 orchestrator에 전달.
          // 오케스트레이터가 upload_override 로 recruit_resume_parse 를 자동 실행한다.
          const payloads = otherNonDocs
            .filter((it) => it.storage_path)
            .map((it) => ({
              title: it.title,
              content: it.content ?? "",
              storage_path: it.storage_path!,
              bucket: it.bucket ?? "documents-uploads",
              mime_type: it.mime_type ?? "application/octet-stream",
              size_bytes: it.size_bytes ?? 0,
              original_name: it.original_name ?? it.title,
              parsed_len: it.parsed_len ?? 0,
              uploaded_at: new Date().toISOString(),
            }));
          if (payloads.length > 0) {
            setPendingUploads(payloads);
            const names = otherNonDocs.map((it) => `"${it.title}"`).join(", ");
            await sendRef.current?.(`업로드한 파일 ${names} 을 분석해주세요.`);
          }
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

        if (menuItems.length > 0 && userId) {
          // 메뉴판 이미지 — sales agent 의 `sales_menu_ocr` capability 가 수행.
          const latestMenu = menuItems[menuItems.length - 1];
          setPendingReceipt({
            storage_path: latestMenu.storage_path || "",
            bucket: latestMenu.bucket || "documents-uploads",
            mime_type: latestMenu.mime_type || "image/jpeg",
            original_name: latestMenu.original_name || "",
            size_bytes: latestMenu.size_bytes || 0,
          });
          await sendRef.current?.(
            `방금 업로드한 메뉴판 "${latestMenu.title}" 을 메뉴로 등록해줘.`,
          );
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
    [
      apiBase,
      userId,
      uploading,
      loading,
      messages.length,
      uploadType,
      setPendingUploads,
    ],
  );

  const handleDocxReady = useCallback(
    (blobUrl: string) => {
      // 자동 다운로드 트리거
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "사업자등록_신청서.docx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          content: "사업자등록 신청서 DOCX 파일을 다운로드했어요.",
        },
      ]);
    },
    [setMessages],
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
          // sendRef.current 는 항상 최신 send (stagedFiles=[] 로 재생성된 것)를 가리킨다.
          // 같은 클로저의 send() 를 재귀 호출하면 stale stagedFiles 를 보게 되어 무한 재업로드 발생.
          await sendRef.current?.(trimmed, messageIndex);
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
        if (pendingUploadsRef.current) {
          chatBody.upload_payloads = pendingUploadsRef.current;
          setPendingUploads(null);
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

        // admin_application을 가장 먼저 추출 — 이후 체인의 stripMarkers가 [ARTIFACT] 제거 전에
        const {
          cleaned: rawAfterAdmin,
          payload: adminAppPayloadNew,
          documentContent: adminAppDocContent,
        } = extractAdminApplicationPayload(rawReply);
        const chainInput = adminAppPayloadNew ? rawAfterAdmin : rawReply;

        const { clean: afterSales, action: salesAction } =
          parseSalesAction(chainInput);
        const { clean: afterCost, action: costAction } =
          parseCostAction(afterSales);
        const { clean: afterWork, action: workAction } =
          parseWorkTableAction(afterCost);
        const { cleaned: afterShorts, payload: shortsWizard } =
          extractShortsWizardPayload(afterWork);
        const { cleaned: afterInsight, payload: salesInsight } =
          extractInsightPayload(afterShorts);
        const { cleaned: afterMenu, payload: menuChart } =
          extractMenuChartPayload(afterInsight);
        const { cleaned: afterMarketing, payload: marketingReport } =
          extractMarketingReportPayload(afterMenu);
        const {
          cleaned: afterEventPoster,
          payload: eventPoster,
          payloads: eventPosters,
        } = extractEventPosterPayload(afterMarketing);
        const { cleaned: afterInstagram, payload: instagram } =
          extractInstagramPayload(afterEventPoster);
        const { cleaned: afterNaverBlog, payload: naverBlog } =
          extractNaverBlogPayload(afterInstagram);
        const { cleaned: afterEventForm, hasForm: eventPlanForm } =
          extractEventPlanForm(afterNaverBlog);
        const { cleaned: afterSnsForm, hasForm: snsPostForm } =
          extractSnsPostForm(afterEventForm);
        const { cleaned: afterBlogForm, hasForm: blogPostForm } =
          extractBlogPostForm(afterSnsForm);
        const { cleaned: afterReviewForm, hasForm: reviewReplyForm } =
          extractReviewReplyForm(afterBlogForm);
        const { cleaned: afterScheduleForm, hasForm: scheduleForm } =
          extractScheduleForm(afterReviewForm);
        const { cleaned: afterEmployeePicker2, payload: employeePicker } =
          extractEmployeePickerPayload(afterScheduleForm);
        const { cleaned: cleanReply, payloads: resumes } =
          extractResumePayloads(afterEmployeePicker2);
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
            workAction: workAction ?? undefined,
            shortsWizard: shortsWizard ?? undefined,
            menuChart: menuChart ?? undefined,
            salesInsight: salesInsight ?? undefined,
            marketingReport: marketingReport ?? undefined,
            eventPoster: eventPoster ?? undefined,
            eventPosters: eventPosters.length > 0 ? eventPosters : undefined,
            instagram: instagram ?? undefined,
            naverBlog: naverBlog ?? undefined,
            eventPlanForm: eventPlanForm || undefined,
            snsPostForm: snsPostForm || undefined,
            blogPostForm: blogPostForm || undefined,
            reviewReplyForm: reviewReplyForm || undefined,
            scheduleForm: scheduleForm || undefined,
            employeePicker: employeePicker ?? undefined,
            resumes: resumes.length > 0 ? resumes : undefined,
            adminApp: adminAppPayloadNew
              ? { payload: adminAppPayloadNew, content: adminAppDocContent }
              : undefined,
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
      setPendingUploads,
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
      {showWorkTable && workTableData && (
        <WorkTableCard
          data={workTableData}
          onClose={() => setShowWorkTable(false)}
          onConfirm={(confirmed) => {
            setShowWorkTable(false);
            sendRef.current?.(
              `__WORK_TABLE_CONFIRMED__:${JSON.stringify({ employee_id: confirmed.employee_id, pay_month: confirmed.pay_month, records: confirmed.records })}`,
            );
          }}
        />
      )}
      <div className="flex h-full min-h-0 flex-col">
        {messages.length === 0 && !loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-4">
            <div className="flex flex-col items-center gap-12">
              <div className="text-center font-mono text-3xl font-semibold uppercase tracking-[0.15em] text-[#030303]/70">
                Ask the chatbot
              </div>
              <div className="grid w-fit grid-cols-2 gap-3">
                {DOMAIN_CAPABILITIES.map((domain) => (
                  <div
                    key={domain.label}
                    className="flex w-36 flex-col gap-1.5"
                  >
                    <div
                      className="mb-0.5 inline-block self-center rounded-[4px] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: domain.bg,
                        color: domain.accent,
                      }}
                    >
                      {domain.label}
                    </div>
                    {domain.items.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        disabled={loading}
                        onClick={() => send(item.prompt)}
                        className="flex items-center justify-center gap-1.5 rounded-[5px] border border-[#030303]/[0.07] bg-[#fcfcfc] px-2.5 py-1.5 text-[12px] text-[#030303]/75 transition-colors hover:bg-[#030303]/[0.05] hover:text-[#030303] disabled:opacity-40"
                      >
                        {item.icon}
                        {item.name}
                      </button>
                    ))}
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
              let naverBlogPayload: NaverBlogPayload | null =
                msg.naverBlog ?? null;
              let reviewReplyPayload: ReviewReplyPayload | null =
                msg.reviewReply ?? null;
              let menuChartPayload: MenuAnalysisPayload | null =
                msg.menuChart ?? null;
              let salesInsightPayload: SalesInsightPayload | null =
                msg.salesInsight ?? null;
              let subsidyPayload: SubsidyPayload | null = null;
              // real-time: msg.adminApp 에 저장된 값 우선 사용
              let adminAppPayload: AdminApplicationPayload | null =
                msg.adminApp?.payload ?? null;
              let adminAppContent: string = msg.adminApp?.content ?? "";

              const isOnboardingForm =
                msg.role === "assistant" &&
                (displayText || "").includes("[[ONBOARDING_FORM]]");
              if (isOnboardingForm) {
                displayText = (displayText || "")
                  .replace("[[ONBOARDING_FORM]]", "")
                  .trim();
              }

              if (
                msg.role === "user" &&
                (displayText || "").startsWith("__WORK_TABLE_CONFIRMED__:")
              ) {
                displayText = "✓ Work hours confirmed";
              }

              if (msg.role === "assistant") {
                displayText = (displayText || "")
                  .replace(/\[PAYROLL_PREVIEW_DATA:[^\]]*\]/g, "")
                  .trim();

                // 히스토리: msg.adminApp 없으면 displayText에서 재감지 (세 종류 모두)
                if (!adminAppPayload) {
                  const {
                    cleaned: histCleaned,
                    payload: histPayload,
                    documentContent: histDoc,
                  } = extractAdminApplicationPayload(displayText || "");
                  if (histPayload) {
                    adminAppPayload = histPayload;
                    adminAppContent = histDoc;
                    displayText = histCleaned;
                  }
                } else {
                  // real-time: adminApp 있으면 intro text만 bubble에 표시
                  displayText = adminAppContent ? "" : displayText;
                }

                const rrExtracted = extractReviewReplyPayload(
                  displayText || "",
                );
                displayText = rrExtracted.cleaned;
                if (rrExtracted.payload)
                  reviewReplyPayload = rrExtracted.payload;

                const igExtracted = extractInstagramPayload(displayText || "");
                displayText = igExtracted.cleaned;
                if (igExtracted.payload) instagramPayload = igExtracted.payload;

                const nbExtracted = extractNaverBlogPayload(displayText || "");
                displayText = nbExtracted.cleaned;
                if (nbExtracted.payload) naverBlogPayload = nbExtracted.payload;

                const rvExtracted = extractReviewPayload(displayText || "");
                displayText = rvExtracted.cleaned;
                if (rvExtracted.payload) reviewPayload = rvExtracted.payload;

                const mcExtracted = extractMenuChartPayload(displayText || "");
                displayText = mcExtracted.cleaned;
                if (mcExtracted.payload) menuChartPayload = mcExtracted.payload;

                const sbExtracted = extractSubsidyPayload(displayText || "");
                displayText = sbExtracted.cleaned;
                if (sbExtracted.payload) subsidyPayload = sbExtracted.payload;

                const jpExtracted = extractJobPostingsPayload(
                  displayText || "",
                );
                displayText = jpExtracted.cleaned;
                if (jpExtracted.payload)
                  (msg as Message).jobPostings = jpExtracted.payload;
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
                      <div className="mt-0.5 shrink-0 overflow-hidden rounded-full">
                        <BossAvatar size={24} />
                      </div>
                    )}
                    {msg.role === "user" && (
                      <div className="order-last mt-0.5 shrink-0 overflow-hidden rounded-full">
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt="me"
                            className="h-6 w-6 object-cover"
                          />
                        ) : (
                          <EmployeeAvatar size={24} />
                        )}
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
                    <div className="flex justify-center w-full py-1">
                      <InstagramPostCard payload={instagramPayload} />
                    </div>
                  )}
                  {naverBlogPayload && msg.role === "assistant" && (
                    <div className="flex justify-center w-full py-1">
                      <NaverBlogPostCard
                        payload={naverBlogPayload}
                        accountId={userId ?? undefined}
                      />
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
                  {msg.role === "assistant" && salesInsightPayload && (
                    <div className="ml-8 max-w-[85%]">
                      <SalesInsightCard payload={salesInsightPayload} />
                    </div>
                  )}
                  {msg.role === "assistant" && menuChartPayload && (
                    <div className="ml-8 max-w-[85%]">
                      <MenuAnalysisCard payload={menuChartPayload} />
                    </div>
                  )}
                  {msg.role === "assistant" && subsidyPayload && (
                    <div className="ml-8 max-w-[85%]">
                      <SubsidyRecommendCard payload={subsidyPayload} />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.jobPostings && (
                    <div className="ml-8 max-w-[90%]">
                      <JobPostingCard payload={msg.jobPostings} />
                    </div>
                  )}
                  {msg.role === "assistant" &&
                    msg.resumes?.map((resume, ri) => (
                      <div
                        key={resume.resume_id ?? ri}
                        className="ml-8 max-w-[90%]"
                      >
                        <ResumeCard payload={resume} />
                      </div>
                    ))}
                  {msg.role === "assistant" && adminAppPayload && userId && (
                    <div className="ml-8 max-w-[90%]">
                      <AdminApplicationCard
                        content={adminAppContent}
                        title={adminAppPayload.title}
                        accountId={userId}
                        applicationType={adminAppPayload.application_type}
                        onDocxReady={handleDocxReady}
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.marketingReport && (
                    <div className="ml-8 max-w-[85%]">
                      <MarketingReportCard payload={msg.marketingReport} />
                    </div>
                  )}
                  {msg.role === "assistant" &&
                    (
                      msg.eventPosters ??
                      (msg.eventPoster ? [msg.eventPoster] : [])
                    ).map((ep, pi) => (
                      <div
                        key={ep.artifact_id ?? pi}
                        className="ml-8 max-w-[85%]"
                      >
                        <EventPosterCard payload={ep} />
                      </div>
                    ))}
                  {msg.role === "assistant" && msg.eventPlanForm && (
                    <div className="ml-8">
                      <EventPlanFormCard
                        onSubmit={(message) => send(message)}
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.snsPostForm && (
                    <div className="ml-8">
                      <SnsPostFormCard onSubmit={(message) => send(message)} />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.blogPostForm && (
                    <div className="ml-8">
                      <BlogPostFormCard onSubmit={(message) => send(message)} />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.reviewReplyForm && (
                    <div className="ml-8">
                      <ReviewReplyFormCard
                        onSubmit={(message) => send(message)}
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.scheduleForm && (
                    <div className="ml-8">
                      <ScheduleFormCard onSubmit={(message) => send(message)} />
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
                  {msg.role === "assistant" && msg.workAction && (
                    <div className="ml-8 flex flex-col gap-1.5">
                      {msg.workAction.records.length > 0 && (
                        <div className="overflow-hidden rounded-[5px] border border-[#030303]/10 bg-white">
                          <div className="flex items-center justify-between border-b border-[#030303]/[0.08] px-3 py-1.5">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                              Work hours
                            </span>
                            <span className="font-mono text-[11px] text-[#030303]/60">
                              {msg.workAction.employee_name} ·{" "}
                              {msg.workAction.pay_month}
                            </span>
                          </div>
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-[#030303]/10 text-left font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                                <th className="px-3 py-1.5 font-medium">
                                  날짜
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  기본
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  연장
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  야간
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium">
                                  휴일
                                </th>
                                <th className="px-3 py-1.5 font-medium">
                                  메모
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {msg.workAction.records.map((r, idx) => (
                                <tr
                                  key={idx}
                                  className="border-b border-[#030303]/5 last:border-b-0"
                                >
                                  <td className="px-3 py-1.5 font-mono tabular-nums text-[#030303]">
                                    {r.work_date}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]">
                                    {r.hours_worked}h
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]/70">
                                    {r.overtime_hours > 0
                                      ? `${r.overtime_hours}h`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]/70">
                                    {r.night_hours > 0
                                      ? `${r.night_hours}h`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]/70">
                                    {r.holiday_hours > 0
                                      ? `${r.holiday_hours}h`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-1.5 text-[#030303]/50">
                                    {r.memo || ""}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-[#030303]/10 bg-[#f4f1ed]">
                                <td className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[#030303]/60">
                                  합계
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[13px] font-semibold text-[#030303]">
                                  {msg.workAction.records.reduce(
                                    (s, r) => s + r.hours_worked,
                                    0,
                                  )}
                                  h
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]/70">
                                  {msg.workAction.records.reduce(
                                    (s, r) => s + r.overtime_hours,
                                    0,
                                  )}
                                  h
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]/70">
                                  {msg.workAction.records.reduce(
                                    (s, r) => s + r.night_hours,
                                    0,
                                  )}
                                  h
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[#030303]/70">
                                  {msg.workAction.records.reduce(
                                    (s, r) => s + r.holiday_hours,
                                    0,
                                  )}
                                  h
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loading || msg.workConfirmed}
                          onClick={() => {
                            setMessages((prev) =>
                              prev.map((m, idx) =>
                                idx === i ? { ...m, workConfirmed: true } : m,
                              ),
                            );
                            sendRef.current?.(
                              `__WORK_TABLE_CONFIRMED__:${JSON.stringify({ employee_id: msg.workAction!.employee_id, pay_month: msg.workAction!.pay_month, records: msg.workAction!.records })}`,
                            );
                          }}
                          className="w-full rounded-[5px] border-[#547244] bg-[#edf2e8] text-[#547244] hover:bg-[#dde9d1] text-xs font-medium disabled:opacity-40"
                        >
                          Save
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={msg.workConfirmed}
                          onClick={() => {
                            setWorkTableData(msg.workAction!);
                            setShowWorkTable(true);
                          }}
                          className="w-full rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium disabled:opacity-40"
                        >
                          Edit in table
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {loading && (
              <div className="flex justify-start gap-2">
                <div className="mt-0.5 shrink-0 overflow-hidden rounded-full">
                  <BossAvatar size={24} />
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
                {/* 모바일 카메라 전용 input — capture="environment" 로 후면 카메라 직접 실행 */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
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
                {/* 카메라 버튼 — 모바일에서 카메라 앱 직접 실행, 데스크톱에서 파일 선택 */}
                <button
                  type="button"
                  disabled={uploading || loading || !userId}
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center gap-1 rounded p-1.5 transition-colors hover:bg-[#030303]/[0.05] disabled:opacity-50"
                  aria-label="카메라로 촬영"
                  title="카메라로 영수증 촬영"
                >
                  <Camera className="h-4 w-4 text-[#030303]/70" />
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
