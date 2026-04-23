"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { NodeDetailModal, EmployeeDetailModal } from "./NodeDetailModal";

export type EmployeeContext = {
  employeeId: string;
  accountId: string;
};

type NodeDetailContextValue = {
  openDetail: (artifactId: string) => void;
  openEmployee: (employeeId: string, accountId: string) => void;
  closeDetail: () => void;
  currentId: string | null;
  employeeCtx: EmployeeContext | null;
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
  const [employeeCtx, setEmployeeCtx] = useState<EmployeeContext | null>(null);

  const openDetail = useCallback((artifactId: string) => {
    setEmployeeCtx(null);
    setCurrentId(artifactId);
  }, []);

  const openEmployee = useCallback((employeeId: string, accountId: string) => {
    setCurrentId(null);
    setEmployeeCtx({ employeeId, accountId });
  }, []);

  const closeDetail = useCallback(() => {
    setCurrentId(null);
    setEmployeeCtx(null);
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
    <NodeDetailContext.Provider
      value={{ openDetail, openEmployee, closeDetail, currentId, employeeCtx }}
    >
      {children}
      <NodeDetailModal />
      {employeeCtx && (
        <EmployeeDetailModal
          employeeId={employeeCtx.employeeId}
          accountId={employeeCtx.accountId}
          onClose={closeDetail}
        />
      )}
    </NodeDetailContext.Provider>
  );
};
