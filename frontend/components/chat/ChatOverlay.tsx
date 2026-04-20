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
import { MarkdownMessage } from "./MarkdownMessage";

type Message = {
  role: "user" | "assistant";
  content: string;
  choices?: string[];
  review?: ReviewPayload;
  attachment?: {
    status: "uploading" | "done" | "error";
    filename: string;
    sizeKb?: number;
    error?: string;
  };
};

const UPLOAD_ACCEPT =
  ".pdf,.docx,.doc,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.gif," +
  "application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/msword," +
  "image/jpeg,image/png,image/webp,image/bmp,image/tiff,image/gif";
const UPLOAD_MAX_MB = 20;

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
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const send = useCallback(
    async (text: string, messageIndex?: number) => {
      const trimmed = text.trim();
      if (!trimmed || loading || !userId) return;
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
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data?.data?.reply ?? "응답을 받지 못했습니다.",
            choices: data?.data?.choices?.length
              ? data.data.choices
              : undefined,
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
      setCurrentSessionId,
      userId,
    ],
  );

  useEffect(() => {
    return registerSender((text: string) => {
      send(text);
    });
  }, [registerSender, send]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!userId || uploading || loading) return;
      if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `파일이 너무 큽니다 (${UPLOAD_MAX_MB}MB 이하만 업로드 가능).`,
          },
        ]);
        return;
      }

      setUploading(true);
      const placeholderIndex = messages.length;
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: "",
          attachment: {
            status: "uploading",
            filename: file.name,
            sizeKb: Math.round(file.size / 1024),
          },
        },
      ]);

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("account_id", userId);
        form.append("original_name", file.name);
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

        setMessages((prev) => {
          const next = [...prev];
          if (next[placeholderIndex]) {
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              attachment: {
                status: "done",
                filename: file.name,
                sizeKb: Math.round(file.size / 1024),
              },
            };
          }
          return next;
        });

        // 업로드된 uploaded_doc artifact 를 캔버스에 반영
        window.dispatchEvent(new CustomEvent("boss:artifacts-changed"));

        // 업로드 완료 후 자동으로 분석 트리거 메시지 전송
        const autoMessage = `방금 업로드한 "${data.title || file.name}" 문서를 공정성 분석해주세요.`;
        await send(autoMessage);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "업로드 실패";
        setMessages((prev) => {
          const next = [...prev];
          if (next[placeholderIndex]) {
            next[placeholderIndex] = {
              ...next[placeholderIndex],
              attachment: {
                status: "error",
                filename: file.name,
                sizeKb: Math.round(file.size / 1024),
                error: msg,
              },
            };
          }
          return next;
        });
      } finally {
        setUploading(false);
      }
    },
    [apiBase, userId, uploading, loading, messages.length, send],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  };

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
                const extracted =
                  msg.role === "assistant"
                    ? extractReviewPayload(msg.content || "")
                    : { cleaned: msg.content, payload: msg.review ?? null };
                const displayText = extracted.cleaned;
                const reviewPayload = msg.review ?? extracted.payload;
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
                <div className="overflow-y-auto">
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      adjustHeight(e.target);
                    }}
                    onKeyDown={handleKeyDown}
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
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploading || loading || !userId}
                      onClick={() => fileInputRef.current?.click()}
                      className="group flex items-center gap-1 rounded-lg p-2 transition-colors hover:bg-[#ebe0ca] disabled:opacity-50"
                      aria-label="문서 첨부 (PDF · DOCX · 이미지)"
                      title="PDF·DOCX·이미지를 첨부하면 공정성 분석을 도와드려요 (이미지는 OCR)"
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
                      disabled={loading || !input.trim()}
                      className={cn(
                        "flex items-center justify-between gap-1 rounded-lg border border-[#ddd0b4] px-1.5 py-1.5 text-sm transition-colors hover:border-[#bfae8a] hover:bg-[#ebe0ca] disabled:opacity-50",
                        input.trim()
                          ? "bg-[#2e2719] text-[#fbf6eb] hover:bg-[#3d3423]"
                          : "text-[#8c7e66]",
                      )}
                      aria-label="보내기"
                    >
                      <ArrowUpIcon
                        className={cn(
                          "h-4 w-4",
                          input.trim() ? "text-[#fbf6eb]" : "text-[#8c7e66]",
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
  );
};
