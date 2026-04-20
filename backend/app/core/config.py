from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # OpenAI
    openai_api_key: str
    openai_chat_model: str = "gpt-4o"
    openai_compress_model: str = "gpt-4o-mini"

    # Embedding
    embed_model: str = "BAAI/bge-m3"
    embed_dim: int = 1024

    # Supabase
    supabase_url: str
    supabase_service_key: str  # service_role key (RLS bypass for backend)

    # Redis (Upstash)
    upstash_redis_rest_url: str
    upstash_redis_rest_token: str

    # Celery (Upstash Redis TCP — rediss://default:<pw>@host:6379/0)
    celery_broker_url: str = ""
    celery_result_backend: str = ""  # 비우면 broker 재사용
    scheduler_tick_seconds: int = 60

    # Naver Blog (optional)
    naver_blog_id: str = ""
    naver_blog_pw: str = ""

    # App
    cors_origins: list[str] = ["http://localhost:3000"]
    memory_compress_threshold: int = 20  # 20턴 초과 시 압축


settings = Settings()
