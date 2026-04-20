"use client";

import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  widthClass?: string;
};

export const Modal = ({
  open,
  onClose,
  title,
  children,
  widthClass = "w-[480px]",
}: ModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2e2719]/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "flex max-h-[90vh] flex-col rounded-xl border border-[#ddd0b4] bg-[#fffaf2] shadow-xl",
          widthClass,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#ddd0b4] px-4 py-3">
          <h3 className="text-sm font-semibold text-[#2e2719]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#2e2719]"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          {children}
        </div>
      </div>
    </div>
  );
};
