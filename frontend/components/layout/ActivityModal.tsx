"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Briefcase, Megaphone, TrendingUp, FileText, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import type { Domain } from "@/components/canvas/FilterContext";

type NotifyKind =
  | "start"
  | "start_d1"
  | "start_d3"
  | "due_d0"
  | "due_d1"
  | "due_d3"
  | "due_d7";

type Activity = {
  id: string;
  type: "artifact_created" | "agent_run" | "schedule_run" | "schedule_notify";
  domain: Domain;
  title: string;
  description: string;
  created_at: string;
  metadata: {
    artifact_id?: string;
    notify_kind?: NotifyKind;
    due_label?: string;
  } | null;
};

const NOTIFY_BADGE: Record<NotifyKind, { label: string; tone: string }> = {
  start: { label: "D-0 start", tone: "bg-[#cfe3d0] text-[#2e5a3a]" },
  start_d1: { label: "D-1 start", tone: "bg-[#d9e7dd] text-[#3b6a4a]" },
  start_d3: { label: "D-3 start", tone: "bg-[#e3ece2] text-[#5a7560]" },
  due_d0: { label: "D-0 due", tone: "bg-[#e9c9c0] text-[#8a3a28]" },
  due_d1: { label: "D-1 due", tone: "bg-[#ecd3c6] text-[#9c5130]" },
  due_d3: { label: "D-3 due", tone: "bg-[#efdfc8] text-[#8a6a2c]" },
  due_d7: { label: "D-7 due", tone: "bg-[#eee5d0] text-[#6a5a36]" },
};

const DOMAIN_ICONS: Record<Domain, ReactNode> = {
  recruitment: <Briefcase className="h-4 w-4" />,
  marketing: <Megaphone className="h-4 w-4" />,
  sales: <TrendingUp className="h-4 w-4" />,
  documents: <FileText className="h-4 w-4" />,
};

const DOMAIN_COLORS: Record<Domain, string> = {
  recruitment: "text-[#a35c4a]",
  marketing: "text-[#a87620]",
  sales: "text-[#6a7843]",
  documents: "text-[#764463]",
};

const DOMAIN_LABELS: Record<Domain, string> = {
  recruitment: "Recruitment",
  marketing: "Marketing",
  sales: "Sales",
  documents: "Documents",
};

const TYPE_LABELS: Record<Activity["type"], string> = {
  artifact_created: "Created",
  agent_run: "Run",
  schedule_run: "Auto-run",
  schedule_notify: "Notify",
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

type Props = {
  open: boolean;
  onClose: () => void;
};

export const ActivityModal = ({ open, onClose }: Props) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setActivities([]);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("activity_logs")
        .select("id,type,domain,title,description,created_at,metadata")
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setActivities((data as Activity[] | null) ?? []);
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleNavigate = async (a: Activity) => {
    let artifactId = a.metadata?.artifact_id ?? null;
    if (!artifactId) {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("artifacts")
          .select("id")
          .eq("account_id", user.id)
          .eq("title", a.title)
          .contains("domains", [a.domain])
          .order("created_at", { ascending: false })
          .limit(1);
        artifactId = (data as { id: string }[] | null)?.[0]?.id ?? null;
      }
    }
    if (!artifactId) return;
    onClose();
    window.dispatchEvent(
      new CustomEvent("boss:focus-node", { detail: { id: artifactId } }),
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Recent Activity"
      widthClass="w-[720px]"
      variant="dashboard"
    >
      <div className="h-[560px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#030303]/60">
            Loading…
          </div>
        ) : activities.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[#030303]/60">
            <Bot className="h-8 w-8 opacity-30" />
            <p className="text-sm">Nothing here yet</p>
          </div>
        ) : (
          <ScrollArea className="h-full pr-2">
            <div className="space-y-0">
              {activities.map((a, i) => (
                <div key={a.id}>
                  <button
                    type="button"
                    onClick={() => handleNavigate(a)}
                    title="Open node"
                    className="flex w-full items-start gap-3 py-3 text-left rounded-md px-2 -mx-2 hover:bg-[#fcfcfc]/60 transition-colors"
                  >
                    <div
                      className={cn(
                        "mt-0.5 shrink-0",
                        DOMAIN_COLORS[a.domain] ?? "text-[#030303]/60",
                      )}
                    >
                      {DOMAIN_ICONS[a.domain] ?? <Bot className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#030303]">
                          {a.title}
                        </span>
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px]"
                        >
                          {DOMAIN_LABELS[a.domain] ?? a.domain}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="h-4 px-1.5 text-[10px]"
                        >
                          {TYPE_LABELS[a.type] ?? a.type}
                        </Badge>
                        {a.metadata?.notify_kind &&
                          NOTIFY_BADGE[a.metadata.notify_kind] && (
                            <span
                              className={cn(
                                "h-4 rounded px-1.5 text-[10px] font-semibold leading-4",
                                NOTIFY_BADGE[a.metadata.notify_kind].tone,
                              )}
                            >
                              {NOTIFY_BADGE[a.metadata.notify_kind].label}
                              {a.metadata.due_label
                                ? ` · ${a.metadata.due_label}`
                                : ""}
                            </span>
                          )}
                      </div>
                      {a.description && (
                        <p className="text-xs text-[#030303]/80">
                          {a.description}
                        </p>
                      )}
                    </div>
                    <span className="mt-0.5 shrink-0 text-[11px] text-[#030303]/60">
                      {formatTime(a.created_at)}
                    </span>
                  </button>
                  {i < activities.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </Modal>
  );
};
