"""Per-request agent context via ContextVar — asyncio-safe."""
from __future__ import annotations

from contextvars import ContextVar

_account_id: ContextVar[str] = ContextVar("agent_account_id", default="")
_message: ContextVar[str] = ContextVar("agent_message", default="")
_history: ContextVar[list] = ContextVar("agent_history", default=[])
_rag_context: ContextVar[str] = ContextVar("agent_rag_context", default="")
_long_term_context: ContextVar[str] = ContextVar("agent_long_term_context", default="")


def inject_agent_context(
    account_id: str,
    message: str,
    history: list,
    rag_context: str = "",
    long_term_context: str = "",
) -> None:
    _account_id.set(account_id)
    _message.set(message)
    _history.set(history)
    _rag_context.set(rag_context)
    _long_term_context.set(long_term_context)


def get_account_id() -> str:
    return _account_id.get()


def get_message() -> str:
    return _message.get()


def get_history() -> list:
    return _history.get()


def get_rag_context() -> str:
    return _rag_context.get()


def get_long_term_context() -> str:
    return _long_term_context.get()
