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
};

export type WidgetDef = {
  id: WidgetId;
  label: string;
  render: (props: WidgetRenderProps) => ReactNode;
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
    render: () => <ProfileWidget />,
  },
  {
    id: "long-memory",
    label: "Long-term Memory",
    render: () => <LongMemoryWidget />,
  },
  {
    id: "memos",
    label: "Memos",
    render: () => <MemosWidget />,
  },
  {
    id: "domain-recruitment",
    label: "Recruitment",
    render: ({ summary }) => (
      <DomainCard
        domain="recruitment"
        stats={summary?.domains?.recruitment ?? EMPTY_STATS}
      />
    ),
  },
  {
    id: "domain-sales",
    label: "Sales",
    render: ({ summary }) => (
      <DomainCard
        domain="sales"
        stats={summary?.domains?.sales ?? EMPTY_STATS}
      />
    ),
  },
  {
    id: "domain-marketing",
    label: "Marketing",
    render: ({ summary }) => (
      <DomainCard
        domain="marketing"
        stats={summary?.domains?.marketing ?? EMPTY_STATS}
      />
    ),
  },
  {
    id: "domain-documents",
    label: "Documents",
    render: ({ summary }) => (
      <DomainCard
        domain="documents"
        stats={summary?.domains?.documents ?? EMPTY_STATS}
      />
    ),
  },
  {
    id: "previous-chat",
    label: "Chat History",
    render: () => <PreviousChatCard />,
  },
  {
    id: "schedule",
    label: "Schedule",
    render: ({ summary }) => <ScheduleCard items={summary?.upcoming ?? []} />,
  },
  {
    id: "activity",
    label: "Activity",
    render: ({ summary }) => (
      <ActivityCard items={summary?.recent_activity ?? []} />
    ),
  },
  {
    id: "comment-queue",
    label: "Comment Queue",
    render: ({ accountId }) => <CommentQueueCard accountId={accountId} />,
  },
  {
    id: "subsidy",
    label: "Subsidy Match",
    render: ({ accountId }) => <SubsidyMatchCard accountId={accountId} />,
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
