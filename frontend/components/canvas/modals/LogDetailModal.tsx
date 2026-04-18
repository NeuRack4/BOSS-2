"use client";

import { Modal } from "@/components/ui/modal";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
};

export const LogDetailModal = ({
  open,
  onClose,
  title,
  content,
  metadata,
}: Props) => (
  <Modal
    open={open}
    onClose={onClose}
    title={`로그: ${title}`}
    widthClass="w-[560px]"
  >
    <ScrollArea className="max-h-[420px] pr-2">
      <div className="space-y-2">
        {content && (
          <div className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-200">
            {content}
          </div>
        )}
        {Object.keys(metadata).length > 0 && (
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
              metadata
            </p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-zinc-300">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </div>
        )}
        {!content && Object.keys(metadata).length === 0 && (
          <p className="py-6 text-center text-[12px] text-zinc-500">
            표시할 내용이 없습니다.
          </p>
        )}
      </div>
    </ScrollArea>
  </Modal>
);
