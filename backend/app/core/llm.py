from openai import AsyncOpenAI
from .config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)


async def chat_completion(messages: list[dict], model: str | None = None, **kwargs):
    return await client.chat.completions.create(
        model=model or settings.openai_chat_model,
        messages=messages,
        **kwargs,
    )


