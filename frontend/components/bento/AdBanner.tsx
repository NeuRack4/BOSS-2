"use client";

type Props = {
  side: "left" | "right";
};

type Slot = {
  flex: number;
  bg: string;
  isSolid: boolean;
  isDark?: boolean;
};

const SLOTS: Record<"left" | "right", { top: Slot; bottom: Slot }> = {
  left: {
    top: { flex: 4, bg: "#d5bfa9", isSolid: true, isDark: false },
    bottom: { flex: 6, bg: "#c3cdcf", isSolid: true, isDark: false },
  },
  right: {
    top: { flex: 6, bg: "#d5bfa9", isSolid: true, isDark: false },
    bottom: { flex: 4, bg: "#c3cdcf", isSolid: true, isDark: false },
  },
};

export const AdBanner = ({ side }: Props) => {
  const { top, bottom } = SLOTS[side];

  const slotClass = (slot: Slot): string =>
    slot.isSolid
      ? "flex flex-col items-center justify-center rounded-[5px] p-4 text-center text-[11px] shadow-lg"
      : "flex flex-col items-center justify-center rounded-[5px] border border-dashed border-[#fcfcfc]/15 bg-[#fcfcfc]/[0.04] p-4 text-center text-[11px] text-[#fcfcfc]/40";

  const labelClass = (slot: Slot): string => {
    if (!slot.isSolid) return "font-medium text-[#fcfcfc]/70";
    return slot.isDark
      ? "font-medium text-[#fcfcfc]"
      : "font-medium text-[#030303]";
  };

  const subLabelClass = (slot: Slot): string => {
    if (!slot.isSolid) return "text-[#fcfcfc]/40";
    return slot.isDark ? "text-[#fcfcfc]/70" : "text-[#030303]/60";
  };

  return (
    <aside
      className="hidden min-w-[180px] max-w-[320px] flex-1 basis-0 flex-col gap-4 self-stretch min-[1500px]:flex"
      aria-label={`${side === "left" ? "좌측" : "우측"} 광고 영역`}
    >
      <div
        className={slotClass(top)}
        style={{
          flex: top.flex,
          backgroundColor: top.isSolid ? top.bg : undefined,
        }}
      >
        <div className={labelClass(top)}>광고</div>
        <div className={`mt-1 text-[10px] ${subLabelClass(top)}`}>top</div>
      </div>
      <div
        className={slotClass(bottom)}
        style={{
          flex: bottom.flex,
          backgroundColor: bottom.isSolid ? bottom.bg : undefined,
        }}
      >
        <div className={labelClass(bottom)}>광고</div>
        <div className={`mt-1 text-[10px] ${subLabelClass(bottom)}`}>
          bottom
        </div>
      </div>
    </aside>
  );
};
