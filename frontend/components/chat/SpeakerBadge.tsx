"use client";

import { cn } from "@/lib/utils";
import { DOMAIN_META, type DomainKey } from "@/components/bento/types";
import type { SpeakerKey } from "@/components/chat/ChatContext";

const LABELS: Record<SpeakerKey, string> = {
  orchestrator: "Orchestrator",
  recruitment: "Recruitment",
  marketing: "Marketing",
  sales: "Sales",
  documents: "Documents",
};

// Orchestrator 는 중립 회색, 도메인은 bento/types.ts 의 DOMAIN_META 색을 재활용.
const chipStyle = (key: SpeakerKey): React.CSSProperties => {
  if (key === "orchestrator") {
    return {
      backgroundColor: "#f1efeb",
      color: "#030303",
      borderColor: "rgba(3, 3, 3, 0.12)",
    };
  }
  const meta = DOMAIN_META[key as DomainKey];
  return {
    backgroundColor: meta.bg.replace("bg-[", "").replace("]", ""),
    color: "#030303",
    borderColor: meta.accent,
  };
};

type Props = {
  speakers: SpeakerKey[] | null;
  className?: string;
};

export const SpeakerBadge = ({ speakers, className }: Props) => {
  const list = speakers && speakers.length ? speakers : null;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5 text-[11px] font-medium",
        className,
      )}
    >
      <span className="uppercase tracking-wider text-[10px] text-[#030303]/50">
        Last speaker
      </span>
      {list ? (
        list.map((key) => (
          <span
            key={key}
            className="inline-flex items-center rounded-full border px-2 py-0.5 leading-4"
            style={chipStyle(key)}
            title={LABELS[key] ?? key}
          >
            {LABELS[key] ?? key}
          </span>
        ))
      ) : (
        <span className="inline-flex items-center rounded-full border border-[#030303]/10 bg-[#fcfcfc] px-2 py-0.5 leading-4 text-[#030303]/40">
          Ready
        </span>
      )}
    </div>
  );
};
