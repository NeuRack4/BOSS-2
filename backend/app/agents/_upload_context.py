"""Chat 요청에 실려온 업로드 payload 를 agent 사이에서 공유하기 위한 contextvar.

v0.10 이전에는 업로드가 `kind='artifact', type='uploaded_doc'` 노드를 만들고
documents 에이전트가 최근 60분 이내 해당 노드를 DB 조회해서 리뷰를 트리거했다.

v0.10 부터는 업로드 자체가 artifact 를 만들지 않는다 — 파싱/스토리지 결과는
즉시 응답으로만 반환되고, 프론트가 이를 다음 chat 요청 body (`upload_payload`)
로 다시 실어 보낸다. 백엔드는 `POST /api/chat` 진입점에서 본 모듈의
`set_pending_upload` 로 contextvar 를 세팅하고, documents 에이전트는
`get_pending_upload()` 로 읽는다.

payload 스키마 (uploads 라우터가 만드는 것과 동일):
  {
    "content":         str,          # 파싱된 본문 전체
    "storage_path":    str,
    "bucket":          str,
    "mime_type":       str,
    "size_bytes":      int,
    "original_name":   str,
    "parsed_len":      int,
    "classification": {"category": "documents", "doc_type": "...", ...},
    "title":           str,          # 확장자 뗀 파일명
  }
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any

_PENDING_UPLOAD: ContextVar[dict[str, Any] | None] = ContextVar(
    "boss2.pending_upload", default=None
)


def set_pending_upload(payload: dict[str, Any] | None) -> None:
    _PENDING_UPLOAD.set(payload)


def get_pending_upload() -> dict[str, Any] | None:
    return _PENDING_UPLOAD.get()


def clear_pending_upload() -> None:
    _PENDING_UPLOAD.set(None)
