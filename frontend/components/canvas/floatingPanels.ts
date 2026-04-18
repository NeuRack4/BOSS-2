export type FloatingPanelState = {
  x: number;
  y: number;
  minimized: boolean;
};

const STORAGE_KEY = "boss2:floating_panels:v1";

const loadAll = (): Record<string, FloatingPanelState> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as Record<string, FloatingPanelState>) ?? {};
  } catch {
    return {};
  }
};

const saveAll = (all: Record<string, FloatingPanelState>): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota or serialization errors are non-fatal */
  }
};

export const loadPanelState = (id: string): FloatingPanelState | null => {
  return loadAll()[id] ?? null;
};

export const savePanelState = (id: string, state: FloatingPanelState): void => {
  const all = loadAll();
  all[id] = state;
  saveAll(all);
};
