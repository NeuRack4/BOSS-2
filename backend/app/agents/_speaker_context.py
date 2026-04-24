"""마지막 응답을 생성한 agent(들)을 요청 단위로 추적하는 contextvar.

chat router 가 orchestrator.run() 호출 전후로 값을 읽어
- short_term.append_message(speaker=...) 에 저장 → 세션 복구 시 하이드레이트
- ChatResponse.data.speaker 로 프론트에 노출 → 상태 배지 렌더

mode → speaker 매핑 규약:
  chitchat / refuse / planning / ask      → ['orchestrator']
  dispatch (step 1개 단일 도메인)          → [<domain>]
  dispatch (여러 step / 복수 도메인)       → [<domain>, ...] (중복 제거)
  legacy fallback                          → [<domain>] 또는 ['orchestrator'] (chitchat 분기)
"""
from __future__ import annotations

from contextvars import ContextVar


_current: ContextVar[list[str] | None] = ContextVar("boss2_last_speaker", default=None)


def set_speaker(value: list[str] | None) -> None:
    _current.set(list(value) if value else None)


def get_speaker() -> list[str] | None:
    return _current.get()


def clear_speaker() -> None:
    _current.set(None)
