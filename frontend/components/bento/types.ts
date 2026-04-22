export type DomainKey = "recruitment" | "marketing" | "sales" | "documents";

export const ALL_DOMAINS: DomainKey[] = [
  "recruitment",
  "marketing",
  "sales",
  "documents",
];

export const DOMAIN_LABEL: Record<DomainKey, string> = {
  recruitment: "Recruitment",
  marketing: "Marketing",
  sales: "Sales",
  documents: "Documents",
};

export type DomainStats = {
  active_count: number;
  upcoming_count: number;
  recent_count: number;
  total_count: number;
  recent_titles: Array<{ id: string; title: string }>;
};

export type ScheduleItem = {
  id: string;
  title: string;
  domain: DomainKey | null;
  date: string;
  kind: "due" | "start";
  label: string;
};

export type ActivityItem = {
  type: string;
  domain?: DomainKey | null;
  title?: string | null;
  description?: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

export type DashboardSummary = {
  domains: Record<DomainKey, DomainStats>;
  upcoming: ScheduleItem[];
  recent_activity: ActivityItem[];
};

export const DOMAIN_META: Record<
  DomainKey,
  {
    label: string;
    bg: string;
    ring: string;
    accent: string;
    isDark: boolean;
  }
> = {
  recruitment: {
    label: "Recruitment",
    bg: "bg-[#f1d9c7]",
    ring: "ring-[#f1d9c7]/40",
    accent: "#d4a588",
    isDark: false,
  },
  marketing: {
    label: "Marketing",
    bg: "bg-[#f4dbd9]",
    ring: "ring-[#f4dbd9]/40",
    accent: "#c78897",
    isDark: false,
  },
  sales: {
    label: "Sales",
    bg: "bg-[#cfd9cc]",
    ring: "ring-[#cfd9cc]/40",
    accent: "#7ba8a4",
    isDark: false,
  },
  documents: {
    label: "Documents",
    bg: "bg-[#d9d4e6]",
    ring: "ring-[#d9d4e6]/40",
    accent: "#7977a0",
    isDark: false,
  },
};
