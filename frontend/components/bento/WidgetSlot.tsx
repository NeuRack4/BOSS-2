"use client";

import { useEffect, useRef, useState } from "react";
import { useLayout } from "./LayoutContext";
import {
  WIDGET_MAP,
  WIDGET_REGISTRY,
  type WidgetRenderProps,
} from "./widgetRegistry";

type Props = {
  slotId: string;
  renderProps: WidgetRenderProps;
};

export const WidgetSlot = ({ slotId, renderProps }: Props) => {
  const ctx = useLayout();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // Close picker when leaving edit mode
  useEffect(() => {
    if (!ctx?.isEditing) setPickerOpen(false);
  }, [ctx?.isEditing]);

  const widgetId = ctx?.getWidget(slotId) ?? "profile";
  const widget = WIDGET_MAP.get(widgetId);

  if (!widget) return null;

  if (!ctx?.isEditing) {
    return <>{widget.render(renderProps)}</>;
  }

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none h-full w-full opacity-50">
        {widget.render(renderProps)}
      </div>

      {/* Edit overlay */}
      <div className="absolute inset-0 flex items-center justify-center rounded-[5px] ring-2 ring-[#5a5040]/40">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="rounded-md bg-[#2e2719]/80 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-[#2e2719]"
        >
          Change
        </button>
      </div>

      {/* Widget picker */}
      {pickerOpen && (
        <div
          ref={pickerRef}
          className="absolute left-1/2 top-1/2 z-50 max-h-64 w-52 -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-[#ddd0b4] bg-[#fcfcf8] py-1 shadow-xl"
        >
          {WIDGET_REGISTRY.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                ctx.setSlotWidget(slotId, w.id);
                setPickerOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] transition-colors hover:bg-[#ebe0ca] ${
                w.id === widgetId
                  ? "font-semibold text-[#2e2719]"
                  : "text-[#5a5040]"
              }`}
            >
              <span className="w-3 shrink-0">
                {w.id === widgetId ? "✓" : ""}
              </span>
              {w.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
