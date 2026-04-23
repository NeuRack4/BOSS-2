"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ProfileRow = {
  display_name: string | null;
  business_name: string | null;
  business_type: string | null;
  business_stage: string | null;
  employees_count: string | null;
  location: string | null;
  channels: string | null;
  primary_goal: string | null;
  profile_meta: Record<string, unknown> | null;
};

type LongMemoryRow = {
  id: string;
  content: string;
  importance: number | null;
  created_at: string;
};

type MemoRow = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  artifact_id: string;
  artifacts?: { title: string | null } | null;
};

const cleanTitle = (t: string | null | undefined) =>
  (t ?? "").replace(/^\[MOCK\]\s*/, "").trim() || "(제목 없음)";

const formatRelative = (iso: string): string => {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
};

const STAGE_LABEL: Record<string, string> = {
  "창업 준비": "창업 준비",
  "오픈 직전": "오픈 직전",
  "영업 중": "영업 중",
  "확장 중": "확장 중",
};

const CHANNELS_LABEL: Record<string, string> = {
  offline: "오프라인",
  online: "온라인",
  both: "양쪽",
};

export const ProfileMemorySidebar = () => {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [longMem, setLongMem] = useState<LongMemoryRow[]>([]);
  const [memos, setMemos] = useState<MemoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (!cancelled) setEmail(user.email ?? null);

      const profileP = supabase
        .from("profiles")
        .select(
          "display_name, business_name, business_type, business_stage, employees_count, location, channels, primary_goal, profile_meta",
        )
        .eq("id", user.id)
        .single()
        .then((r) => (r.data as ProfileRow | null) ?? null);

      const longP = supabase
        .from("memory_long")
        .select("id, content, importance, created_at")
        .eq("account_id", user.id)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(50)
        .then((r) => (r.data as LongMemoryRow[] | null) ?? []);

      const memosP = supabase
        .from("memos")
        .select(
          "id, content, created_at, updated_at, artifact_id, artifacts(title)",
        )
        .eq("account_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(50)
        .then((r) => (r.data as unknown as MemoRow[] | null) ?? []);

      const [p, longs, ms] = await Promise.all([profileP, longP, memosP]);
      if (cancelled) return;
      setProfile(p);
      setLongMem(longs);
      setMemos(ms);
      setLoading(false);
    };
    run();
    const refresh = () => {
      run();
    };
    window.addEventListener("boss:artifacts-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("boss:artifacts-changed", refresh);
    };
  }, []);

  return (
    <aside
      className="hidden min-w-[220px] max-w-[320px] flex-1 basis-0 flex-col gap-4 self-stretch min-[1500px]:flex"
      aria-label="프로필 및 기억"
    >
      <div className="min-h-0 flex-1 basis-0">
        <ProfileCard profile={profile} email={email} loading={loading} />
      </div>
      <div className="min-h-0 flex-1 basis-0">
        <LongMemoryCard items={longMem} loading={loading} />
      </div>
      <div className="min-h-0 flex-[0.75] basis-0">
        <MemosCard items={memos} loading={loading} />
      </div>
    </aside>
  );
};

const CardButton = ({
  title,
  bg,
  onClick,
  children,
  isDark = false,
}: {
  title: string;
  bg: string;
  onClick: () => void;
  children: React.ReactNode;
  isDark?: boolean;
}) => {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={onKey}
      className={`group flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-[5px] p-5 text-left shadow-lg transition-all hover:scale-[1.015] hover:shadow-xl focus:outline-none ${
        isDark
          ? "text-white focus:ring-2 focus:ring-white/40"
          : "text-[#030303] focus:ring-2 focus:ring-[#030303]/30"
      }`}
      style={{ backgroundColor: bg }}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <span
          className={`text-base font-semibold tracking-tight ${isDark ? "text-white" : "text-[#030303]"}`}
        >
          {title}
        </span>
        <ArrowUpRight
          className={`h-5 w-5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${isDark ? "opacity-70 group-hover:opacity-100" : "opacity-60 group-hover:opacity-100"}`}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
};

const formatProfileField = (
  k: keyof ProfileRow,
  v: string | null,
): string | null => {
  if (!v) return null;
  if (k === "business_stage") return STAGE_LABEL[v] ?? v;
  if (k === "channels") return CHANNELS_LABEL[v] ?? v;
  return v;
};

const ProfileCard = ({
  profile,
  email,
  loading,
}: {
  profile: ProfileRow | null;
  email: string | null;
  loading: boolean;
}) => {
  const FIELDS: Array<{ label: string; key: keyof ProfileRow }> = [
    { label: "Business", key: "business_name" },
    { label: "Industry", key: "business_type" },
    { label: "Stage", key: "business_stage" },
    { label: "Staff", key: "employees_count" },
    { label: "Location", key: "location" },
    { label: "Channel", key: "channels" },
    { label: "Goal", key: "primary_goal" },
  ];
  const rows = FIELDS.map(({ label, key }) => ({
    label,
    value: formatProfileField(key, (profile?.[key] as string | null) ?? null),
  }));

  const name =
    profile?.display_name?.trim() ||
    profile?.business_name?.trim() ||
    "Not set";

  return (
    <CardButton
      title="Profile"
      bg="#f1d9c7"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("boss:open-profile-modal"))
      }
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-[#030303]/40">
          Loading…
        </div>
      ) : (
        <div className="space-y-1.5">
          {email && (
            <div className="flex items-baseline justify-between gap-2 rounded-[5px] bg-[#fcfcfc]/40 px-3 py-1.5">
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-[#030303]/50">
                Email
              </span>
              <span className="truncate text-right text-[12.5px] text-[#030303]/70">
                {email}
              </span>
            </div>
          )}
          <div className="rounded-[5px] bg-[#fcfcfc]/60 px-3 py-2">
            <div className="mb-0.5 font-mono text-[11px] uppercase tracking-wider text-[#030303]/50">
              Nickname
            </div>
            <div className="truncate text-[14px] font-semibold text-[#030303]">
              {name}
            </div>
            {profile?.business_name && profile?.display_name && (
              <div className="mt-0.5 truncate text-[11.5px] text-[#030303]/60">
                {profile.business_name}
              </div>
            )}
          </div>
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between gap-2 rounded-[5px] bg-[#fcfcfc]/40 px-3 py-1.5"
            >
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-[#030303]/50">
                {r.label}
              </span>
              <span
                className={`truncate text-right text-[12.5px] ${r.value ? "text-[#030303]" : "text-[#030303]/30"}`}
              >
                {r.value ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </CardButton>
  );
};

const LongMemoryCard = ({
  items,
  loading,
}: {
  items: LongMemoryRow[];
  loading: boolean;
}) => {
  const shown = items.slice(0, 3);
  return (
    <CardButton
      title="Long-term Memory"
      bg="#eee3c4"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("boss:open-longmem-modal"))
      }
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-xs text-[#030303]/50">
          불러오는 중…
        </div>
      ) : shown.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-[#030303]/50">
          Nothing here yet
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((m) => (
            <li
              key={m.id}
              className="rounded-[5px] bg-[#fcfcfc]/50 px-3 py-2 text-[#030303]"
            >
              <p className="text-[13px] leading-snug line-clamp-2">
                {m.content}
              </p>
              <div className="mt-1 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-[#030303]/55">
                <span>{formatRelative(m.created_at)}</span>
                {typeof m.importance === "number" && (
                  <span>★ {m.importance.toFixed(1)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </CardButton>
  );
};

const MemosCard = ({
  items,
  loading,
}: {
  items: MemoRow[];
  loading: boolean;
}) => {
  const shown = items.slice(0, 3);
  return (
    <CardButton
      title="Memos"
      bg="#c6dad1"
      onClick={() =>
        window.dispatchEvent(new CustomEvent("boss:open-memos-modal"))
      }
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-xs text-[#030303]/50">
          불러오는 중…
        </div>
      ) : shown.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-[#030303]/50">
          Nothing here yet
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(
                    new CustomEvent("boss:open-memos-modal"),
                  );
                }}
                className="block w-full rounded-[5px] bg-[#fcfcfc]/50 px-3 py-2 text-left text-[#030303] transition-colors hover:bg-[#fcfcfc]/80"
              >
                <div className="mb-0.5 truncate text-[11px] font-semibold uppercase tracking-wider text-[#030303]/55">
                  {cleanTitle(m.artifacts?.title)}
                </div>
                <p className="text-[13px] leading-snug line-clamp-2">
                  {m.content}
                </p>
                <div className="mt-1 font-mono text-[10.5px] tabular-nums text-[#030303]/55">
                  {formatRelative(m.updated_at)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </CardButton>
  );
};
