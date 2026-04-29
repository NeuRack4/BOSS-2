// frontend/components/marketing/hooks/useMarketingData.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { MarketingDashboardState } from "../types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const INITIAL: MarketingDashboardState = {
  loading: true,
  error: null,
  data: null,
  actions: [],
  actionsLoading: false,
  actionsLoaded: false,
  analysis: null,
  analysisLoading: false,
  analysisLoaded: false,
};

export function useMarketingData(accountId: string, days = 30) {
  const [state, setState] = useState<MarketingDashboardState>(INITIAL);

  const fetchDashboard = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch(
        `${API}/api/marketing/dashboard?account_id=${accountId}&days=${days}`,
      );
      const json = await res.json();
      setState((s) => ({ ...s, loading: false, data: json.data ?? null }));
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "데이터를 불러오지 못했습니다.",
      }));
    }
  }, [accountId, days]);

  const fetchActions = useCallback(async () => {
    if (state.actionsLoaded || state.actionsLoading) return;
    setState((s) => ({ ...s, actionsLoading: true }));
    try {
      const res = await fetch(
        `${API}/api/marketing/dashboard/actions?account_id=${accountId}&days=${days}`,
      );
      const json = await res.json();
      setState((s) => ({
        ...s,
        actionsLoading: false,
        actionsLoaded: true,
        actions: Array.isArray(json.data) ? json.data : [],
      }));
    } catch {
      setState((s) => ({
        ...s,
        actionsLoading: false,
        actionsLoaded: true,
        actions: [],
      }));
    }
  }, [accountId, days, state.actionsLoaded, state.actionsLoading]);

  useEffect(() => {
    if (accountId) fetchDashboard();
  }, [accountId, fetchDashboard]);

  const fetchAnalysis = useCallback(async () => {
    if (state.analysisLoaded || state.analysisLoading) return;
    setState((s) => ({ ...s, analysisLoading: true }));
    try {
      const res = await fetch(
        `${API}/api/marketing/dashboard/analysis?account_id=${accountId}&days=${days}`,
      );
      const json = await res.json();
      setState((s) => ({
        ...s,
        analysisLoading: false,
        analysisLoaded: true,
        analysis: json.data ?? null,
      }));
    } catch {
      setState((s) => ({
        ...s,
        analysisLoading: false,
        analysisLoaded: true,
        analysis: null,
      }));
    }
  }, [accountId, days, state.analysisLoaded, state.analysisLoading]);

  return { state, refresh: fetchDashboard, fetchActions, fetchAnalysis };
}
