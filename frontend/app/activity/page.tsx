"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Briefcase, Megaphone, TrendingUp, Bot } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Activity = {
  id: string;
  type: "artifact_created" | "agent_run";
  domain: "recruitment" | "marketing" | "sales";
  title: string;
  description: string;
  created_at: string;
};

const DOMAIN_ICONS = {
  recruitment: <Briefcase className="h-4 w-4" />,
  marketing: <Megaphone className="h-4 w-4" />,
  sales: <TrendingUp className="h-4 w-4" />,
};

const DOMAIN_COLORS = {
  recruitment: "text-blue-500",
  marketing: "text-purple-500",
  sales: "text-emerald-500",
};

const DOMAIN_LABELS = {
  recruitment: "채용",
  marketing: "마케팅",
  sales: "매출",
};

const TYPE_LABELS = {
  artifact_created: "생성",
  agent_run: "실행",
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // artifact 생성 이벤트를 task_logs에서 가져옴 (스키마 완성 전 mock 데이터 사용)
      // TODO: 백엔드 연동 후 실제 API로 교체
      setActivities([]);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex-1 overflow-hidden max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold">활동이력</h1>
        </div>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              불러오는 중...
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
              <Bot className="h-8 w-8 opacity-30" />
              <p className="text-sm">아직 활동이 없습니다.</p>
              <p className="text-xs">Orchestrator와 대화를 시작해 보세요.</p>
            </div>
          ) : (
            <div className="space-y-0">
              {activities.map((activity, i) => (
                <div key={activity.id}>
                  <div className="flex items-start gap-3 py-3">
                    <div
                      className={cn(
                        "mt-0.5 shrink-0",
                        DOMAIN_COLORS[activity.domain],
                      )}
                    >
                      {DOMAIN_ICONS[activity.domain]}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">
                          {activity.title}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-4 px-1.5"
                        >
                          {DOMAIN_LABELS[activity.domain]}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px] h-4 px-1.5"
                        >
                          {TYPE_LABELS[activity.type]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {activity.description}
                      </p>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 mt-0.5">
                      {formatTime(activity.created_at)}
                    </span>
                  </div>
                  {i < activities.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
