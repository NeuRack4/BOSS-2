"""Documents tool 단위 테스트 — mock 사용."""
import pytest
from unittest.mock import patch

from app.agents._agent_context import inject_agent_context
from app.agents._documents_tools import (
    write_document,
    analyze_document,
    get_sub_hubs,
    init_docs_result_store,
    get_docs_result_store,
)


@pytest.fixture(autouse=True)
def setup_context():
    inject_agent_context("test-account", "테스트", [])
    init_docs_result_store()


# ── result store ──────────────────────────────────────────────────────────

def test_result_store_initialized_empty():
    assert get_docs_result_store() == {}


def test_write_document_stores_result():
    write_document.invoke({
        "doc_type": "contract",
        "title": "근로계약서",
        "content": "계약서 본문",
        "subtype": "labor",
        "due_date": "2027-04-25",
        "due_label": "계약 만료",
    })
    store = get_docs_result_store()
    assert store["action"] == "write"
    assert store["doc_type"] == "contract"
    assert store["title"] == "근로계약서"
    assert store["subtype"] == "labor"
    assert store["due_date"] == "2027-04-25"


def test_analyze_document_stores_result():
    analyze_document.invoke({
        "user_role": "을",
        "doc_type": "계약서",
        "contract_subtype": "labor",
    })
    store = get_docs_result_store()
    assert store["action"] == "analyze"
    assert store["user_role"] == "을"
    assert store["contract_subtype"] == "labor"


def test_result_store_isolated_per_init():
    write_document.invoke({"doc_type": "estimate", "title": "견적서", "content": "내용"})
    assert get_docs_result_store()["doc_type"] == "estimate"

    init_docs_result_store()
    assert get_docs_result_store() == {}


# ── get_sub_hubs ──────────────────────────────────────────────────────────

def test_get_sub_hubs_returns_list():
    with patch("app.agents._artifact.list_sub_hub_titles", return_value=["Review", "Tax&HR"]):
        result = get_sub_hubs.invoke({})
    assert isinstance(result, list)
