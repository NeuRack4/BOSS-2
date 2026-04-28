// frontend/components/sales/dashboard/hooks/useDashboardData.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardState,
  DailyData,
  DayPoint,
  PeriodActivation,
} from "../types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function getStage(count: number): 0 | 1 | 2 {
  if (count === 0) return 0;
  if (count <= 4) return 1;
  return 2;
}

function extrapolate(series: DayPoint[], daysBack = 7): DailyData[] {
  const today = new Date();
  const realEntries = series.filter((s) => s.sales > 0);
  const avg =
    realEntries.length > 0
      ? Math.round(
          realEntries.reduce((sum, e) => sum + e.sales, 0) / realEntries.length,
        )
      : 0;

  return Array.from({ length: daysBack }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (daysBack - 1 - i));
    const dateStr = d.toISOString().split("T")[0];
    const found = series.find((s) => s.date === dateStr && s.sales > 0);
    return {
      date: dateStr,
      amount: found ? found.sales : avg,
      isEstimated: !found || found.sales === 0,
    };
  });
}

function calcPeriodActivation(
  businessStartDate: string | null,
): PeriodActivation {
  if (!businessStartDate) {
    return {
      today: true,
      week: true,
      month: true,
      weekTooltip: "",
      monthTooltip: "",
    };
  }
  const start = new Date(businessStartDate);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000);

  return {
    today: true,
    week: diffDays >= 2,
    month: diffDays >= 7,
    weekTooltip: diffDays < 2 ? "창업 2일 후부터 볼 수 있어요" : "",
    monthTooltip:
      diffDays < 7 ? `창업 ${7 - diffDays}일 후부터 볼 수 있어요` : "",
  };
}

const INITIAL_STATE: DashboardState = {
  stage: 0,
  entryCount: 0,
  businessStartDate: null,
  todayRevenue: 0,
  todayChangeRate: null,
  weeklyData: [],
  goal: null,
  overview: null,
  categories: [],
  aiInsight: null,
  menus: [],
  loading: true,
  error: false,
};

export function useDashboardData(accountId: string) {
  const [state, setState] = useState<DashboardState>(INITIAL_STATE);

  const periodActivation = useMemo(
    () => calcPeriodActivation(state.businessStartDate),
    [state.businessStartDate],
  );

  const fetchAll = useCallback(async () => {
    if (!accountId) return;
    setState((prev) => ({ ...prev, loading: true, error: false }));

    try {
      const [ovRes, dvRes, glRes, catRes, insRes, menuRes] = await Promise.all([
        fetch(`${API}/api/stats/overview?account_id=${accountId}`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(`${API}/api/stats/daily?account_id=${accountId}`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(`${API}/api/stats/goal?account_id=${accountId}`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(
          `${API}/api/stats/category-breakdown?account_id=${accountId}`,
        ).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(
          `${API}/api/stats/benchmark-insight?account_id=${accountId}&compare_months_ago=1`,
        ).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(`${API}/api/menus?account_id=${accountId}&active_only=true`).then(
          (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          },
        ),
      ]);

      const series: DayPoint[] = dvRes.data?.series ?? [];
      const realEntries = series.filter((s) => s.sales > 0);
      const entryCount = realEntries.length;
      const stage = getStage(entryCount);

      const todayStr = new Date().toISOString().split("T")[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const todayPoint = series.find((s) => s.date === todayStr);
      const yesterdayPoint = series.find((s) => s.date === yesterdayStr);
      const todayRevenue = todayPoint?.sales ?? 0;
      const todayChangeRate =
        todayPoint?.sales != null &&
        yesterdayPoint?.sales != null &&
        yesterdayPoint.sales > 0
          ? parseFloat(
              (
                ((todayPoint.sales - yesterdayPoint.sales) /
                  yesterdayPoint.sales) *
                100
              ).toFixed(1),
            )
          : null;

      const businessStartDate =
        realEntries.length > 0
          ? [...realEntries].sort((a, b) => a.date.localeCompare(b.date))[0]
              .date
          : null;

      const weeklyData: DailyData[] =
        stage === 0
          ? []
          : stage === 1
            ? extrapolate(series, 7)
            : Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                const dateStr = d.toISOString().split("T")[0];
                const found = series.find(
                  (s) => s.date === dateStr && s.sales > 0,
                );
                return {
                  date: dateStr,
                  amount: found?.sales ?? 0,
                  isEstimated: false,
                };
              });

      setState({
        stage,
        entryCount,
        businessStartDate,
        todayRevenue,
        todayChangeRate,
        weeklyData,
        goal: glRes.data ?? null,
        overview: ovRes.data ?? null,
        categories: catRes.data?.items ?? [],
        aiInsight: insRes.data ?? null,
        menus: Array.isArray(menuRes.data)
          ? menuRes.data
          : (menuRes.data?.menus ?? []),
        loading: false,
        error: false,
      });
    } catch {
      setState((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, [accountId]);

  const fetchAllRef = useRef(fetchAll);
  useEffect(() => {
    fetchAllRef.current = fetchAll;
  }, [fetchAll]);

  // A: 페이지 진입 시 fetch
  useEffect(() => {
    fetchAllRef.current();
  }, [accountId]);

  // C: 챗봇 저장 완료 이벤트 수신
  useEffect(() => {
    const handler = () => {
      fetchAllRef.current();
    };
    window.addEventListener("sales-data-saved", handler);
    return () => window.removeEventListener("sales-data-saved", handler);
  }, []);

  return { state, periodActivation, refresh: () => fetchAllRef.current() };
}
