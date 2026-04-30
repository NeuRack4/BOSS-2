"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/modal";
import { Bell, Camera, ChevronDown, Loader2 } from "lucide-react";
import {
  InstagramPostCard,
  type InstagramPayload,
} from "@/components/chat/InstagramPostCard";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const CATEGORY_LABEL: Record<string, string> = {
  instagram: "인스타그램",
  youtube: "유튜브",
  content: "콘텐츠",
  general: "전반",
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "text-orange-500 bg-orange-50 border-orange-200",
  medium: "text-blue-500 bg-blue-50 border-blue-200",
  low: "text-slate-400 bg-slate-50 border-slate-200",
};

type NoticeItem = {
  id: string;
  title: string;
  category: string;
  priority: string;
  period: string | null;
  due_date: string;
  target?: string;
  idea?: string;
  steps?: string[];
  expected?: string;
  why?: string;
};

function getDday(dueDateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diff === 0) return "D-Day";
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function formatDate(dueDateStr: string): string {
  return new Date(dueDateStr).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function canShowInstagram(item: NoticeItem): boolean {
  const text = [item.category, item.title, item.target, item.idea]
    .join(" ")
    .toLowerCase();
  return (
    item.category === "instagram" ||
    text.includes("instagram") ||
    text.includes("인스타")
  );
}

function NoticeCard({
  item,
  accountId,
}: {
  item: NoticeItem;
  accountId: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<InstagramPayload | null>(null);
  const [generating, setGenerating] = useState(false);
  const [igError, setIgError] = useState("");
  const dday = getDday(item.due_date);
  const colorClass = PRIORITY_COLOR[item.priority] ?? PRIORITY_COLOR.medium;

  const handleInstagramPreview = async () => {
    if (generating) return;
    setGenerating(true);
    setIgError("");
    try {
      const res = await fetch(`${API}/api/marketing/instagram/example`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          title: item.title,
          target: item.target ?? "",
          idea: item.idea ?? "",
          steps: item.steps ?? [],
          expected: item.expected ?? "",
          period: item.period ?? "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "생성 실패");
      setPreview(json.data as InstagramPayload);
    } catch (e) {
      setIgError(
        e instanceof Error ? e.message : "인스타그램 예시 생성에 실패했습니다.",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#e8dfc8] bg-[#fbf6eb]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[#f5edd8]"
      >
        <span
          className={`mt-0.5 shrink-0 rounded border px-2 py-0.5 text-xs font-bold ${colorClass}`}
        >
          {dday}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-[#2e2719]">
            {item.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#030303]/50">
            <span>{formatDate(item.due_date)}</span>
            <span>·</span>
            <span>{CATEGORY_LABEL[item.category] ?? item.category}</span>
          </div>
        </div>
        <ChevronDown
          className={`mt-1 h-4 w-4 shrink-0 text-[#030303]/30 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-[#e8dfc8] px-4 pb-4 pt-3">
          {item.target && (
            <p className="text-xs text-[#030303]/60">
              <span className="font-medium text-[#030303]/80">대상</span> ·{" "}
              {item.target}
            </p>
          )}
          {item.idea && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#030303]/40">
                아이디어
              </p>
              <p className="text-sm leading-relaxed text-[#2e2719]">
                {item.idea}
              </p>
            </div>
          )}
          {item.steps && item.steps.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#030303]/40">
                실행 방법
              </p>
              <ol className="space-y-1.5">
                {item.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#e8dfc8] text-[10px] font-semibold text-[#5a5040]">
                      {i + 1}
                    </span>
                    <span className="text-sm text-[#2e2719]">
                      {step.replace(/^\d+[단계:.\s]+/, "")}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {item.expected && (
            <div className="rounded-lg border border-[#e8dfc8] bg-white/60 px-3 py-2">
              <span className="text-xs font-medium text-[#030303]/50">
                기대효과 ·{" "}
              </span>
              <span className="text-sm text-[#2e2719]">{item.expected}</span>
            </div>
          )}
          {item.why && (
            <p className="text-xs leading-relaxed text-[#030303]/40">
              {item.why}
            </p>
          )}

          {/* 인스타그램 예시 */}
          {canShowInstagram(item) && (
            <div className="space-y-3 border-t border-[#e8dfc8] pt-3">
              <button
                type="button"
                onClick={handleInstagramPreview}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Camera className="h-3.5 w-3.5" />
                )}
                {generating ? "예시 생성 중…" : "인스타그램 예시보기"}
              </button>
              {igError && <p className="text-xs text-red-500">{igError}</p>}
              {preview && (
                <div className="flex justify-center rounded-xl border border-[#e8dfc8] bg-white/60 p-3">
                  <InstagramPostCard payload={preview} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
};

export const NoticeModal = ({ open, onClose }: Props) => {
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("");

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
          setItems([]);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) setAccountId(user.id);

      try {
        const res = await fetch(
          `${API}/api/marketing/notices?account_id=${user.id}`,
        );
        const json = await res.json();
        if (!cancelled) setItems(Array.isArray(json.data) ? json.data : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
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
      title="Notice"
      widthClass="w-[520px]"
      variant="dashboard"
    >
      <div className="min-h-[200px]">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-[#030303]/50">
            불러오는 중…
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-[#030303]/50">
            <Bell className="h-7 w-7 opacity-25" />
            <p className="text-sm">예정된 알림이 없습니다</p>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto space-y-2 py-1 pr-1">
            {items.map((item) => (
              <NoticeCard key={item.id} item={item} accountId={accountId} />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
