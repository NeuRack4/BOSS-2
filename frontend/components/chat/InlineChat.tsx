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
import { SalesDetailModal } from "@/components/sales/SalesDetailModal";

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

const SUGGESTED_POOL: Record<string, string[]> = {
  recruitment: [
    "이번 주 알바 채용 공고 초안 작성해줘",
    "카페 파트타이머 면접 질문 5개 뽑아줘",
    "신규 직원 온보딩 체크리스트 만들어줘",
    "주휴수당 포함해서 월 인건비 계산해줘",
    "3개 플랫폼에 채용 공고 동시에 올려줘",
    "채용 공고 포스터 이미지 만들어줘",
    "수습 기간 설정 가이드 알려줘",
    "면접 평가표 양식 만들어줘",
    "직원 근태 관리 체크리스트 추천해줘",
    "최저임금 기준 시급 계산해줘",
  ],
  marketing: [
    "이번 주 인스타 포스트 3개 기획해줘",
    "네이버 리뷰에 답글 작성해줘",
    "주말 프로모션 캠페인 아이디어 줘",
    "블로그 포스트 제목 10개 뽑아줘",
    "신메뉴 런칭 마케팅 플랜 짜줘",
    "SNS 해시태그 추천해줘",
    "단골 고객 이벤트 기획해줘",
    "광고 카피 3가지 버전 만들어줘",
    "카카오맵 리뷰 관리 전략 알려줘",
    "오픈 1주년 이벤트 준비해줘",
  ],
  sales: [
    "이번 달 매출 요약 정리해줘",
    "지난주 대비 매출 변화 알려줘",
    "오늘 매출 입력하기",
    "이번 달 비용 지출 분석해줘",
    "고마진 상품 TOP 5 알려줘",
    "단가 인상 영향 분석해줘",
    "주간 매출 리포트 만들어줘",
    "고정비 세부 내역 정리해줘",
    "분기별 매출 추이 보여줘",
    "손익분기점 계산해줘",
  ],
  documents: [
    "근로계약서 초안 작성해줘",
    "어제 업로드한 계약서 공정성 분석해줘",
    "임대차 계약 체크리스트 만들어줘",
    "견적서 템플릿 만들어줘",
    "영업 중단 공지문 작성해줘",
    "NDA 계약서 초안 작성해줘",
    "식품위생법 관련 체크리스트 줘",
    "사업자 등록 준비물 가이드 만들어줘",
    "가맹 계약서 주의사항 알려줘",
    "프리랜서 용역 계약서 작성해줘",
  ],
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
  const [detailModal, setDetailModal] = useState<{
    artifactId: string;
    artifactType: string;
    recordedDate: string;
    artifactTitle: string;
  } | null>(null);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    adjustHeight(textareaRef.current);
    textareaRef.current?.focus();
  }, [newSessionTick]);

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
          }) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
            choices: m.choices ?? undefined,
          }),
        );
        setCurrentSessionId(id);
        setMessages(mapped.length ? mapped : emptyMessages());
        if (mapped.length === 0) setInitialSuggestions(pickSuggested());
      } catch {
        setMessages(emptyMessages());
        setInitialSuggestions(pickSuggested());
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
          artifact_id: string;
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

        const confirms = items.filter((it) => it.needs_confirmation);
        const docsOk = items.filter(
          (it) => !it.needs_confirmation && it.final_category === "documents",
        );
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
          // 이미지 파일만 OCR 대상 (non-image는 uploads에서 이미 처리됨)
          const ocrFiles = files.filter((f) =>
            f.type.startsWith("image/") ||
            /\.(jpg|jpeg|png|webp|bmp|tiff|gif|heic|heif)$/i.test(f.name),
          );

          if (ocrFiles.length === 0) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "영수증 이미지를 찾을 수 없어요." },
            ]);
          } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `영수증 ${ocrFiles.length}장을 분석하고 있어요...`,
            },
          ]);

          try {
            const ocrForm = new FormData();
            for (const f of ocrFiles) ocrForm.append("files", f);
            const ocrRes = await fetch(`${apiBase}/api/sales/ocr`, {
              method: "POST",
              body: ocrForm,
            });
            const ocrJson = await ocrRes.json();
            const parsed = ocrJson?.data;

            setMessages((prev) => {
              const next = [...prev];
              if (ocrRes.ok && parsed?.items?.length > 0) {
                next[next.length - 1] = {
                  role: "assistant",
                  content: `영수증에서 **${parsed.items.length}개 항목**을 인식했어요. 확인 후 저장하세요.`,
                  salesAction:
                    parsed.type !== "cost"
                      ? { date: parsed.date, items: parsed.items }
                      : undefined,
                  costAction:
                    parsed.type === "cost"
                      ? { date: parsed.date, items: parsed.items }
                      : undefined,
                };
              } else {
                next[next.length - 1] = {
                  role: "assistant",
                  content:
                    ocrJson?.error ??
                    "영수증에서 항목을 인식하지 못했어요. 더 선명한 이미지를 사용해보세요.",
                };
              }
              return next;
            });
          } catch {
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = {
                role: "assistant",
                content: "영수증 분석 중 오류가 발생했어요.",
              };
              return next;
            });
          }
          } // end ocrFiles.length > 0
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
        const res = await fetch(`${apiBase}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            account_id: userId,
            session_id: currentSessionId,
          }),
        });
        const data = await res.json();
        const newSessionId: string | undefined = data?.data?.session_id;
        const sessionCreated: boolean = !!data?.data?.session_created;
        if (newSessionId && newSessionId !== currentSessionId) {
          setCurrentSessionId(newSessionId);
        }
        const rawReply = data?.data?.reply ?? "응답을 받지 못했습니다.";
        const { clean: afterSales, action: salesAction } =
          parseSalesAction(rawReply);
        const { clean: cleanReply, action: costAction } =
          parseCostAction(afterSales);
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
          },
        ]);
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
    setStagedFiles((prev) => [...prev, ...Array.from(list)]);
    e.target.value = "";
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
      {detailModal && userId && (
        <SalesDetailModal
          open={!!detailModal}
          onClose={() => setDetailModal(null)}
          accountId={userId}
          artifactId={detailModal.artifactId}
          artifactType={detailModal.artifactType}
          recordedDate={detailModal.recordedDate}
          artifactTitle={detailModal.artifactTitle}
        />
      )}
      {showSalesTable && salesTableData && (
        <SalesInputTable
          data={salesTableData}
          apiBase={apiBase ?? ""}
          onClose={() => setShowSalesTable(false)}
          onSaved={(message, artifactId) => {
            const savedDate = salesTableData?.date ?? new Date().toISOString().slice(0, 10);
            setShowSalesTable(false);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: message,
                savedArtifactId: artifactId,
                savedDomain: "sales",
                savedArtifactMeta: artifactId ? {
                  type: "revenue_entry",
                  recordedDate: savedDate,
                  title: `${savedDate} 매출`,
                } : undefined,
              },
            ]);
            window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
          }}
        />
      )}
      {showCostTable && costTableData && (
        <CostInputTable
          data={costTableData}
          apiBase={apiBase ?? ""}
          onClose={() => setShowCostTable(false)}
          onSaved={(message, artifactId) => {
            setShowCostTable(false);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: message,
                savedArtifactId: artifactId,
                savedDomain: "sales",
              },
            ]);
            window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
          }}
        />
      )}
      <div className="flex h-full min-h-0 flex-col">
        {messages.length === 0 && !loading ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
            <div className="mb-4 text-center font-mono text-lg font-semibold uppercase tracking-[0.15em] text-[#030303]/70">
              Ask the chatbot.
            </div>
            <div className="flex w-full max-w-xs flex-col gap-1.5">
              {initialSuggestions.map((choice, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => send(choice)}
                  className={cn(
                    "h-auto justify-center whitespace-normal rounded-[5px] py-1.5 px-2.5 text-center text-[12px] font-normal leading-snug",
                    "border-[#030303]/10 bg-[#fcfcfc] text-[#030303] hover:bg-[#030303]/[0.05] hover:text-[#030303]",
                  )}
                >
                  {choice}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <ScrollArea
          className={cn(
            "min-h-0 flex-1 px-3 py-2",
            messages.length === 0 && !loading && "hidden",
          )}
        >
          <div className="space-y-2.5">
            {messages.map((msg, i) => {
              let displayText = msg.content;
              let reviewPayload: ReviewPayload | null = msg.review ?? null;
              let instagramPayload: InstagramPayload | null =
                msg.instagram ?? null;
              let reviewReplyPayload: ReviewReplyPayload | null =
                msg.reviewReply ?? null;

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
                          if (msg.savedArtifactMeta && msg.savedArtifactId) {
                            setDetailModal({
                              artifactId: msg.savedArtifactId,
                              artifactType: msg.savedArtifactMeta.type,
                              recordedDate: msg.savedArtifactMeta.recordedDate,
                              artifactTitle: msg.savedArtifactMeta.title,
                            });
                          } else if (msg.savedDomain) {
                            window.location.href = `/${msg.savedDomain}`;
                          }
                        }}
                        className="rounded-[5px] border-[#d89a2b] bg-[#fdf8ec] text-[#9a6e1a] hover:bg-[#faefd0] text-xs font-medium"
                      >
                        📋 상세 보기
                      </Button>
                    </div>
                  )}
                  {msg.role === "assistant" && msg.salesAction && (
                    <div className="ml-8 flex flex-wrap gap-1.5">
                      {msg.salesAction.items.length === 0 ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => send("오늘 매출 글로 입력하기")}
                            className="rounded-[5px] border-[#6e6254] bg-[#f3f0ec] text-[#6e6254] hover:bg-[#e8e3db] text-xs font-medium"
                          >
                            ✏️ 글로 입력하기
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSalesTableData(msg.salesAction!);
                              setShowSalesTable(true);
                            }}
                            className="rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium"
                          >
                            📋 표로 추가입력하기
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={async () => {
                              if (!userId || !apiBase) return;
                              const action = msg.salesAction!;
                              try {
                                const res = await fetch(
                                  `${apiBase}/api/sales`,
                                  {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      account_id: userId,
                                      items: action.items.map((it) => ({
                                        ...it,
                                        amount: it.quantity * it.unit_price,
                                        recorded_date: action.date,
                                        source: "chat",
                                      })),
                                    }),
                                  },
                                );
                                if (res.ok) {
                                  const json = await res
                                    .json()
                                    .catch(() => ({}));
                                  const artifactId: string | undefined =
                                    json?.data?.artifact_id;
                                  window.dispatchEvent(
                                    new CustomEvent("boss:artifacts-changed"),
                                  );
                                  setMessages((prev) => [
                                    ...prev,
                                    {
                                      role: "assistant" as const,
                                      content: `매출 ${action.items.length}건이 저장됐어요.`,
                                      savedArtifactId: artifactId,
                                      savedDomain: "sales",
                                      savedArtifactMeta: artifactId ? {
                                        type: "revenue_entry",
                                        recordedDate: action.date,
                                        title: `${action.date} 매출 (${action.items.length}건)`,
                                      } : undefined,
                                    },
                                  ]);
                                }
                              } catch {
                                /* silent */
                              }
                            }}
                            className="rounded-[5px] border-[#547244] bg-[#edf2e8] text-[#547244] hover:bg-[#dde9d1] text-xs font-medium"
                          >
                            💾 저장
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSalesTableData(msg.salesAction!);
                              setShowSalesTable(true);
                            }}
                            className="rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium"
                          >
                            📋 표로 수정입력하기
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setMessages((prev) => [
                                ...prev,
                                {
                                  role: "assistant" as const,
                                  content:
                                    "새 매출을 입력해 주세요! 품목·수량·금액을 알려주세요.",
                                },
                              ]);
                            }}
                            className="rounded-[5px] border-[#6e6254] bg-[#f3f0ec] text-[#6e6254] hover:bg-[#e8e3db] text-xs font-medium"
                          >
                            ✏️ 글로 새로 입력
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                  {msg.role === "assistant" && msg.costAction && (
                    <div className="ml-8 flex flex-wrap gap-1.5">
                      {msg.costAction.items.length === 0 ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setCostTableData(msg.costAction!);
                            setShowCostTable(true);
                          }}
                          className="rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium"
                        >
                          📋 표로 입력하기
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={async () => {
                              if (!userId || !apiBase) return;
                              const action = msg.costAction!;
                              try {
                                const res = await fetch(
                                  `${apiBase}/api/costs`,
                                  {
                                    method: "POST",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      account_id: userId,
                                      items: action.items.map((it) => ({
                                        ...it,
                                        recorded_date: action.date,
                                        source: "chat",
                                      })),
                                    }),
                                  },
                                );
                                if (res.ok) {
                                  const json = await res
                                    .json()
                                    .catch(() => ({}));
                                  const artifactId: string | undefined =
                                    json?.data?.artifact_id;
                                  window.dispatchEvent(
                                    new CustomEvent("boss:artifacts-changed"),
                                  );
                                  setMessages((prev) => [
                                    ...prev,
                                    {
                                      role: "assistant" as const,
                                      content: `비용 ${action.items.length}건이 저장됐어요.`,
                                      savedArtifactId: artifactId,
                                      savedDomain: "sales",
                                    },
                                  ]);
                                }
                              } catch {
                                /* silent */
                              }
                            }}
                            className="rounded-[5px] border-[#547244] bg-[#edf2e8] text-[#547244] hover:bg-[#dde9d1] text-xs font-medium"
                          >
                            💾 저장
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCostTableData(msg.costAction!);
                              setShowCostTable(true);
                            }}
                            className="rounded-[5px] border-[#7a6250] bg-[#f3ede7] text-[#7a6250] hover:bg-[#e8ddd4] text-xs font-medium"
                          >
                            📋 표로 수정입력하기
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setMessages((prev) => [
                                ...prev,
                                {
                                  role: "assistant" as const,
                                  content:
                                    "새 비용을 입력해 주세요! 항목명·분류·금액을 알려주세요.",
                                },
                              ]);
                            }}
                            className="rounded-[5px] border-[#6e6254] bg-[#f3f0ec] text-[#6e6254] hover:bg-[#e8e3db] text-xs font-medium"
                          >
                            ✏️ 새로 입력
                          </Button>
                        </>
                      )}
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
