"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { NodeDetailModal } from "./NodeDetailModal";

type NodeDetailContextValue = {
  openDetail: (artifactId: string) => void;
  closeDetail: () => void;
  currentId: string | null;
};

const NodeDetailContext = createContext<NodeDetailContextValue | null>(null);

export const useNodeDetail = (): NodeDetailContextValue => {
  const ctx = useContext(NodeDetailContext);
  if (!ctx)
    throw new Error("useNodeDetail must be used inside <NodeDetailProvider>");
  return ctx;
};

type ProviderProps = {
  children: ReactNode;
};

export const NodeDetailProvider = ({ children }: ProviderProps) => {
  const [currentId, setCurrentId] = useState<string | null>(null);

  const openDetail = useCallback((artifactId: string) => {
    setCurrentId(artifactId);
  }, []);

  const closeDetail = useCallback(() => {
    setCurrentId(null);
  }, []);

  // Global event bridge so non-React code or deeply nested islands can open the modal.
  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent<{ id?: string }>).detail ?? {};
      if (id) setCurrentId(id);
    };
    window.addEventListener("boss:open-node-detail", handler as EventListener);
    return () =>
      window.removeEventListener(
        "boss:open-node-detail",
        handler as EventListener,
      );
  }, []);

  return (
    <NodeDetailContext.Provider value={{ openDetail, closeDetail, currentId }}>
      {children}
      <NodeDetailModal />
    </NodeDetailContext.Provider>
  );
};
