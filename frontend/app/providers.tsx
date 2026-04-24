"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>
    <NodeDetailProvider>{children}</NodeDetailProvider>
  </ChatProvider>
);
