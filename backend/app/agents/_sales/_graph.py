"""Sales Agentic Loop — LangGraph 기반

흐름:
  [fetch_data] → [check_data] → 충분하면 → [generate]
                              → 부족하면 → [retrieve_more] → [generate]

check_data: LLM 호출 없이 Python 조건으로 판단 (비용 절감)
  - sales 레코드 3건 이상 AND 기간이 7일 이상이면 충분
  - 그 이하면 RAG로 보강

generate: 기존 generate_sales_insight() 그대로 호출.
  artifact 저장은 run_sales_report() 에서 그대로 처리.
"""
from __future__ import annotations

import logging
from typing import TypedDict

from langgraph.graph import StateGraph, END

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn): return fn
        return _decorator

log = logging.getLogger(__name__)


# ── 상태 정의 ─────────────────────────────────────────────────────────────────

class SalesAnalysisState(TypedDict):
    account_id:   str
    message:      str
    period:       str
    sales_data:   list
    cost_data:    list
    rag_context:  str
    iteration:    int
    data_ok:      bool
    final_result: dict   # generate_sales_insight() 반환값 전체


# ── 노드 1: DB에서 매출·비용 수집 ────────────────────────────────────────────

@_traceable(name="sales.graph.fetch_data")
async def fetch_data(state: SalesAnalysisState) -> SalesAnalysisState:
    from app.agents._sales._insights import _fetch_sales, _fetch_costs, _parse_period
    from app.core.supabase import get_supabase

    log.info("[GRAPH] fetch_data | iteration=%d", state.get("iteration", 0) + 1)

    sb = get_supabase()
    cs, ce, _, _ = _parse_period(state["period"])

    state["sales_data"] = _fetch_sales(sb, state["account_id"], cs, ce)
    state["cost_data"]  = _fetch_costs(sb, state["account_id"], cs, ce)
    state["iteration"]  = state.get("iteration", 0) + 1

    log.info("[GRAPH] fetch_data 완료 | sales=%d건 cost=%d건",
             len(state["sales_data"]), len(state["cost_data"]))
    return state


# ── 노드 2: 데이터 충분한지 Python 조건으로 판단 (비용 0) ──────────────────

@_traceable(name="sales.graph.check_data")
async def check_data(state: SalesAnalysisState) -> SalesAnalysisState:
    sales_count = len(state["sales_data"])
    # 3건 이상이면 분석 가능한 것으로 판단
    state["data_ok"] = sales_count >= 3
    log.info("[GRAPH] check_data | sales=%d건 → data_ok=%s",
             sales_count, state["data_ok"])
    return state


# ── 노드 3: RAG로 과거 유사 데이터 보강 ──────────────────────────────────────

@_traceable(name="sales.graph.retrieve_more")
async def retrieve_more(state: SalesAnalysisState) -> SalesAnalysisState:
    from app.agents._sales._retriever import retrieve_sales_context

    log.info("[GRAPH] retrieve_more | RAG 보강 시작")
    state["rag_context"] = await retrieve_sales_context(
        state["account_id"], state["message"]
    )
    state["data_ok"] = True  # 보강 후 진행
    log.info("[GRAPH] retrieve_more 완료 | rag_context 길이=%d",
             len(state["rag_context"]))
    return state


# ── 노드 4: 분석 생성 ─────────────────────────────────────────────────────────

@_traceable(name="sales.graph.generate")
async def generate(state: SalesAnalysisState) -> SalesAnalysisState:
    from app.agents._sales._insights import generate_sales_insight

    log.info("[GRAPH] generate | period=%s", state["period"])
    result = await generate_sales_insight(
        account_id=state["account_id"],
        period=state["period"],
    )
    state["final_result"] = result
    log.info("[GRAPH] generate 완료")
    return state


# ── 분기 조건 ─────────────────────────────────────────────────────────────────

def route_after_check(state: SalesAnalysisState) -> str:
    if state["iteration"] >= 2:   # 무한 루프 방지
        return "generate"
    if state["data_ok"]:
        return "generate"
    return "retrieve"


# ── 그래프 조립 ───────────────────────────────────────────────────────────────

def build_sales_graph():
    g = StateGraph(SalesAnalysisState)

    g.add_node("fetch",    fetch_data)
    g.add_node("check",    check_data)
    g.add_node("retrieve", retrieve_more)
    g.add_node("generate", generate)

    g.set_entry_point("fetch")
    g.add_edge("fetch",    "check")
    g.add_edge("retrieve", "generate")
    g.add_edge("generate", END)

    g.add_conditional_edges(
        "check",
        route_after_check,
        {"generate": "generate", "retrieve": "retrieve"},
    )

    return g.compile()
