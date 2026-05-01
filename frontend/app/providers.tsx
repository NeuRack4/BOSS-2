"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";
import { AdminFab } from "@/components/layout/AdminFab";
import { OnboardingProvider } from "@/components/onboarding/OnboardingContext";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>
    <NodeDetailProvider>
      <OnboardingProvider>
        {children}
        <AdminFab />
        <OnboardingTour />
      </OnboardingProvider>
    </NodeDetailProvider>
  </ChatProvider>
);
