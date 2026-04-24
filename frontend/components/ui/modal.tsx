"use client";

import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ModalVariant = "sand" | "dashboard";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  widthClass?: string;
  variant?: ModalVariant;
};

const VARIANT_STYLES: Record<
  ModalVariant,
  {
    panel: string;
    header: string;
    title: string;
    closeBtn: string;
  }
> = {
  sand: {
    panel: "rounded-xl border border-[#ddd0b4] bg-[#fffaf2]",
    header: "border-b border-[#ddd0b4]",
    title: "text-[#2e2719]",
    closeBtn: "text-[#8c7e66] hover:bg-[#ebe0ca] hover:text-[#2e2719]",
  },
  dashboard: {
    panel: "rounded-[5px] border border-[#030303]/10 bg-[#f4f1ed]",
    header: "border-b border-[#030303]/[0.08]",
    title: "text-[#030303]",
    closeBtn:
      "text-[#030303]/60 hover:bg-[#030303]/[0.05] hover:text-[#030303]",
  },
};

export const Modal = ({
  open,
  onClose,
  title,
  children,
  widthClass = "w-[480px]",
  variant = "sand",
}: ModalProps) => {
  const styles = VARIANT_STYLES[variant];
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2e2719]/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "flex max-h-[90vh] flex-col shadow-xl",
          styles.panel,
          widthClass,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            "flex shrink-0 items-center justify-between px-4 py-3",
            styles.header,
          )}
        >
          <h3 className={cn("text-sm font-semibold", styles.title)}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className={cn("rounded p-1", styles.closeBtn)}
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
