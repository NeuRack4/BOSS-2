export type DomainKey = "recruitment" | "marketing" | "sales" | "documents";

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
    bg: "bg-[#ecdbca]",
    ring: "ring-[#ecdbca]/40",
    accent: "#ecdbca",
    isDark: false,
  },
  marketing: {
    label: "Marketing",
    bg: "bg-[#e5d4c4]",
    ring: "ring-[#e5d4c4]/40",
    accent: "#e5d4c4",
    isDark: false,
  },
  sales: {
    label: "Sales",
    bg: "bg-[#decab7]",
    ring: "ring-[#decab7]/40",
    accent: "#decab7",
    isDark: false,
  },
  documents: {
    label: "Documents",
    bg: "bg-[#d7bfa8]",
    ring: "ring-[#d7bfa8]/40",
    accent: "#d7bfa8",
    isDark: false,
  },
};
