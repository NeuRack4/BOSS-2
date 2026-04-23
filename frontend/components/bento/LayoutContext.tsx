"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LAYOUT, type WidgetId } from "./widgetRegistry";

type LayoutContextValue = {
  isEditing: boolean;
  isSaving: boolean;
  accountId: string;
  getWidget: (slotId: string) => WidgetId;
  setSlotWidget: (slotId: string, widgetId: WidgetId) => void;
  startEditing: () => void;
  saveLayout: () => Promise<void>;
  resetLayout: () => void;
  cancelEditing: () => void;
};

const LayoutContext = createContext<LayoutContextValue | null>(null);

export const useLayout = () => useContext(LayoutContext);

export const LayoutProvider = ({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) => {
  const [savedLayout, setSavedLayout] = useState<Record<string, WidgetId>>({
    ...DEFAULT_LAYOUT,
  });
  const [pendingLayout, setPendingLayout] = useState<Record<string, WidgetId>>({
    ...DEFAULT_LAYOUT,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    if (!accountId) return;
    fetch(`${apiBase}/api/dashboard/layout?account_id=${accountId}`)
      .then((r) => r.json())
      .then((json) => {
        const raw: Array<{ slotId: string; widgetId: string }> =
          json?.data?.layout ?? [];
        if (raw.length > 0) {
          const loaded = { ...DEFAULT_LAYOUT };
          for (const { slotId, widgetId } of raw) {
            if (slotId in DEFAULT_LAYOUT) loaded[slotId] = widgetId;
          }
          setSavedLayout(loaded);
          setPendingLayout(loaded);
        }
      })
      .catch(() => {});
  }, [accountId, apiBase]);

  const getWidget = useCallback(
    (slotId: string): WidgetId => {
      const layout = isEditing ? pendingLayout : savedLayout;
      return layout[slotId] ?? DEFAULT_LAYOUT[slotId] ?? "profile";
    },
    [isEditing, pendingLayout, savedLayout],
  );

  const setSlotWidget = useCallback((slotId: string, widgetId: WidgetId) => {
    setPendingLayout((prev) => ({ ...prev, [slotId]: widgetId }));
  }, []);

  const startEditing = useCallback(() => {
    setPendingLayout({ ...savedLayout });
    setIsEditing(true);
  }, [savedLayout]);

  const saveLayout = useCallback(async () => {
    setIsSaving(true);
    try {
      const layout = Object.entries(pendingLayout).map(
        ([slotId, widgetId]) => ({ slotId, widgetId }),
      );
      await fetch(`${apiBase}/api/dashboard/layout?account_id=${accountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout, hidden: [] }),
      });
      setSavedLayout({ ...pendingLayout });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }, [accountId, apiBase, pendingLayout]);

  const resetLayout = useCallback(() => {
    setPendingLayout({ ...DEFAULT_LAYOUT });
  }, []);

  const cancelEditing = useCallback(() => {
    setPendingLayout({ ...savedLayout });
    setIsEditing(false);
  }, [savedLayout]);

  return (
    <LayoutContext.Provider
      value={{
        isEditing,
        isSaving,
        accountId,
        getWidget,
        setSlotWidget,
        startEditing,
        saveLayout,
        resetLayout,
        cancelEditing,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};
