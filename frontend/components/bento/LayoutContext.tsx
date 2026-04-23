"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LAYOUT,
  WIDGET_DEFAULT_COLORS,
  type WidgetId,
} from "./widgetRegistry";
import { COLOR_SETS, ALL_COLORS } from "./colorSets";

type LayoutContextValue = {
  isEditing: boolean;
  isSaving: boolean;
  accountId: string;
  getWidget: (slotId: string) => WidgetId;
  getColor: (slotId: string) => string;
  setSlotWidget: (slotId: string, widgetId: WidgetId) => void;
  setSlotColor: (slotId: string, color: string) => void;
  startEditing: () => void;
  saveLayout: () => Promise<void>;
  resetLayout: () => void;
  cancelEditing: () => void;
  randomizeColors: () => void;
  selectedColorSet: string | null;
  setSelectedColorSet: (name: string | null) => void;
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
  const [savedColors, setSavedColors] = useState<Record<string, string>>({});
  const [pendingColors, setPendingColors] = useState<Record<string, string>>(
    {},
  );
  const [selectedColorSet, setSelectedColorSetState] = useState<string | null>(
    null,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const apiBase = process.env.NEXT_PUBLIC_API_URL;

  useEffect(() => {
    if (!accountId) return;
    fetch(`${apiBase}/api/dashboard/layout?account_id=${accountId}`)
      .then((r) => r.json())
      .then((json) => {
        const raw: Array<{
          slotId: string;
          widgetId: string;
          color?: string;
        }> = json?.data?.layout ?? [];
        if (raw.length > 0) {
          const loaded = { ...DEFAULT_LAYOUT };
          const loadedColors: Record<string, string> = {};
          for (const { slotId, widgetId, color } of raw) {
            if (slotId in DEFAULT_LAYOUT) {
              loaded[slotId] = widgetId;
              if (color) loadedColors[slotId] = color;
            }
          }
          setSavedLayout(loaded);
          setPendingLayout(loaded);
          setSavedColors(loadedColors);
          setPendingColors(loadedColors);
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

  const getColor = useCallback(
    (slotId: string): string => {
      const colors = isEditing ? pendingColors : savedColors;
      if (colors[slotId]) return colors[slotId];
      const layout = isEditing ? pendingLayout : savedLayout;
      const widgetId = layout[slotId] ?? DEFAULT_LAYOUT[slotId] ?? "profile";
      return WIDGET_DEFAULT_COLORS[widgetId] ?? "#f5f5f0";
    },
    [isEditing, pendingColors, savedColors, pendingLayout, savedLayout],
  );

  const setSlotWidget = useCallback((slotId: string, widgetId: WidgetId) => {
    setPendingLayout((prev) => ({ ...prev, [slotId]: widgetId }));
  }, []);

  const setSlotColor = useCallback((slotId: string, color: string) => {
    setPendingColors((prev) => ({ ...prev, [slotId]: color }));
  }, []);

  const applyRandomColors = useCallback((palette: string[]) => {
    const slots = Object.keys(DEFAULT_LAYOUT);
    const newColors: Record<string, string> = {};
    for (const slotId of slots) {
      newColors[slotId] = palette[Math.floor(Math.random() * palette.length)];
    }
    setPendingColors(newColors);
  }, []);

  const randomizeColors = useCallback(() => {
    if (selectedColorSet) {
      const cs = COLOR_SETS.find((c) => c.name === selectedColorSet);
      if (cs) {
        applyRandomColors(cs.colors);
        return;
      }
    }
    applyRandomColors(ALL_COLORS);
  }, [selectedColorSet, applyRandomColors]);

  const setSelectedColorSet = useCallback(
    (name: string | null) => {
      setSelectedColorSetState(name);
      if (name) {
        const cs = COLOR_SETS.find((c) => c.name === name);
        if (cs) applyRandomColors(cs.colors);
      }
    },
    [applyRandomColors],
  );

  const startEditing = useCallback(() => {
    setPendingLayout({ ...savedLayout });
    setPendingColors({ ...savedColors });
    setIsEditing(true);
  }, [savedLayout, savedColors]);

  const saveLayout = useCallback(async () => {
    setIsSaving(true);
    try {
      const layout = Object.entries(pendingLayout).map(
        ([slotId, widgetId]) => ({
          slotId,
          widgetId,
          ...(pendingColors[slotId] ? { color: pendingColors[slotId] } : {}),
        }),
      );
      await fetch(`${apiBase}/api/dashboard/layout?account_id=${accountId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout, hidden: [] }),
      });
      setSavedLayout({ ...pendingLayout });
      setSavedColors({ ...pendingColors });
      setIsEditing(false);
      setSelectedColorSetState(null);
    } finally {
      setIsSaving(false);
    }
  }, [accountId, apiBase, pendingLayout, pendingColors]);

  const resetLayout = useCallback(() => {
    setPendingLayout({ ...DEFAULT_LAYOUT });
    setPendingColors({});
    setSelectedColorSetState(null);
  }, []);

  const cancelEditing = useCallback(() => {
    setPendingLayout({ ...savedLayout });
    setPendingColors({ ...savedColors });
    setSelectedColorSetState(null);
    setIsEditing(false);
  }, [savedLayout, savedColors]);

  return (
    <LayoutContext.Provider
      value={{
        isEditing,
        isSaving,
        accountId,
        getWidget,
        getColor,
        setSlotWidget,
        setSlotColor,
        startEditing,
        saveLayout,
        resetLayout,
        cancelEditing,
        randomizeColors,
        selectedColorSet,
        setSelectedColorSet,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};
