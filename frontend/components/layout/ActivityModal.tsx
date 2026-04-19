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

type Activity = {
  id: string;
  type: "artifact_created" | "agent_run";
  domain: Domain;
  title: string;
  description: string;
  created_at: string;
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
  recruitment: "채용",
  marketing: "마케팅",
  sales: "매출",
  documents: "서류",
};

const TYPE_LABELS = {
  artifact_created: "생성",
  agent_run: "실행",
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
        .select("id,type,domain,title,description,created_at")
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="활동이력"
      widthClass="w-[640px]"
    >
      <div className="h-[480px]">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-[#8c7e66]">
            불러오는 중...
          </div>
        ) : activities.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[#8c7e66]">
            <Bot className="h-8 w-8 opacity-30" />
            <p className="text-sm">아직 활동이 없습니다.</p>
            <p className="text-xs">Orchestrator와 대화를 시작해 보세요.</p>
          </div>
        ) : (
          <ScrollArea className="h-full pr-2">
            <div className="space-y-0">
              {activities.map((a, i) => (
                <div key={a.id}>
                  <div className="flex items-start gap-3 py-3">
                    <div
                      className={cn(
                        "mt-0.5 shrink-0",
                        DOMAIN_COLORS[a.domain] ?? "text-[#8c7e66]",
                      )}
                    >
                      {DOMAIN_ICONS[a.domain] ?? <Bot className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#2e2719]">
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
                      </div>
                      {a.description && (
                        <p className="text-xs text-[#5a5040]">
                          {a.description}
                        </p>
                      )}
                    </div>
                    <span className="mt-0.5 shrink-0 text-[11px] text-[#8c7e66]">
                      {formatTime(a.created_at)}
                    </span>
                  </div>
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
