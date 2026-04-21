"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <NodeDetailProvider>{children}</NodeDetailProvider>
);
