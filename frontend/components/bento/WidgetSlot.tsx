"use client";

import { useEffect, useRef, useState } from "react";
import { useLayout } from "./LayoutContext";
import { ALL_COLORS } from "./colorSets";
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
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen && !colorPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(e.target as Node) &&
        colorPickerRef.current &&
        !colorPickerRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
        setColorPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen, colorPickerOpen]);

  // Close pickers when leaving edit mode
  useEffect(() => {
    if (!ctx?.isEditing) {
      setPickerOpen(false);
      setColorPickerOpen(false);
    }
  }, [ctx?.isEditing]);

  const widgetId = ctx?.getWidget(slotId) ?? "profile";
  const widget = WIDGET_MAP.get(widgetId);
  const bgColor = ctx?.getColor(slotId);

  if (!widget) return null;

  const isEditing = ctx?.isEditing ?? false;
  const enrichedProps: WidgetRenderProps = { ...renderProps, bgColor };

  return (
    <div className="relative h-full w-full">
      <div
        className={
          isEditing
            ? "pointer-events-none h-full w-full opacity-50"
            : "h-full w-full"
        }
      >
        {widget.render(enrichedProps)}
      </div>

      {isEditing && (
        <>
          {/* Edit overlay */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-[5px] ring-2 ring-[#5a5040]/40">
            <button
              type="button"
              onClick={() => {
                setPickerOpen((v) => !v);
                setColorPickerOpen(false);
              }}
              className="rounded-md bg-[#2e2719]/80 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-[#2e2719]"
            >
              Change
            </button>
            <button
              type="button"
              onClick={() => {
                setColorPickerOpen((v) => !v);
                setPickerOpen(false);
              }}
              className="rounded-md bg-[#2e2719]/80 px-2 py-1.5 text-[14px] shadow-lg backdrop-blur-sm transition-colors hover:bg-[#2e2719]"
              title="Change color"
            >
              🎨
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
                    ctx!.setSlotWidget(slotId, w.id);
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

          {/* Color picker */}
          {colorPickerOpen && (
            <div
              ref={colorPickerRef}
              className="absolute left-1/2 top-1/2 z-50 w-52 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#ddd0b4] bg-[#fcfcf8] p-3 shadow-xl"
            >
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#5a5040]">
                Pick color
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {ALL_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => {
                      ctx!.setSlotColor(slotId, color);
                      setColorPickerOpen(false);
                    }}
                    title={color}
                    className="h-6 w-6 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: color,
                      outline: bgColor === color ? "2px solid #2e2719" : "none",
                      outlineOffset: "1px",
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
