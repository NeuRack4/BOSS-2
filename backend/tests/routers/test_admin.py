"""admin 라우터 단위 테스트 — Supabase mock 사용."""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.routers.admin import router, _require_admin


# ── require_admin 헬퍼 ─────────────────────────────────────────────────────

def test_require_admin_raises_when_not_admin(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": False
    }
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)
    with pytest.raises(Exception) as exc_info:
        _require_admin("some-uid")
    assert "403" in str(exc_info.value) or "Forbidden" in str(exc_info.value)


def test_require_admin_passes_when_admin(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": True
    }
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)
    _require_admin("admin-uid")  # should not raise


def test_require_admin_raises_when_profile_missing(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = None
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)
    with pytest.raises(Exception) as exc_info:
        _require_admin("ghost-uid")
    assert "403" in str(exc_info.value) or "Forbidden" in str(exc_info.value)


# ── /users 엔드포인트 ──────────────────────────────────────────────────────

def _make_app():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_users_returns_list(monkeypatch):
    mock_sb = MagicMock()

    profiles_mock = MagicMock()
    profiles_mock.execute.return_value.data = [
        {
            "id": "uid-1",
            "display_name": "김테스트",
            "business_name": "테스트카페",
            "last_seen_at": "2026-04-27T10:00:00+00:00",
            "created_at": "2025-11-03T00:00:00+00:00",
        }
    ]
    sched_mock = MagicMock()
    sched_mock.execute.return_value.data = []
    subs_mock = MagicMock()
    subs_mock.execute.return_value.data = []

    def table_side_effect(name):
        m = MagicMock()
        if name == "profiles":
            # require_admin call
            m.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"is_admin": True}
            # users list call
            m.select.return_value.order.return_value = profiles_mock
        elif name == "artifacts":
            m.select.return_value.eq.return_value.eq.return_value = sched_mock
        elif name == "subscriptions":
            m.select.return_value = subs_mock
        return m

    mock_sb.table.side_effect = table_side_effect
    mock_sb.auth.admin.list_users.return_value = MagicMock(
        users=[MagicMock(id="uid-1", email="test@example.com")]
    )
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    client = _make_app()
    resp = client.get("/api/admin/users?account_id=admin-uid")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


# ── /stats 엔드포인트 ──────────────────────────────────────────────────────

def test_stats_returns_counts(monkeypatch):
    mock_sb = MagicMock()

    def table_side_effect(name):
        m = MagicMock()
        if name == "profiles":
            m.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"is_admin": True}
            count_result = MagicMock()
            count_result.count = 42
            count_result.data = []
            m.select.return_value.execute.return_value = count_result
        elif name == "activity_logs":
            logs_result = MagicMock()
            logs_result.data = [{"account_id": "uid-1"}, {"account_id": "uid-2"}]
            count_result2 = MagicMock()
            count_result2.count = 5
            count_result2.data = []
            m.select.return_value.gte.return_value.execute.return_value = logs_result
            m.select.return_value.eq.return_value.execute.return_value = count_result2
        elif name == "artifacts":
            arts_result = MagicMock()
            arts_result.data = [
                {"metadata": {"schedule_enabled": True}},
                {"metadata": {"schedule_enabled": False}},
            ]
            m.select.return_value.eq.return_value.execute.return_value = arts_result
        return m

    mock_sb.table.side_effect = table_side_effect
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    client = _make_app()
    resp = client.get("/api/admin/stats?account_id=admin-uid")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_users" in data
    assert "dau_today" in data
    assert "total_agent_runs" in data
    assert "active_schedules" in data


# ── /costs 엔드포인트 ──────────────────────────────────────────────────────

def test_costs_returns_per_account(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": True
    }
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    mock_run = MagicMock()
    mock_run.inputs = {"account_id": "uid-1"}
    mock_run.total_tokens = 1000
    mock_run.prompt_tokens = 700
    mock_run.completion_tokens = 300
    mock_run.total_cost = 0.025

    mock_ls = MagicMock()
    mock_ls.list_runs.return_value = iter([mock_run])
    monkeypatch.setattr("app.routers.admin.langsmith.Client", lambda: mock_ls)

    client = _make_app()
    resp = client.get("/api/admin/costs?account_id=admin-uid&days=7")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert data[0]["account_id"] == "uid-1"
    assert data[0]["total_tokens"] == 1000


# ── /payments 엔드포인트 ──────────────────────────────────────────────────────

def test_payments_returns_plan_summary(monkeypatch):
    mock_sb = MagicMock()

    def table_side_effect(name):
        m = MagicMock()
        if name == "profiles":
            m.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"is_admin": True}
        elif name == "subscriptions":
            m.select.return_value.execute.return_value.data = [
                {"account_id": "uid-1", "plan": "pro", "status": "active",
                 "next_billing_date": "2026-05-28", "started_at": None, "cancelled_at": None},
                {"account_id": "uid-2", "plan": "free", "status": "active",
                 "next_billing_date": None, "started_at": None, "cancelled_at": None},
            ]
        return m

    mock_sb.table.side_effect = table_side_effect
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    client = _make_app()
    resp = client.get("/api/admin/payments?account_id=admin-uid")
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert "rows" in data
