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
