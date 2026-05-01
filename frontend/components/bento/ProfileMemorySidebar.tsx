"use client";

import { WidgetSlot } from "./WidgetSlot";
import type { WidgetRenderProps } from "./widgetRegistry";

type Props = {
  renderProps: WidgetRenderProps;
};

export const ProfileMemorySidebar = ({ renderProps }: Props) => (
  <aside
    className="hidden min-w-[220px] max-w-[320px] flex-1 basis-0 flex-col gap-4 self-stretch min-[1500px]:flex"
    aria-label="프로필 및 기억"
  >
    <div data-tour-id="profiles" className="min-h-0 flex-1 basis-0">
      <WidgetSlot slotId="sidebar-0" renderProps={renderProps} />
    </div>
    <div data-tour-id="longterm-memory" className="min-h-0 flex-1 basis-0">
      <WidgetSlot slotId="sidebar-1" renderProps={renderProps} />
    </div>
    <div data-tour-id="memos" className="min-h-0 flex-[0.75] basis-0">
      <WidgetSlot slotId="sidebar-2" renderProps={renderProps} />
    </div>
  </aside>
);
