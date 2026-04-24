"""Sales 도메인 chat 요청 범위 contextvar.

documents 의 `_upload_context.py` 와 동일 패턴. Chat 요청 진입점에서
`set_pending_receipt` / `set_pending_save` 으로 세팅하고,
sales 에이전트의 `describe()` 와 capability 핸들러가 꺼내 쓴다.

요청 종료 후 (finally 블록) 반드시 clear.

스키마
------
pending_receipt (영수증 이미지) — upload 직후 프론트가 실어 보냄
  {
    "storage_path":  str,  # Supabase storage key
    "bucket":        str,
    "mime_type":     str,
    "original_name": str,
    "size_bytes":    int,
  }

pending_save (SalesInputTable / CostInputTable Save 버튼) — 사용자 확정 항목
  {
    "kind":          "revenue" | "cost",
    "recorded_date": "YYYY-MM-DD",
    "items":         [ {item_name, category, quantity?, unit_price?, amount, memo?}, ... ],
    "source":        "chat" | "ocr" | "csv" | "excel",
  }
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

_PENDING_RECEIPT: ContextVar[dict[str, Any] | None] = ContextVar(
    "boss2.pending_receipt", default=None,
)
_PENDING_SAVE: ContextVar[dict[str, Any] | None] = ContextVar(
    "boss2.pending_save", default=None,
)


# -- receipt -----------------------------------------------------------------

def set_pending_receipt(payload: dict[str, Any] | None) -> None:
    _PENDING_RECEIPT.set(payload)


def get_pending_receipt() -> dict[str, Any] | None:
    return _PENDING_RECEIPT.get()


def clear_pending_receipt() -> None:
    _PENDING_RECEIPT.set(None)


# -- save --------------------------------------------------------------------

def set_pending_save(payload: dict[str, Any] | None) -> None:
    _PENDING_SAVE.set(payload)


def get_pending_save() -> dict[str, Any] | None:
    return _PENDING_SAVE.get()


def clear_pending_save() -> None:
    _PENDING_SAVE.set(None)
