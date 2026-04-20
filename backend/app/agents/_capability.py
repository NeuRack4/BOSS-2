"""Capability 레지스트리 — function-calling 기반 라우팅용.

각 도메인 에이전트 모듈이 `describe(account_id) -> list[Capability]` 를 export하면,
`describe_all(account_id)` 이 4개 도메인(recruitment · documents · marketing · sales)을 모아
OpenAI `tools` 스펙 + handler dispatch map 을 만들어 돌려준다.

Capability handler 시그니처는 공통:
    async def handler(*, account_id: str, message: str, history: list[dict],
                      long_term_context: str = "", rag_context: str = "",
                      **tool_args) -> str
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, TypedDict


class Capability(TypedDict, total=False):
    name: str                     # OpenAI tool function name (snake_case, 고유)
    description: str              # LLM 이 tool 선택할 때 보는 설명
    parameters: dict[str, Any]    # JSON Schema
    handler: Callable[..., Awaitable[str]]


class DispatchEntry(TypedDict):
    domain: str
    handler: Callable[..., Awaitable[str]]


# V2(capability) 경로로 라우팅되는 도메인. 4개 도메인 모두 function-calling.
V2_DOMAINS: tuple[str, ...] = ("recruitment", "documents", "marketing", "sales")


def describe_all(account_id: str) -> tuple[list[dict], dict[str, DispatchEntry]]:
    """V2 도메인들의 describe() 를 모아 OpenAI tools 스펙 + dispatch 맵을 반환.

    Returns:
        tools_spec: OpenAI `tools` 인자 그대로 넘길 수 있는 dict 리스트.
        dispatch:   {capability_name: {domain, handler}} — tool_calls 처리용.
    """
    from app.agents import recruitment, documents, marketing, sales  # 순환 import 회피

    tools: list[dict] = []
    dispatch: dict[str, DispatchEntry] = {}

    for module, domain_name in (
        (recruitment, "recruitment"),
        (documents, "documents"),
        (marketing, "marketing"),
        (sales, "sales"),
    ):
        describe_fn = getattr(module, "describe", None)
        if not callable(describe_fn):
            continue
        try:
            caps: list[Capability] = describe_fn(account_id) or []
        except Exception:
            caps = []
        for cap in caps:
            name = cap.get("name")
            handler = cap.get("handler")
            if not name or not callable(handler):
                continue
            tools.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": cap.get("description", ""),
                    "parameters": cap.get("parameters") or {"type": "object", "properties": {}},
                },
            })
            dispatch[name] = {"domain": domain_name, "handler": handler}

    return tools, dispatch
