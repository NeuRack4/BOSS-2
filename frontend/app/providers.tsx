"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";
import { AdminFab } from "@/components/layout/AdminFab";
import { TourProvider } from "@/components/tour/TourContext";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <TourProvider>
    <ChatProvider>
      <NodeDetailProvider>
        {children}
        <AdminFab />
      </NodeDetailProvider>
    </ChatProvider>
  </TourProvider>
);
