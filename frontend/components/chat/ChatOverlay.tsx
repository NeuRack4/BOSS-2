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
  MessageSquarePlus,
  Paperclip,
  PlusIcon,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useChat, type ChatSession } from "./ChatContext";
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
  { value: "auto", label: "자동 분류" },
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
      if (depth === 0) { jsonEnd = i; break; }
    }
  }
  if (jsonEnd === -1) return { clean: text, action: undefined };

  // } 뒤에 오는 ] 을 직접 탐색 (중간에 공백 등이 끼어도 안전)
  let markerEnd = jsonEnd + 1;
  while (markerEnd < text.length && text[markerEnd] !== "]") markerEnd++;
  markerEnd++; // ] 포함해서 한 칸 더

  let action: SalesActionData | undefined;
  try { action = JSON.parse(text.slice(jsonStart, jsonEnd + 1)); } catch { /* ignore */ }

  const clean = (text.slice(0, start) + text.slice(markerEnd)).trim();
  return { clean, action };
}

const MIN_TEXTAREA = 60;
const MAX_TEXTAREA = 200;

const GREETING: Message = {
  role: "assistant",
  content: "안녕하세요! 채용, 마케팅, 매출, 서류 관련 무엇이든 말씀해 주세요.",
};

const isOtherChoice = (choice: string) =>
  /^기타\b/.test(choice) || choice.includes("직접 입력");

const adjustHeight = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = `${MIN_TEXTAREA}px`;
  const next = Math.min(Math.max(el.scrollHeight, MIN_TEXTAREA), MAX_TEXTAREA);
  el.style.height = `${next}px`;
};

const formatRelative = (iso: string): string => {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
};

export const ChatOverlay = () => {
  const {
    registerSender,
    isChatOpen,
    closeChat,
    seedText,
    consumeSeed,
    currentSessionId,
    setCurrentSessionId,
    sessions,
    setSessions,
    requestNewSession,
    newSessionTick,
    requestLoadSession,
    loadSessionTick,
    pendingLoadSessionId,
    pendingBriefing,
    consumeBriefing,
  } = useChat();

  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<string>("auto");
  const [userId, setUserId] = useState<string | null>(null);
  const [showSalesTable, setShowSalesTable] = useState(false);
  const [salesTableData, setSalesTableData] = useState<SalesActionData | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<((text: string, messageIndex?: number) => Promise<void>) | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    if (isChatOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isChatOpen]);

  const fetchSessions = useCallback(async () => {
    if (!userId) return;
    setSessionsLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/api/chat/sessions?account_id=${userId}&limit=50`,
      );
      const json = await res.json();
      const rows: ChatSession[] = json?.data ?? [];
      setSessions(rows);
    } catch {
      /* noop */
    } finally {
      setSessionsLoading(false);
    }
  }, [apiBase, userId, setSessions]);

  // Load sessions when overlay opens
  useEffect(() => {
    if (isChatOpen && userId) fetchSessions();
  }, [isChatOpen, userId, fetchSessions]);

  // Seed hydrate on open
  useEffect(() => {
    if (!isChatOpen) return;
    if (seedText !== null) {
      setInput(seedText);
      consumeSeed();
      requestAnimationFrame(() => {
        adjustHeight(textareaRef.current);
        textareaRef.current?.focus();
        const len = textareaRef.current?.value.length ?? 0;
        textareaRef.current?.setSelectionRange(len, len);
      });
    } else {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [isChatOpen, seedText, consumeSeed]);

  // Start a fresh session when overlay opens (열 때마다 새 세션)
  const openTick = useRef(0);
  useEffect(() => {
    if (!isChatOpen) return;
    openTick.current += 1;
    setCurrentSessionId(null);
    if (pendingBriefing) {
      setMessages([{ role: "assistant", content: pendingBriefing }]);
      consumeBriefing();
    } else {
      setMessages([GREETING]);
    }
  }, [isChatOpen, setCurrentSessionId, pendingBriefing, consumeBriefing]);

  // Manual 새 대화
  useEffect(() => {
    if (newSessionTick === 0) return;
    setMessages([GREETING]);
    setInput("");
    setStagedFiles([]);
    adjustHeight(textareaRef.current);
    textareaRef.current?.focus();
  }, [newSessionTick]);

  // Load an existing session's messages
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
        setMessages(mapped.length ? mapped : [GREETING]);
      } catch {
        setMessages([GREETING]);
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

  /** 이미지 파일 + 리뷰 맥락이면 true */
  const isReviewImage = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return false;
      const inputLower = input.toLowerCase();
      if (inputLower.includes("리뷰")) return true;
      const recentText = messages
        .slice(-6)
        .map((m) => m.content)
        .join(" ")
        .toLowerCase();
      return recentText.includes("리뷰");
    },
    [input, messages],
  );

  /** 리뷰 이미지 분석 → 자동 채팅 전송 */
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

        // 첨부 버블을 "완료"로 업데이트
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

        // 플랫폼 라벨
        const platformLabel: Record<string, string> = {
          naver: "네이버 플레이스",
          kakao: "카카오맵",
          google: "구글맵",
          other: "플랫폼",
        };
        const platform = platformLabel[data.platform] ?? "플랫폼";
        const stars = data.star_rating ? `별점 ${data.star_rating}점` : "별점 미확인";
        const reviewText = data.review_text
          ? `\n리뷰 내용: ${data.review_text}`
          : "";

        // 자동 채팅 메시지 전송 (sendRef 로 순환 의존 없이 호출)
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
              const autoCategory = (auto?.category ?? "other") as UploadCategory;
              const autoDocType = auto?.doc_type ?? CATEGORY_LABEL[autoCategory];
              const userCategory = (it.final_category ?? "other") as UploadCategory;
              const userDocType = it.classification?.doc_type ?? CATEGORY_LABEL[userCategory];
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

        if (nonDocs.length > 0) {
          const lines = nonDocs.map((it) => {
            const cat = (it.final_category ?? "other") as UploadCategory;
            return `- **${it.title}** → ${NON_DOC_HINT[cat] ?? "저장만 해뒀어요."}`;
          });
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: lines.join("\n") },
          ]);
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

      // staged 파일 처리 분기
      if (stagedFiles.length > 0) {
        const files = [...stagedFiles];
        setStagedFiles([]);
        setInput("");
        adjustHeight(textareaRef.current);

        const textLower = trimmed.toLowerCase();
        const recentText = messages.slice(-6).map((m) => m.content).join(" ").toLowerCase();
        const hasReviewCtx = textLower.includes("리뷰") || recentText.includes("리뷰");

        if (files.length === 1 && files[0].type.startsWith("image/") && hasReviewCtx) {
          // 리뷰 이미지 분석 → 분석 완료 후 send 재호출로 채팅 전송
          if (trimmed) {
            setMessages((prev) => [...prev, { role: "user" as const, content: trimmed }]);
          }
          await analyzeReviewImage(files[0]);
          return;
        }
        // 일반 파일 업로드 후 텍스트 메시지 전송
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
        // [ACTION:OPEN_SALES_TABLE:{...}] 마커 파싱 + 제거
        // 정규식 대신 중괄호 깊이를 직접 세서 파싱 (JSON 안의 ]에 끊기지 않도록)
        const { clean: cleanReply, action: salesAction } = parseSalesAction(rawReply);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: cleanReply,
            choices: data?.data?.choices?.length
              ? data.data.choices
              : undefined,
            salesAction,
          },
        ]);
        // 응답이 새 artifact 를 만들었을 수 있으므로 캔버스 재조회 신호
        window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
        if (sessionCreated) {
          // 제목 생성은 백그라운드라 살짝 늦게 리프레시
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

  // sendRef 를 항상 최신 send 로 유지 (analyzeReviewImage 에서 순환 dep 없이 호출 가능)
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

      // 메시지의 choices/confirm 제거 + 확정 표기
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
        /* noop — 확정 실패해도 UI 는 이미 업데이트됨, 필요시 재시도는 차기 */
      }

      // 문서 카테고리로 확정됐으면 분석 트리거
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

  // Esc to close (only when input empty)
  useEffect(() => {
    if (!isChatOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !input.trim()) closeChat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isChatOpen, input, closeChat]);

  const handleChoiceClick = (choice: string, messageIndex: number) => {
    // 분류 충돌 확정 전용 풍선
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

    // 이미지 데이터가 있으면 staged에 추가 (텍스트 붙여넣기는 그대로 허용)
    const files = imageItems
      .map((item) => {
        const file = item.getAsFile();
        if (!file) return null;
        // 스크린샷은 파일명이 없으므로 타임스탬프 기반 이름 부여
        const ext = file.type.split("/")[1] ?? "png";
        const name = `screenshot-${Date.now()}.${ext}`;
        return new File([file], name, { type: file.type });
      })
      .filter((f): f is File => f !== null);

    if (files.length > 0) {
      e.preventDefault(); // 이미지 붙여넣기 시 텍스트로 오염되는 것 방지
      setStagedFiles((prev) => [...prev, ...files]);
    }
  };

  const deleteSession = useCallback(
    async (id: string) => {
      if (!userId) return;
      if (!confirm("이 대화를 삭제할까요?")) return;
      try {
        await fetch(`${apiBase}/api/chat/sessions/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: userId }),
        });
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (currentSessionId === id) {
          setCurrentSessionId(null);
          setMessages([GREETING]);
        }
      } catch {
        /* noop */
      }
    },
    [apiBase, currentSessionId, setCurrentSessionId, setSessions, userId],
  );

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      ),
    [sessions],
  );

  if (!isChatOpen) return null;

  return (
    <>
    {showSalesTable && salesTableData && (
      <SalesInputTable
        data={salesTableData}
        apiBase={apiBase ?? ""}
        onClose={() => setShowSalesTable(false)}
        onSaved={(message) => {
          setShowSalesTable(false);
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: message },
          ]);
          window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
        }}
      />
    )}
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2e2719]/40 backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeChat();
      }}
    >
      <div
        className="relative flex h-[70vh] w-[70vw] max-w-[1100px] overflow-hidden rounded-2xl border border-[#ddd0b4] bg-[#fffaf2] shadow-xl animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-label="Orchestrator chat"
      >
        {/* Left: sessions panel */}
        <aside className="flex w-[260px] shrink-0 flex-col border-r border-[#ddd0b4] bg-[#ebe0ca]/50">
          <div className="flex items-center justify-between border-b border-[#ddd0b4] px-3 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#8c7e66]">
              이전 대화
            </span>
            <button
              type="button"
              onClick={requestNewSession}
              className="flex items-center gap-1 rounded-md border border-[#ddd0b4] bg-[#fffaf2] px-2 py-1 text-xs text-[#2e2719] transition-colors hover:bg-[#ebe0ca]"
              aria-label="새 대화"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />새 대화
            </button>
          </div>
          <ScrollArea className="min-h-0 flex-1 px-2 py-2">
            {sessionsLoading && sortedSessions.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-[#8c7e66]">
                불러오는 중...
              </div>
            )}
            {!sessionsLoading && sortedSessions.length === 0 && (
              <div className="px-2 py-4 text-center text-xs text-[#8c7e66]">
                아직 대화가 없어요
              </div>
            )}
            <ul className="space-y-1">
              {sortedSessions.map((s) => {
                const active = s.id === currentSessionId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => requestLoadSession(s.id)}
                      className={cn(
                        "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                        active
                          ? "bg-[#ddd0b4] text-[#2e2719]"
                          : "text-[#5a5040] hover:bg-[#ddd0b4]/60",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {s.title || "새 대화"}
                        </div>
                        <div className="text-[11px] text-[#8c7e66]">
                          {formatRelative(s.updated_at)}
                        </div>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(s.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteSession(s.id);
                          }
                        }}
                        className="invisible rounded p-1 text-[#8c7e66] hover:bg-[#bfae8a]/30 hover:text-[#2e2719] group-hover:visible"
                        aria-label="세션 삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </aside>

        {/* Right: chat area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#ddd0b4] bg-[#ebe0ca]/50 px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-[#7f8f54]" />
              <span className="text-sm font-semibold text-[#2e2719]">
                Orchestrator
              </span>
              <span className="text-xs text-[#8c7e66]">
                · AI 운영 어시스턴트
              </span>
            </div>
            <button
              type="button"
              onClick={closeChat}
              className="rounded-md p-1.5 text-[#8c7e66] transition-colors hover:bg-[#ddd0b4] hover:text-[#2e2719]"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <ScrollArea className="min-h-0 flex-1 px-5 py-4">
            <div className="mx-auto max-w-3xl space-y-3">
              {messages.map((msg, i) => {
                let displayText = msg.content;
                let reviewPayload: ReviewPayload | null = msg.review ?? null;
                let instagramPayload: InstagramPayload | null = msg.instagram ?? null;
                let reviewReplyPayload: ReviewReplyPayload | null = msg.reviewReply ?? null;

                if (msg.role === "assistant") {
                  const rrExtracted = extractReviewReplyPayload(displayText || "");
                  displayText = rrExtracted.cleaned;
                  if (rrExtracted.payload) reviewReplyPayload = rrExtracted.payload;

                  const igExtracted = extractInstagramPayload(displayText || "");
                  displayText = igExtracted.cleaned;
                  if (igExtracted.payload) instagramPayload = igExtracted.payload;

                  const rvExtracted = extractReviewPayload(displayText || "");
                  displayText = rvExtracted.cleaned;
                  if (rvExtracted.payload) reviewPayload = rvExtracted.payload;
                }

                return (
                  <div key={i} className="space-y-2">
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
                            "flex max-w-[80%] items-center gap-2 rounded-2xl rounded-br-sm border px-3 py-2 text-sm",
                            msg.attachment.status === "error"
                              ? "border-[#d9a191] bg-[#f4dcd2] text-[#8a3a28]"
                              : msg.attachment.status === "uploading"
                                ? "border-[#ddd0b4] bg-[#fffaf2] text-[#5a5040]"
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
                            "max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                            msg.role === "user"
                              ? "whitespace-pre-wrap rounded-br-sm bg-[#2e2719] text-[#fbf6eb]"
                              : "rounded-bl-sm bg-[#ebe0ca] text-[#2e2719]",
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
                      <div className="ml-8 max-w-[80%]">
                        <ReviewResultCard payload={reviewPayload} />
                      </div>
                    )}
                    {instagramPayload && msg.role === "assistant" && (
                      <div className="ml-8">
                        <InstagramPostCard payload={instagramPayload} />
                      </div>
                    )}
                    {reviewReplyPayload && msg.role === "assistant" && (
                      <div className="ml-8 max-w-[80%]">
                        <ReviewReplyCard payload={reviewReplyPayload} />
                      </div>
                    )}
                    {msg.role === "assistant" && msg.choices && (
                      <div className="ml-8 grid grid-cols-2 gap-1.5">
                        {msg.choices.map((choice, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            onClick={() => handleChoiceClick(choice, i)}
                            className={cn(
                              "h-auto justify-start whitespace-normal py-1.5 px-2.5 text-left text-xs font-normal leading-snug",
                              "border-[#ddd0b4] bg-[#fffaf2] text-[#2e2719] hover:bg-[#ebe0ca] hover:text-[#2e2719]",
                              isOtherChoice(choice) &&
                                "col-span-2 border-dashed text-[#8c7e66]",
                            )}
                          >
                            {choice}
                          </Button>
                        ))}
                      </div>
                    )}
                    {msg.role === "assistant" && msg.salesAction && (
                      <div className="ml-8 flex gap-2">
                        {msg.salesAction.items.length === 0 ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={loading}
                              onClick={() => send("오늘 매출 글로 입력하기")}
                              className="flex-1 border-[#7f8f54] bg-[#f5f7f0] text-[#7f8f54] hover:bg-[#e8eedd] text-xs font-medium"
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
                              className="flex-1 border-[#c47865] bg-[#fdf0ec] text-[#c47865] hover:bg-[#fae0d8] text-xs font-medium"
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
                                  const res = await fetch(`${apiBase}/api/sales`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      account_id: userId,
                                      items: action.items.map((it) => ({
                                        ...it,
                                        amount: it.quantity * it.unit_price,
                                        recorded_date: action.date,
                                        source: "chat",
                                      })),
                                    }),
                                  });
                                  if (res.ok) {
                                    window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));
                                    setMessages((prev) => [
                                      ...prev,
                                      {
                                        role: "assistant" as const,
                                        content: `매출 ${action.items.length}건이 저장됐어요. 캔버스 Revenue 허브에서 확인할 수 있어요.`,
                                      },
                                    ]);
                                  }
                                } catch {
                                  // silent
                                }
                              }}
                              className="flex-1 border-[#7f8f54] bg-[#f5f7f0] text-[#7f8f54] hover:bg-[#e8eedd] text-xs font-medium"
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
                              className="flex-1 border-[#c47865] bg-[#fdf0ec] text-[#c47865] hover:bg-[#fae0d8] text-xs font-medium"
                            >
                              📋 표로 추가입력하기
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
                  <div className="rounded-2xl rounded-bl-sm bg-[#ebe0ca] px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[#8c7e66]" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {/* Input */}
          <div className="border-t border-[#ddd0b4] bg-[#ebe0ca]/40 px-5 py-4">
            <div className="mx-auto max-w-3xl">
              <div className="relative rounded-xl border border-[#ddd0b4] bg-[#fffaf2]">
                {/* Staged 파일 미리보기 */}
                {stagedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-b border-[#ddd0b4] px-3 pt-2.5 pb-2">
                    {stagedFiles.map((f, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 rounded-lg border border-[#ddd0b4] bg-[#ebe0ca] px-2 py-1 text-[12px] text-[#2e2719]"
                      >
                        <Paperclip className="h-3 w-3 shrink-0 text-[#8c7e66]" />
                        <span className="max-w-[160px] truncate">{f.name}</span>
                        <button
                          type="button"
                          onClick={() => removeStagedFile(i)}
                          className="ml-0.5 rounded p-0.5 hover:bg-[#ddd0b4]"
                          aria-label="첨부 파일 제거"
                        >
                          <X className="h-3 w-3 text-[#8c7e66]" />
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
                    placeholder="메시지를 입력하세요..."
                    className={cn(
                      "w-full resize-none border-none bg-transparent px-4 py-3 text-sm text-[#2e2719]",
                      "placeholder:text-sm placeholder:text-[#8c7e66]",
                      "focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
                      "min-h-[60px]",
                    )}
                    style={{ overflow: "hidden" }}
                  />
                </div>

                <div className="flex items-center justify-between p-3">
                  <div className="flex items-center gap-2">
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
                      className="group flex items-center gap-1 rounded-lg p-2 transition-colors hover:bg-[#ebe0ca] disabled:opacity-50"
                      aria-label="문서 첨부 (PDF·DOCX·TXT·RTF·XLSX·CSV·이미지)"
                      title="PDF·DOCX·TXT·RTF·XLSX·CSV·이미지 첨부 (여러 개 선택 가능, 이미지는 OCR)"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[#5a5040]" />
                      ) : (
                        <Paperclip className="h-4 w-4 text-[#5a5040]" />
                      )}
                      <span className="hidden text-xs text-[#8c7e66] transition-opacity group-hover:inline">
                        {uploading ? "업로드 중" : "첨부"}
                      </span>
                    </button>
                    <select
                      value={uploadType}
                      onChange={(e) => setUploadType(e.target.value)}
                      disabled={uploading || loading}
                      className="rounded-md border border-[#ddd0b4] bg-transparent px-2 py-1 text-xs text-[#5a5040] focus:border-[#bfae8a] focus:outline-none disabled:opacity-50"
                      title="업로드 파일 타입 (자동 분류 기본)"
                      aria-label="업로드 파일 타입"
                    >
                      {UPLOAD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex items-center justify-between gap-1 rounded-lg border border-dashed border-[#ddd0b4] px-2 py-1 text-sm text-[#8c7e66] transition-colors hover:border-[#bfae8a] hover:bg-[#ebe0ca]"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Project
                    </button>
                    <button
                      type="button"
                      onClick={() => send(input)}
                      disabled={loading || (!input.trim() && stagedFiles.length === 0)}
                      className={cn(
                        "flex items-center justify-between gap-1 rounded-lg border border-[#ddd0b4] px-1.5 py-1.5 text-sm transition-colors hover:border-[#bfae8a] hover:bg-[#ebe0ca] disabled:opacity-50",
                        (input.trim() || stagedFiles.length > 0)
                          ? "bg-[#2e2719] text-[#fbf6eb] hover:bg-[#3d3423]"
                          : "text-[#8c7e66]",
                      )}
                      aria-label="보내기"
                    >
                      <ArrowUpIcon
                        className={cn(
                          "h-4 w-4",
                          (input.trim() || stagedFiles.length > 0) ? "text-[#fbf6eb]" : "text-[#8c7e66]",
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};
