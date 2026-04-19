"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
};

export const ConfirmModal = ({
  open,
  onClose,
  title,
  message,
  confirmLabel = "확인",
  destructive = false,
  onConfirm,
}: Props) => {
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} widthClass="w-[400px]">
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#2e2719]">
        {message}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          취소
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={pending}
          className={
            destructive
              ? "bg-[#b85a4a] text-[#fbf6eb] hover:bg-[#9a4a3a]"
              : "bg-[#7f8f54] text-[#fbf6eb] hover:bg-[#6a7843]"
          }
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            confirmLabel
          )}
        </Button>
      </div>
    </Modal>
  );
};
