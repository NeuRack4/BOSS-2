"use client";

import { useEffect } from "react";
import { useChat } from "./ChatContext";

const STORAGE_KEY = "boss2:pending-briefing";

export const BriefingLoader = () => {
  const { openChatWithBriefing } = useChat();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const content = sessionStorage.getItem(STORAGE_KEY);
    if (!content) return;
    sessionStorage.removeItem(STORAGE_KEY);
    openChatWithBriefing(content);
  }, [openChatWithBriefing]);

  return null;
};
