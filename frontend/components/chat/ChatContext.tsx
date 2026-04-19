"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";

export type ChatSession = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type ChatSendFn = (text: string) => void;

type ChatContextValue = {
  registerSender: (fn: ChatSendFn) => () => void;
  send: (text: string) => void;
  isChatOpen: boolean;
  openChat: (seed?: string) => void;
  closeChat: () => void;
  seedText: string | null;
  consumeSeed: () => void;
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
};

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const senderRef = useRef<ChatSendFn | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [seedText, setSeedText] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [newSessionTick, setNewSessionTick] = useState(0);
  const [loadSessionTick, setLoadSessionTick] = useState(0);
  const [pendingLoadSessionId, setPendingLoadSessionId] = useState<
    string | null
  >(null);
  const [pendingBriefing, setPendingBriefing] = useState<string | null>(null);

  const registerSender = useCallback((fn: ChatSendFn) => {
    senderRef.current = fn;
    return () => {
      if (senderRef.current === fn) senderRef.current = null;
    };
  }, []);

  const openChat = useCallback((seed?: string) => {
    if (typeof seed === "string") setSeedText(seed);
    setIsChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setIsChatOpen(false);
  }, []);

  const consumeSeed = useCallback(() => {
    setSeedText(null);
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
    setIsChatOpen(true);
    senderRef.current?.(text);
  }, []);

  const openChatWithBriefing = useCallback((content: string) => {
    setPendingBriefing(content);
    setIsChatOpen(true);
  }, []);

  const consumeBriefing = useCallback(() => {
    setPendingBriefing(null);
  }, []);

  const value = useMemo(
    () => ({
      registerSender,
      send,
      isChatOpen,
      openChat,
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
      openChatWithBriefing,
      consumeBriefing,
    }),
    [
      registerSender,
      send,
      isChatOpen,
      openChat,
      closeChat,
      seedText,
      consumeSeed,
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
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside ChatProvider");
  return ctx;
};
