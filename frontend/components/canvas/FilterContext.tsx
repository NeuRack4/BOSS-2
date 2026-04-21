"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from "react";

export type Domain = "recruitment" | "marketing" | "sales" | "documents";

export const ALL_DOMAINS: Domain[] = [
  "recruitment",
  "marketing",
  "sales",
  "documents",
];

export const DOMAIN_LABEL: Record<Domain, string> = {
  recruitment: "Recruitment",
  marketing: "Marketing",
  sales: "Sales",
  documents: "Documents",
};

export type TimeRange = number | null;

type FilterContextValue = {
  timeRangeDays: TimeRange;
  setTimeRangeDays: (v: TimeRange) => void;
  selectedDomains: Set<Domain>;
  toggleDomain: (d: Domain) => void;
  setAllDomains: (on: boolean) => void;
  showArchive: boolean;
  setShowArchive: (v: boolean) => void;
};

const FilterContext = createContext<FilterContextValue | null>(null);

export const FilterProvider = ({ children }: { children: ReactNode }) => {
  const [timeRangeDays, setTimeRangeDays] = useState<TimeRange>(7);
  const [selectedDomains, setSelectedDomains] = useState<Set<Domain>>(
    () => new Set(ALL_DOMAINS),
  );
  const [showArchive, setShowArchive] = useState<boolean>(false);

  const toggleDomain = useCallback((d: Domain) => {
    setSelectedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }, []);

  const setAllDomains = useCallback((on: boolean) => {
    setSelectedDomains(on ? new Set(ALL_DOMAINS) : new Set());
  }, []);

  const value = useMemo(
    () => ({
      timeRangeDays,
      setTimeRangeDays,
      selectedDomains,
      toggleDomain,
      setAllDomains,
      showArchive,
      setShowArchive,
    }),
    [timeRangeDays, selectedDomains, toggleDomain, setAllDomains, showArchive],
  );

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
};

export const useFilter = () => {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used inside FilterProvider");
  return ctx;
};
