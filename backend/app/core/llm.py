"""LLM 헬퍼 — OpenAI 주력 + Anthropic planner 선택.

두 가지 API:
- `chat_completion(...)`   — 기존 OpenAI Chat Completions 래퍼. 도메인 에이전트 전체가 사용.
- `planner_completion(...)` — Planner 전용. provider 토글(openai|anthropic) + 구조화 JSON 출력 통일.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI

from .config import settings

log = logging.getLogger("boss2.llm")

client = AsyncOpenAI(api_key=settings.openai_api_key)

# Anthropic 클라이언트는 lazy — key 가 없거나 provider=openai 면 import 조차 안 함.
_anthropic_client = None


def _get_anthropic_client():
    global _anthropic_client
    if _anthropic_client is not None:
        return _anthropic_client
    if not settings.anthropic_api_key:
        raise RuntimeError(
            "planner_provider=anthropic 이지만 ANTHROPIC_API_KEY 가 설정되지 않음",
        )
    from anthropic import AsyncAnthropic  # type: ignore
    _anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


async def chat_completion(messages: list[dict], model: str | None = None, **kwargs):
    return await client.chat.completions.create(
        model=model or settings.openai_chat_model,
        messages=messages,
        **kwargs,
    )


async def planner_completion(
    *,
    messages: list[dict],
    json_schema: dict,
    max_tokens: int = 2048,
    temperature: float = 0.2,
) -> dict[str, Any]:
    """Planner 전용 구조화 JSON 출력 — provider 추상화.

    Args:
        messages:    OpenAI 형식 messages (system/user/assistant role).
        json_schema: OpenAI response_format.json_schema 와 동일한 dict
                     (name, schema: {type:object, properties, required}).
        max_tokens:  응답 상한. 기본 2048.
        temperature: 기본 0.2 (거의 결정적).

    Returns:
        parsed JSON dict. 실패 시 예외 raise — 상위 caller 가 폴백 판단.
    """
    provider = (settings.planner_provider or "openai").lower()
    if provider == "anthropic":
        return await _planner_anthropic(messages, json_schema, max_tokens, temperature)
    return await _planner_openai(messages, json_schema, max_tokens, temperature)


async def _planner_openai(
    messages: list[dict], json_schema: dict, max_tokens: int, temperature: float,
) -> dict[str, Any]:
    resp = await client.chat.completions.create(
        model=settings.planner_openai_model,
        messages=messages,
        response_format={"type": "json_schema", "json_schema": json_schema},
        temperature=temperature,
        max_tokens=max_tokens,
    )
    raw = (resp.choices[0].message.content or "").strip()
    if not raw:
        raise RuntimeError("openai planner returned empty content")
    return json.loads(raw)


async def _planner_anthropic(
    messages: list[dict], json_schema: dict, max_tokens: int, temperature: float,
) -> dict[str, Any]:
    """Anthropic 경로 — messages API 의 tool_use 로 JSON 강제.

    구조화 JSON 을 확실히 받으려고 단일 tool 을 `tool_choice=any` 로 강제 호출시킨다.
    OpenAI response_format=json_schema 와 동일한 "스키마 준수" 를 보장.
    """
    anthropic = _get_anthropic_client()

    # OpenAI messages → Anthropic messages 변환.
    # Anthropic 은 system 을 최상위 파라미터로, user/assistant 만 messages 배열에 넣는다.
    system_parts: list[str] = []
    anth_messages: list[dict] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            system_parts.append(content)
            continue
        if role not in ("user", "assistant"):
            continue
        if not content.strip():
            continue
        anth_messages.append({"role": role, "content": content})
    if not anth_messages:
        raise RuntimeError("anthropic planner: messages 가 모두 비어있음")

    # 첫 메시지는 반드시 user 여야 함
    if anth_messages[0]["role"] != "user":
        anth_messages.insert(0, {"role": "user", "content": "(대화 시작)"})

    tool_name = json_schema.get("name") or "emit_plan"
    tool_schema = json_schema.get("schema") or {"type": "object", "properties": {}}
    tool = {
        "name": tool_name,
        "description": "Emit the orchestrator plan as structured JSON.",
        "input_schema": tool_schema,
    }

    resp = await anthropic.messages.create(
        model=settings.planner_claude_model,
        max_tokens=max_tokens,
        temperature=temperature,
        system="\n\n".join(system_parts) if system_parts else None,
        messages=anth_messages,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool_name},
    )

    # stop_reason=tool_use 기대. content 블록 중 type=tool_use 찾기.
    for block in resp.content:
        if getattr(block, "type", None) == "tool_use":
            inp = getattr(block, "input", None)
            if isinstance(inp, dict):
                return inp
            if isinstance(inp, str):
                return json.loads(inp)
    raise RuntimeError(f"anthropic planner: no tool_use block. stop_reason={resp.stop_reason}")
