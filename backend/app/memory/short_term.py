from app.core.supabase import get_supabase


async def get_messages(session_id: str, include_extras: bool = False) -> list[dict]:
    """세션 대화 전체 로드.

    기본은 LLM 컨텍스트용 `{role, content}` 만 반환.
    `include_extras=True` 면 세션 재오픈 UI 렌더용 `choices` / `attachment` 까지 포함.
    """
    if not session_id:
        return []
    sb = get_supabase()
    select_cols = "role, content, choices, attachment" if include_extras else "role, content"
    rows = (
        sb.table("chat_messages")
        .select(select_cols)
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    if include_extras:
        return [
            {
                "role":       r["role"],
                "content":    r["content"],
                "choices":    r.get("choices"),
                "attachment": r.get("attachment"),
            }
            for r in rows
        ]
    return [{"role": r["role"], "content": r["content"]} for r in rows]


async def append_message(
    account_id: str,
    session_id: str,
    role: str,
    content: str,
    choices: list[str] | None = None,
    attachment: dict | None = None,
    speaker: list[str] | None = None,
) -> None:
    sb = get_supabase()
    payload = {
        "account_id": account_id,
        "session_id": session_id,
        "role": role,
        "content": content,
    }
    if choices:
        payload["choices"] = choices
    if attachment:
        payload["attachment"] = attachment
    if speaker:
        payload["speaker"] = speaker
    sb.table("chat_messages").insert(payload).execute()


async def replace_messages(
    account_id: str, session_id: str, messages: list[dict]
) -> None:
    sb = get_supabase()
    sb.table("chat_messages").delete().eq("session_id", session_id).execute()
    if not messages:
        return
    rows = [
        {
            "account_id": account_id,
            "session_id": session_id,
            "role": m["role"],
            "content": m["content"],
        }
        for m in messages
    ]
    sb.table("chat_messages").insert(rows).execute()


async def get_turn_count(session_id: str) -> int:
    messages = await get_messages(session_id)
    return sum(1 for m in messages if m["role"] == "user")
