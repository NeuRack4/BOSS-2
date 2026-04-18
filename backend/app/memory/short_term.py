from app.core.supabase import get_supabase


async def get_messages(session_id: str) -> list[dict]:
    if not session_id:
        return []
    sb = get_supabase()
    rows = (
        sb.table("chat_messages")
        .select("role, content")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    return [{"role": r["role"], "content": r["content"]} for r in rows]


async def append_message(
    account_id: str,
    session_id: str,
    role: str,
    content: str,
    choices: list[str] | None = None,
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
