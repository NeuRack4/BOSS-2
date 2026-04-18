from pydantic import BaseModel
from typing import Any


class ChatRequest(BaseModel):
    message: str
    account_id: str
    session_id: str | None = None


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
