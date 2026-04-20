import asyncio
import re

from fastapi import APIRouter, HTTPException, Query

from app.agents import orchestrator
from app.agents._artifact import get_focus_artifact_id, clear_focus_artifact_id
from app.memory import compressor, long_term, sessions, short_term
from app.models.schemas import (
    ChatRequest,
    ChatResponse,
    SessionDeleteRequest,
    SessionListResponse,
    SessionMessagesResponse,
    SessionRenameRequest,
)
from app.rag.retriever import format_context, hybrid_search

router = APIRouter(prefix="/api/chat", tags=["chat"])

_CHOICES_RE = re.compile(r"\[CHOICES\](.*?)\[/CHOICES\]", re.DOTALL)


def _extract_choices(text: str) -> tuple[str, list[str]]:
    match = _CHOICES_RE.search(text)
    if not match:
        return text, []
    choices = [
        line.strip() for line in match.group(1).strip().splitlines() if line.strip()
    ]
    cleaned = _CHOICES_RE.sub("", text).strip()
    return cleaned, choices


async def _maybe_title(account_id: str, session_id: str, first_user_msg: str) -> None:
    try:
        title = await sessions.generate_title(first_user_msg)
        await sessions.rename_session(account_id, session_id, title)
    except Exception:
        pass


@router.post("", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="메시지가 비어있습니다.")

    account_id = req.account_id
    session_id = req.session_id

    # 세션 없으면 새로 생성
    session_created = False
    if not session_id:
        sess = await sessions.create_session(account_id)
        session_id = sess["id"]
        session_created = True

    # 1. 단기 메모리 (세션 스코프)
    history = await short_term.get_messages(session_id)

    # 첫 user 메시지 여부 판단 (제목 생성 트리거)
    is_first_user_msg = not any(m["role"] == "user" for m in history)

    # 2. 20턴 초과 시 압축
    history = await compressor.maybe_compress(account_id, session_id, history)

    # 3. RAG 컨텍스트
    rag_chunks = await hybrid_search(account_id, req.message, limit=4)
    rag_context = format_context(rag_chunks)

    # 4. 장기 기억 recall
    memories = await long_term.recall(account_id, req.message, limit=3)
    long_term_context = "\n".join(m["content"] for m in memories) if memories else ""

    # 5. Orchestrator 실행
    clear_focus_artifact_id()
    reply = await orchestrator.run(
        message=req.message,
        account_id=account_id,
        history=history,
        rag_context=rag_context,
        long_term_context=long_term_context,
    )

    # 6. 대화 저장
    await short_term.append_message(account_id, session_id, "user", req.message)
    await short_term.append_message(account_id, session_id, "assistant", reply)

    # 첫 user 메시지면 제목 생성 (백그라운드)
    if is_first_user_msg:
        asyncio.create_task(_maybe_title(account_id, session_id, req.message))

    # [ARTIFACT] 블록은 제거하되, 그 뒤에 붙은 [[마커]]는 유지
    _ARTIFACT_BLOCK_RE = re.compile(r"\[ARTIFACT\].*?\[/ARTIFACT\]", re.DOTALL)
    without_artifact = _ARTIFACT_BLOCK_RE.sub("", reply).strip()
    clean_reply, choices = _extract_choices(without_artifact)

    response_data: dict = {
        "reply": clean_reply,
        "choices": choices,
        "session_id": session_id,
        "session_created": session_created,
    }
    focus_id = get_focus_artifact_id()
    if focus_id:
        response_data["artifact_id"] = focus_id

    return ChatResponse(data=response_data)


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    account_id: str = Query(...), limit: int = Query(50, ge=1, le=200)
):
    rows = await sessions.list_sessions(account_id, limit=limit)
    return SessionListResponse(data=rows)


@router.post("/sessions", response_model=ChatResponse)
async def create_session_endpoint(account_id: str = Query(...)):
    sess = await sessions.create_session(account_id)
    return ChatResponse(data={"session_id": sess["id"], "title": sess["title"]})


@router.get("/sessions/{session_id}/messages", response_model=SessionMessagesResponse)
async def get_session_messages(session_id: str, account_id: str = Query(...)):
    sess = await sessions.get_session(account_id, session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    msgs = await sessions.get_session_messages(account_id, session_id)
    return SessionMessagesResponse(data={"session": sess, "messages": msgs})


@router.patch("/sessions/{session_id}", response_model=ChatResponse)
async def rename_session_endpoint(session_id: str, req: SessionRenameRequest):
    await sessions.rename_session(req.account_id, session_id, req.title)
    return ChatResponse(data={"session_id": session_id, "title": req.title})


@router.delete("/sessions/{session_id}", response_model=ChatResponse)
async def delete_session_endpoint(session_id: str, req: SessionDeleteRequest):
    await sessions.delete_session(req.account_id, session_id)
    return ChatResponse(data={"session_id": session_id, "deleted": True})
