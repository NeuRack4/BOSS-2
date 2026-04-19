"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type MenuItem = {
  key: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

type Props = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

export const NodeContextMenu = ({ x, y, items, onClose }: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const maxX = typeof window !== "undefined" ? window.innerWidth - 220 : x;
  const maxY =
    typeof window !== "undefined"
      ? window.innerHeight - items.length * 32 - 8
      : y;

  return (
    <div
      ref={ref}
      className="fixed z-[90] w-[200px] overflow-hidden rounded-lg border border-[#ddd0b4] bg-[#fffaf2] py-1 shadow-xl"
      style={{
        left: Math.min(x, maxX),
        top: Math.min(y, maxY),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
            item.disabled
              ? "cursor-not-allowed text-[#bfae8a]"
              : item.destructive
                ? "text-[#b85a4a] hover:bg-[#b85a4a]/10"
                : "text-[#2e2719] hover:bg-[#ebe0ca]",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};
