"""Planner DeepAgent 통합 테스트 — LLM mock 사용."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents._planner import plan


@pytest.fixture
def base_kwargs():
    return {
        "account_id": "test-account",
        "message": "SNS 게시물 만들어줘",
        "history": [],
        "rag_context": "",
        "long_term_context": "",
        "nick_ctx": "",
    }


@pytest.mark.asyncio
async def test_plan_dispatch_mode(base_kwargs):
    """dispatch terminal tool 결과가 result store에 있으면 mode=dispatch PlanResult 반환."""
    from app.agents._planner_tools import init_result_store, dispatch as dispatch_tool

    # pre-populate the store before plan() resets it
    store = init_result_store()
    dispatch_steps = [{"capability": "mkt_sns_post_form", "args": {}, "depends_on": None}]
    dispatch_tool.invoke({
        "steps": dispatch_steps,
        "brief": "SNS 폼 열기",
        "opening": "게시물 폼을 열어드릴게요.",
    })

    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(return_value={"messages": []})

    # patch at _planner_tools level since plan() does a local import
    with patch("app.agents._planner_tools.init_result_store", return_value=store), \
         patch("app.agents._planner_tools.get_result_store", return_value=store), \
         patch("deepagents.create_deep_agent", return_value=mock_agent), \
         patch("app.agents._planner._make_model", return_value=MagicMock()):
        result = await plan(**base_kwargs)

    assert result["mode"] == "dispatch"
    assert result["steps"][0]["capability"] == "mkt_sns_post_form"
    assert "폼" in result["opening"]


@pytest.mark.asyncio
async def test_plan_ask_mode():
    """ask_user terminal tool 결과가 있으면 mode=ask PlanResult 반환."""
    from app.agents._planner_tools import init_result_store, ask_user

    store = init_result_store()
    ask_user.invoke({
        "question": "업종이 어떻게 되세요?",
        "choices": ["카페·베이커리", "음식점", "기타 (직접 입력)"],
    })

    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(return_value={"messages": []})

    with patch("app.agents._planner_tools.init_result_store", return_value=store), \
         patch("app.agents._planner_tools.get_result_store", return_value=store), \
         patch("deepagents.create_deep_agent", return_value=mock_agent), \
         patch("app.agents._planner._make_model", return_value=MagicMock()):
        result = await plan(
            account_id="test-account",
            message="채용공고 올려줘",
            history=[],
            rag_context="",
            long_term_context="",
            nick_ctx="",
        )

    assert result["mode"] == "ask"
    assert "업종" in result["question"]
    assert len(result["choices"]) == 3


@pytest.mark.asyncio
async def test_plan_returns_error_on_exception():
    """deepagent invoke 예외 시 mode=error 반환."""
    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(side_effect=RuntimeError("LLM timeout"))

    with patch("deepagents.create_deep_agent", return_value=mock_agent), \
         patch("app.agents._planner._make_model", return_value=MagicMock()):
        result = await plan(
            account_id="test-account",
            message="테스트",
            history=[],
            rag_context="",
            long_term_context="",
            nick_ctx="",
        )

    assert result["mode"] == "error"
    assert "invoke" in result["reason"]


@pytest.mark.asyncio
async def test_plan_chitchat_fallback():
    """terminal tool 미호출 시 AIMessage 텍스트가 있으면 mode=chitchat 반환."""
    from langchain_core.messages import AIMessage

    chitchat_reply = "안녕하세요! 무엇을 도와드릴까요?"

    mock_agent = MagicMock()
    mock_agent.ainvoke = AsyncMock(return_value={
        "messages": [AIMessage(content=chitchat_reply)]
    })

    # empty store — simulates terminal tool never called (both invocations return empty)
    empty_store: dict = {}

    with patch("app.agents._planner_tools.init_result_store", return_value=empty_store), \
         patch("app.agents._planner_tools.get_result_store", return_value=empty_store), \
         patch("deepagents.create_deep_agent", return_value=mock_agent), \
         patch("app.agents._planner._make_model", return_value=MagicMock()):
        result = await plan(
            account_id="test-account",
            message="안녕",
            history=[],
            rag_context="",
            long_term_context="",
            nick_ctx="",
        )

    assert result["mode"] == "chitchat"
    assert "안녕" in result["opening"]
