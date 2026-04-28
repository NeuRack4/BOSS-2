"""Planner tool 단위 테스트 — Supabase mock 사용."""
import pytest
from unittest.mock import MagicMock, patch

from app.agents._agent_context import inject_agent_context
from app.agents._planner_tools import (
    get_profile,
    get_recent_artifacts,
    get_memos,
    list_capabilities,
    ask_user,
    dispatch,
    trigger_planning,
    init_result_store,
    get_result_store,
)


@pytest.fixture(autouse=True)
def setup_context():
    inject_agent_context("test-account", "테스트 메시지", [])
    init_result_store()


# ── get_profile ───────────────────────────────────────────────────────────

def test_get_profile_returns_profile(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"display_name": "김사장", "business_type": "카페", "location": "서울"}
    ]
    monkeypatch.setattr("app.agents._planner_tools.get_supabase", lambda: mock_sb)
    result = get_profile.invoke({})
    assert result["display_name"] == "김사장"
    assert result["business_type"] == "카페"


def test_get_profile_returns_empty_when_no_row(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr("app.agents._planner_tools.get_supabase", lambda: mock_sb)
    result = get_profile.invoke({})
    assert result == {}


# ── get_recent_artifacts ──────────────────────────────────────────────────

def test_get_recent_artifacts_returns_list(monkeypatch):
    mock_sb = MagicMock()
    # Chain: .table().select().eq().eq().order().limit().execute()
    mock_chain = MagicMock()
    mock_chain.execute.return_value.data = [
        {
            "id": "abc",
            "title": "채용공고",
            "type": "job_posting",
            "domains": ["recruitment"],
            "created_at": "2026-04-26T10:00:00",
        }
    ]
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value = mock_chain
    monkeypatch.setattr("app.agents._planner_tools.get_supabase", lambda: mock_sb)
    result = get_recent_artifacts.invoke({"limit": 5})
    assert len(result) == 1
    assert result[0]["title"] == "채용공고"
    assert result[0]["created_at"] == "2026-04-26"


# ── Terminal tools ─────────────────────────────────────────────────────────

def test_ask_user_stores_result():
    ask_user.invoke({"question": "업종이 무엇인가요?", "choices": ["카페", "음식점", "기타 (직접 입력)"]})
    store = get_result_store()
    assert store["mode"] == "ask"
    assert store["question"] == "업종이 무엇인가요?"
    assert store["choices"] == ["카페", "음식점", "기타 (직접 입력)"]


def test_dispatch_stores_result():
    steps = [{"capability": "mkt_sns_post", "args": {"topic": "신메뉴"}, "depends_on": None}]
    dispatch.invoke({"steps": steps, "brief": "SNS 게시물 작성", "opening": "작성할게요."})
    store = get_result_store()
    assert store["mode"] == "dispatch"
    assert store["steps"][0]["capability"] == "mkt_sns_post"
    assert store["opening"] == "작성할게요."


def test_trigger_planning_stores_result():
    trigger_planning.invoke({"opening": "이번 주 할 일을 정리해 드릴게요."})
    store = get_result_store()
    assert store["mode"] == "planning"
    assert "이번 주" in store["opening"]


def test_result_store_isolated_per_init():
    init_result_store()
    ask_user.invoke({"question": "첫 번째 질문"})
    assert get_result_store()["question"] == "첫 번째 질문"

    init_result_store()  # 새 요청 시뮬레이션
    assert get_result_store() == {}  # 초기화됨
