from app.core.llm import chat_completion
from app.core.supabase import get_supabase
from app.core.config import settings


async def create_session(account_id: str, title: str = "새 대화") -> dict:
    sb = get_supabase()
    row = (
        sb.table("chat_sessions")
        .insert({"account_id": account_id, "title": title})
        .execute()
        .data[0]
    )
    return row


async def list_sessions(account_id: str, limit: int = 50) -> list[dict]:
    sb = get_supabase()
    rows = (
        sb.table("chat_sessions")
        .select("id, title, created_at, updated_at")
        .eq("account_id", account_id)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    return rows


async def get_session(account_id: str, session_id: str) -> dict | None:
    sb = get_supabase()
    rows = (
        sb.table("chat_sessions")
        .select("id, title, created_at, updated_at")
        .eq("account_id", account_id)
        .eq("id", session_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


async def get_session_messages(account_id: str, session_id: str) -> list[dict]:
    sb = get_supabase()
    rows = (
        sb.table("chat_messages")
        .select("role, content, choices, created_at")
        .eq("account_id", account_id)
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
        .data
        or []
    )
    return rows


async def rename_session(account_id: str, session_id: str, title: str) -> None:
    sb = get_supabase()
    sb.table("chat_sessions").update({"title": title}).eq("account_id", account_id).eq(
        "id", session_id
    ).execute()


async def delete_session(account_id: str, session_id: str) -> None:
    sb = get_supabase()
    sb.table("chat_sessions").delete().eq("account_id", account_id).eq(
        "id", session_id
    ).execute()


async def generate_title(first_user_message: str) -> str:
    prompt = first_user_message.strip()[:500]
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "사용자의 첫 메시지를 보고 대화 주제를 짧은 한국어 제목으로 만드세요. "
                    "규칙: 15자 이내, 따옴표/마침표/이모지 없이, 명사구로."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        model=settings.openai_compress_model,
        max_tokens=30,
        temperature=0.3,
    )
    title = (resp.choices[0].message.content or "").strip().strip('"').strip("'")
    title = title.replace("\n", " ").strip()
    if not title:
        title = prompt[:20] or "새 대화"
    return title[:30]
