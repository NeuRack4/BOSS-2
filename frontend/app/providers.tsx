"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";
import { AdminFab } from "@/components/layout/AdminFab";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>
    <NodeDetailProvider>
      {children}
      <AdminFab />
    </NodeDetailProvider>
  </ChatProvider>
);
