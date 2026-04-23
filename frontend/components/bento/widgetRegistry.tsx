"use client";

import type { ReactNode } from "react";
import { ProfileWidget } from "./widgets/ProfileWidget";
import { LongMemoryWidget } from "./widgets/LongMemoryWidget";
import { MemosWidget } from "./widgets/MemosWidget";
import { DomainCard } from "./DomainCard";
import { PreviousChatCard } from "./PreviousChatCard";
import { ScheduleCard } from "./ScheduleCard";
import { ActivityCard } from "./ActivityCard";
import { CommentQueueCard } from "./CommentQueueCard";
import { SubsidyMatchCard } from "./SubsidyMatchCard";
import type { DashboardSummary, DomainStats } from "./types";

export type WidgetId = string;

export type WidgetRenderProps = {
  accountId: string;
  summary: DashboardSummary | null;
  bgColor?: string;
};

export type WidgetDef = {
  id: WidgetId;
  label: string;
  render: (props: WidgetRenderProps) => ReactNode;
};

export const WIDGET_DEFAULT_COLORS: Record<string, string> = {
  profile: "#f1d9c7",
  "long-memory": "#eee3c4",
  memos: "#c6dad1",
  "domain-recruitment": "#f1d9c7",
  "domain-sales": "#cfd9cc",
  "domain-marketing": "#f4dbd9",
  "domain-documents": "#d9d4e6",
  "previous-chat": "#d9d4e6",
  schedule: "#eee3c4",
  activity: "#c6dad1",
  "comment-queue": "#f4dbd9",
  subsidy: "#cfd9cc",
};

const EMPTY_STATS: DomainStats = {
  active_count: 0,
  upcoming_count: 0,
  recent_count: 0,
  total_count: 0,
  recent_titles: [],
};

// Add new widgets here — each entry becomes available in the picker automatically.
export const WIDGET_REGISTRY: WidgetDef[] = [
  {
    id: "profile",
    label: "Profile",
    render: ({ bgColor }) => <ProfileWidget bgColor={bgColor} />,
  },
  {
    id: "long-memory",
    label: "Long-term Memory",
    render: ({ bgColor }) => <LongMemoryWidget bgColor={bgColor} />,
  },
  {
    id: "memos",
    label: "Memos",
    render: ({ bgColor }) => <MemosWidget bgColor={bgColor} />,
  },
  {
    id: "domain-recruitment",
    label: "Recruitment",
    render: ({ summary, bgColor }) => (
      <DomainCard
        domain="recruitment"
        stats={summary?.domains?.recruitment ?? EMPTY_STATS}
        bgColor={bgColor}
      />
    ),
  },
  {
    id: "domain-sales",
    label: "Sales",
    render: ({ summary, bgColor }) => (
      <DomainCard
        domain="sales"
        stats={summary?.domains?.sales ?? EMPTY_STATS}
        bgColor={bgColor}
      />
    ),
  },
  {
    id: "domain-marketing",
    label: "Marketing",
    render: ({ summary, bgColor }) => (
      <DomainCard
        domain="marketing"
        stats={summary?.domains?.marketing ?? EMPTY_STATS}
        bgColor={bgColor}
      />
    ),
  },
  {
    id: "domain-documents",
    label: "Documents",
    render: ({ summary, bgColor }) => (
      <DomainCard
        domain="documents"
        stats={summary?.domains?.documents ?? EMPTY_STATS}
        bgColor={bgColor}
      />
    ),
  },
  {
    id: "previous-chat",
    label: "Chat History",
    render: ({ bgColor }) => <PreviousChatCard bgColor={bgColor} />,
  },
  {
    id: "schedule",
    label: "Schedule",
    render: ({ summary, bgColor }) => (
      <ScheduleCard items={summary?.upcoming ?? []} bgColor={bgColor} />
    ),
  },
  {
    id: "activity",
    label: "Activity",
    render: ({ summary, bgColor }) => (
      <ActivityCard items={summary?.recent_activity ?? []} bgColor={bgColor} />
    ),
  },
  {
    id: "comment-queue",
    label: "Comment Queue",
    render: ({ accountId, bgColor }) => (
      <CommentQueueCard accountId={accountId} bgColor={bgColor} />
    ),
  },
  {
    id: "subsidy",
    label: "Subsidy Match",
    render: ({ accountId, bgColor }) => (
      <SubsidyMatchCard accountId={accountId} bgColor={bgColor} />
    ),
  },
];

export const WIDGET_MAP = new Map<WidgetId, WidgetDef>(
  WIDGET_REGISTRY.map((w) => [w.id, w]),
);

export const DEFAULT_LAYOUT: Record<string, WidgetId> = {
  "sidebar-0": "profile",
  "sidebar-1": "long-memory",
  "sidebar-2": "memos",
  "main-col7-top": "domain-recruitment",
  "main-col7-bottom": "domain-sales",
  "main-col10-top": "domain-marketing",
  "main-col10-bottom": "domain-documents",
  "main-prev-chat": "previous-chat",
  "main-schedule": "schedule",
  "main-activity": "activity",
  "main-comment": "comment-queue",
  "main-subsidy": "subsidy",
};
