"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";

export type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

// Minimal base type for persistent message storage — InlineChat casts to its full Message type
export type ChatMessageBase = {
  role: string;
  content: string;
};

type ChatSendFn = (text: string) => void;

export type SpeakerKey =
  | "orchestrator"
  | "recruitment"
  | "marketing"
  | "sales"
  | "documents";

type ChatContextValue = {
  registerSender: (fn: ChatSendFn) => () => void;
  send: (text: string) => void;
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;
  sessions: ChatSession[];
  setSessions: React.Dispatch<React.SetStateAction<ChatSession[]>>;
  requestNewSession: () => void;
  newSessionTick: number;
  requestLoadSession: (id: string) => void;
  loadSessionTick: number;
  pendingLoadSessionId: string | null;
  pendingBriefing: string | null;
  openChatWithBriefing: (content: string) => void;
  consumeBriefing: () => void;
  lastSpeaker: SpeakerKey[] | null;
  setLastSpeaker: (next: SpeakerKey[] | null) => void;
  // Lifted state — survives page navigation
  messages: ChatMessageBase[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessageBase[]>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  userId: string | null;
  fetchSessions: () => Promise<void>;
  avatarUrl: string | null;
  setAvatarUrl: React.Dispatch<React.SetStateAction<string | null>>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const senderRef = useRef<ChatSendFn | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [newSessionTick, setNewSessionTick] = useState(0);
  const [loadSessionTick, setLoadSessionTick] = useState(0);
  const [pendingLoadSessionId, setPendingLoadSessionId] = useState<
    string | null
  >(null);
  const [pendingBriefing, setPendingBriefing] = useState<string | null>(null);
  const [lastSpeaker, setLastSpeakerState] = useState<SpeakerKey[] | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessageBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        setAvatarUrl(
          (data as { avatar_url: string | null } | null)?.avatar_url ?? null,
        );
      });
  }, [userId]);

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
  }, [apiBase, userId]);

  useEffect(() => {
    if (userId) fetchSessions();
  }, [userId, fetchSessions]);

  const setLastSpeaker = useCallback((next: SpeakerKey[] | null) => {
    setLastSpeakerState(next && next.length ? next : null);
  }, []);

  const registerSender = useCallback((fn: ChatSendFn) => {
    senderRef.current = fn;
    return () => {
      if (senderRef.current === fn) senderRef.current = null;
    };
  }, []);

  const requestNewSession = useCallback(() => {
    setCurrentSessionId(null);
    setNewSessionTick((t) => t + 1);
  }, []);

  const requestLoadSession = useCallback((id: string) => {
    setPendingLoadSessionId(id);
    setLoadSessionTick((t) => t + 1);
  }, []);

  const send = useCallback((text: string) => {
    senderRef.current?.(text);
  }, []);

  const openChatWithBriefing = useCallback((content: string) => {
    setPendingBriefing(content);
  }, []);

  const consumeBriefing = useCallback(() => {
    setPendingBriefing(null);
  }, []);

  const value = useMemo(
    () => ({
      registerSender,
      send,
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
      openChatWithBriefing,
      consumeBriefing,
      lastSpeaker,
      setLastSpeaker,
      messages,
      setMessages,
      loading,
      setLoading,
      userId,
      fetchSessions,
      avatarUrl,
      setAvatarUrl,
    }),
    [
      registerSender,
      send,
      currentSessionId,
      sessions,
      requestNewSession,
      newSessionTick,
      requestLoadSession,
      loadSessionTick,
      pendingLoadSessionId,
      pendingBriefing,
      openChatWithBriefing,
      consumeBriefing,
      lastSpeaker,
      setLastSpeaker,
      messages,
      loading,
      userId,
      fetchSessions,
      avatarUrl,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
};
