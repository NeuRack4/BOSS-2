from pydantic import BaseModel
from typing import Any


class ChatRequest(BaseModel):
    message: str
    account_id: str
    session_id: str | None = None
    # 문서 업로드 (documents 리뷰용) — contextvar 로 전달.
    upload_payload: dict[str, Any] | None = None
    # 복수 파일용 (이력서 등)
    upload_payloads: list[dict[str, Any]] | None = None
    # 영수증 이미지 업로드 (sales OCR 용) — storage_path/bucket/mime_type 등.
    receipt_payload: dict[str, Any] | None = None
    # SalesInputTable / CostInputTable 의 Save 버튼 — 사용자 확정 items.
    save_payload: dict[str, Any] | None = None
    # 투어 완료 후 LLM 인사 트리거 — user 턴 히스토리에 저장하지 않음.
    is_tour_greeting: bool = False


class ChatResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class SessionListResponse(BaseModel):
    data: list[dict[str, Any]]
    error: str | None = None
    meta: dict[str, Any] = {}


class SessionMessagesResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class SessionRenameRequest(BaseModel):
    account_id: str
    title: str


class SessionDeleteRequest(BaseModel):
    account_id: str


class ActivityResponse(BaseModel):
    data: list[dict[str, Any]]
    error: str | None = None
    meta: dict[str, Any] = {}


class EvaluationRequest(BaseModel):
    account_id: str
    artifact_id: str
    rating: str  # 'up' | 'down'
    feedback: str | None = None


class EvaluationResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class ScheduleRunRequest(BaseModel):
    account_id: str


class ScheduleStatusRequest(BaseModel):
    account_id: str
    status: str  # 'active' | 'paused'


class ScheduleResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class ScheduleCreateRequest(BaseModel):
    account_id: str
    artifact_id: str  # 부모 artifact
    cron: str
    title: str | None = None


class ScheduleUpdateRequest(BaseModel):
    account_id: str
    cron: str


class DeleteArtifactRequest(BaseModel):
    account_id: str


class PinRequest(BaseModel):
    account_id: str
    pinned: bool
    position: dict[str, float] | None = None  # {x, y}


class SummaryRequest(BaseModel):
    account_id: str
    scope: str  # 'all' | 'recruitment' | 'marketing' | 'sales' | 'documents'


class SummaryResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class SessionTouchRequest(BaseModel):
    account_id: str


class SessionTouchResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class UploadDocumentResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class ReviewRequest(BaseModel):
    account_id: str
    doc_artifact_id: str
    user_role: str = "미지정"            # '갑' | '을' | '미지정'
    contract_subtype: str | None = None  # 'labor' | 'lease' | ... | None
    doc_type: str = "계약서"              # '계약서' | '제안서' | '기타'


class ReviewResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class ArtifactDetailResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}


class ArtifactPatchRequest(BaseModel):
    account_id: str
    # content
    content: str | None = None
    # period
    period_enabled: bool | None = None
    start_date: str | None = None   # YYYY-MM-DD
    end_date: str | None = None
    due_date: str | None = None
    due_label: str | None = None
    # schedule
    schedule_enabled: bool | None = None
    cron: str | None = None
    schedule_status: str | None = None  # 'active' | 'paused'


class MemoryBoostRequest(BaseModel):
    account_id: str
    artifact_id: str
    importance: float   # 0.2 / 0.4 / 0.6 / 0.8 / 1.0 (1~5 stars mapped)
    note: str | None = None


class MemoryBoostResponse(BaseModel):
    data: dict[str, Any]
    error: str | None = None
    meta: dict[str, Any] = {}
