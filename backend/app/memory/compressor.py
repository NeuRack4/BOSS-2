from app.core.llm import chat_completion
from app.core.config import settings
from . import short_term, long_term


async def maybe_compress(
    account_id: str, session_id: str, messages: list[dict]
) -> list[dict]:
    """20턴 초과 시 오래된 메시지를 요약 → 장기 기억 저장 후 세션 대화 압축"""
    user_turns = sum(1 for m in messages if m["role"] == "user")
    if user_turns <= settings.memory_compress_threshold:
        return messages

    system_msgs = [m for m in messages if m["role"] == "system"]
    conv_msgs = [m for m in messages if m["role"] != "system"]

    cutoff = len(conv_msgs) // 2
    to_compress = conv_msgs[:cutoff]
    keep = conv_msgs[cutoff:]

    conv_text = "\n".join(f"{m['role']}: {m['content']}" for m in to_compress)
    summary_resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": "다음 대화를 핵심만 간결하게 한국어로 요약하세요.",
            },
            {"role": "user", "content": conv_text},
        ],
        model=settings.openai_compress_model,
        max_tokens=400,
    )
    summary = summary_resp.choices[0].message.content

    await long_term.save_memory(account_id, summary, importance=1.5)

    compressed = (
        system_msgs
        + [{"role": "assistant", "content": f"[이전 대화 요약] {summary}"}]
        + keep
    )
    await short_term.replace_messages(account_id, session_id, compressed)
    return compressed
