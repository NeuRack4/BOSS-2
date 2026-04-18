export type Domain = "recruitment" | "marketing" | "sales" | "documents";

const STORAGE_KEY = "boss2:node_positions:quadrant-v1";

export const loadStoredPositions = (): Record<
  string,
  { x: number; y: number }
> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as Record<string, { x: number; y: number }>) ?? {};
  } catch {
    return {};
  }
};

export const saveStoredPositions = (
  positions: Record<string, { x: number; y: number }>,
): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    /* quota or serialization errors are non-fatal */
  }
};

export const updateStoredPosition = (
  id: string,
  position: { x: number; y: number },
): void => {
  const all = loadStoredPositions();
  all[id] = position;
  saveStoredPositions(all);
};
