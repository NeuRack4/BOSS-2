"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat/ChatContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";

type Tab = "users" | "payments" | "stats" | "costs";

type Schedule = {
  id: string;
  title: string;
  cron: string;
  schedule_enabled: boolean;
  next_run: string | null;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  business_name: string;
  plan: string;
  subscription_status: string;
  last_seen_at: string | null;
  created_at: string;
  active_schedule_count: number;
  schedules: Schedule[];
};

type CostRow = {
  account_id: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost: number;
  run_count: number;
};

const TABS: { key: Tab; label: string }[] = [
  { key: "users", label: "유저 목록" },
  { key: "payments", label: "구독 / 결제" },
  { key: "stats", label: "시스템 통계" },
  { key: "costs", label: "계정별 코스트" },
];

const planBadge = (plan: string) => {
  const styles: Record<string, { background: string; color: string }> = {
    pro:      { background: "#dbeafe", color: "#1d4ed8" },
    business: { background: "#d1fae5", color: "#065f46" },
    free:     { background: "#f0ece4", color: "#6a6460" },
  };
  const s = styles[plan] ?? styles.free;
  return (
    <span style={{ ...s, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, display: "inline-block" }}>
      {plan}
    </span>
  );
};

const UsersTab = ({ accountId }: { accountId: string }) => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/users?account_id=${accountId}`)
      .then((r) => r.json())
      .then((data) => { setUsers(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accountId]);

  if (loading) return <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>;

  return (
    <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #e6e1d8", fontSize: 13, fontWeight: 500 }}>
        전체 계정 ({users.length})
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#faf7f2", borderBottom: "1px solid #e6e1d8" }}>
            {["", "계정", "사업체명", "플랜", "활성 스케줄", "마지막 접속", "상태"].map((h) => (
              <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, color: "#9a9287", fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "monospace" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <React.Fragment key={u.id}>
              <tr
                onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                style={{ borderBottom: "1px solid #f0ece4", cursor: "pointer", background: expandedId === u.id ? "#f5f1ea" : undefined }}
              >
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287" }}>
                  {expandedId === u.id ? "▼" : "▶"}
                </td>
                <td style={{ padding: "11px 18px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{u.display_name || "—"}</div>
                  <div style={{ fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{u.email}</div>
                </td>
                <td style={{ padding: "11px 18px", fontSize: 12.5 }}>{u.business_name || "—"}</td>
                <td style={{ padding: "11px 18px" }}>{planBadge(u.plan)}</td>
                <td style={{ padding: "11px 18px" }}>
                  {u.active_schedule_count > 0 ? (
                    <span style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999 }}>
                      {u.active_schedule_count}개 활성
                    </span>
                  ) : (
                    <span style={{ background: "#f5f1ea", border: "1px solid #e6e1d8", color: "#9a9287", fontSize: 11, padding: "3px 9px", borderRadius: 999 }}>없음</span>
                  )}
                </td>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>
                  {u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString("ko-KR") : "—"}
                </td>
                <td style={{ padding: "11px 18px", fontSize: 12 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: u.last_seen_at ? "#22c55e" : "#d1d5db", display: "inline-block", marginRight: 6 }} />
                  {u.last_seen_at ? "활성" : "비활성"}
                </td>
              </tr>
              {expandedId === u.id && (
                <tr key={`${u.id}-detail`} style={{ background: "#f0ece4", borderBottom: "1px solid #e6e1d8" }}>
                  <td colSpan={7} style={{ padding: "14px 24px 14px 52px" }}>
                    {u.schedules.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#9a9287" }}>등록된 스케줄이 없습니다.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {u.schedules.map((s) => (
                          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e6e1d8", borderRadius: 8, padding: "9px 14px" }}>
                            <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{s.title}</span>
                            <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "#9a9287" }}>{s.cron || "—"}</span>
                            <span style={{ background: "#dcfce7", color: "#15803d", fontSize: 10, padding: "2px 8px", borderRadius: 999 }}>실행 중</span>
                            <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "#9a9287" }}>
                              {s.next_run ? `다음: ${new Date(s.next_run).toLocaleString("ko-KR")}` : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const PaymentsTab = ({ accountId }: { accountId: string }) => {
  const [data, setData] = useState<{ summary: Record<string, number>; rows: Record<string, unknown>[] } | null>(null);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/payments?account_id=${accountId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => null);
  }, [accountId]);

  if (!data) return <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>;

  const planLabels: Record<string, string> = { pro: "Pro", business: "Business", free: "Free" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12 }}>
        {Object.entries(data.summary).map(([plan, count]) => (
          <div key={plan} style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: "16px 20px", minWidth: 120 }}>
            <div style={{ fontSize: 10, color: "#9a9287", textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "monospace", marginBottom: 6 }}>{planLabels[plan] ?? plan}</div>
            <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.03em" }}>{count}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#faf7f2", borderBottom: "1px solid #e6e1d8" }}>
              {["계정 ID", "플랜", "상태", "다음 결제일", "시작일"].map((h) => (
                <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, color: "#9a9287", fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "monospace" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0ece4" }}>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{String(row.account_id ?? "").slice(0, 8)}…</td>
                <td style={{ padding: "11px 18px", fontSize: 12.5 }}>{String(row.plan ?? "")}</td>
                <td style={{ padding: "11px 18px", fontSize: 12.5 }}>{String(row.status ?? "")}</td>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{String(row.next_billing_date ?? "—")}</td>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{row.started_at ? new Date(String(row.started_at)).toLocaleDateString("ko-KR") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type StatsData = {
  total_users: number;
  dau_today: number;
  total_agent_runs: number;
  active_schedules: number;
} | null;

const StatsTab = ({ stats }: { stats: StatsData }) => {
  if (!stats) return <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>;
  const items = [
    { label: "총 유저 수", value: stats.total_users },
    { label: "오늘 DAU", value: stats.dau_today },
    { label: "전체 에이전트 실행 횟수", value: stats.total_agent_runs },
    { label: "전체 활성 스케줄", value: stats.active_schedules },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
      {items.map(({ label, value }) => (
        <div key={label} style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: "20px 24px" }}>
          <div style={{ fontSize: 10, color: "#9a9287", textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "monospace", marginBottom: 10 }}>{label}</div>
          <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em" }}>{value ?? "—"}</div>
        </div>
      ))}
    </div>
  );
};

const CostsTab = ({ accountId }: { accountId: string }) => {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/costs?account_id=${accountId}&days=${days}`)
      .then((r) => r.json())
      .then((data) => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accountId, days]);

  const maxCost = Math.max(...rows.map((r) => r.total_cost), 0.001);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: days === d ? 600 : 400,
              background: days === d ? "#1a1816" : "#fff",
              color: days === d ? "#fffdf9" : "#6a6460",
              border: "1px solid #e6e1d8",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {d}일
          </button>
        ))}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#faf7f2", borderBottom: "1px solid #e6e1d8" }}>
                {["계정 ID", "실행 수", "총 토큰", "입력 토큰", "출력 토큰", "예상 비용", "비중"].map((h) => (
                  <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, color: "#9a9287", fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "monospace" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const pct = Math.round((row.total_cost / maxCost) * 100);
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #f0ece4" }}>
                    <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{row.account_id.slice(0, 8)}…</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, fontFamily: "monospace" }}>{row.run_count}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, fontFamily: "monospace" }}>{row.total_tokens.toLocaleString()}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, color: "#9a9287", fontFamily: "monospace" }}>{row.prompt_tokens.toLocaleString()}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, color: "#9a9287", fontFamily: "monospace" }}>{row.completion_tokens.toLocaleString()}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, fontFamily: "monospace", color: row.total_cost > 10 ? "#dc2626" : "#1a1816", fontWeight: 500 }}>
                      ${row.total_cost.toFixed(3)}
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: "#f0ece4", borderRadius: 2, minWidth: 60 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#2563eb", borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10.5, color: "#9a9287", fontFamily: "monospace" }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default function AdminPage() {
  const router = useRouter();
  const { userId } = useChat();
  const { isAdmin, loading } = useIsAdmin(userId);
  const [activeTab, setActiveTab] = useState<Tab>("users");

  const [stats, setStats] = useState<StatsData>(null);

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (!userId || !isAdmin) return;
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/stats?account_id=${userId}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => null);
  }, [userId, isAdmin]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f2e9d5" }}>
        <span style={{ fontSize: 13, color: "#9a9287" }}>불러오는 중…</span>
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div style={{ background: "#f2e9d5", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "#1a1816", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#fffdf9", fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>BOSS</span>
          <span style={{ background: "#2563eb", color: "white", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 999, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Admin</span>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          style={{ color: "rgba(255,253,249,0.45)", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}
        >
          ← 대시보드로 돌아가기
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "총 유저", value: stats?.total_users ?? "—" },
            { label: "오늘 DAU", value: stats?.dau_today ?? "—" },
            { label: "에이전트 실행", value: stats?.total_agent_runs ?? "—" },
            { label: "활성 스케줄", value: stats?.active_schedules ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: "#9a9287", textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "monospace", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.03em" }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid #e6e1d8", marginBottom: 20 }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 500,
                color: activeTab === key ? "#1a1816" : "#9a9287",
                background: "none",
                border: "none",
                borderBottom: activeTab === key ? "2px solid #1a1816" : "2px solid transparent",
                marginBottom: -1,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "users" && userId && <UsersTab accountId={userId} />}
        {activeTab === "payments" && userId && <PaymentsTab accountId={userId} />}
        {activeTab === "stats" && userId && <StatsTab accountId={userId} stats={stats} />}
        {activeTab === "costs" && userId && <CostsTab accountId={userId} />}
      </div>
    </div>
  );
}
