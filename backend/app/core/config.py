from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # OpenAI
    openai_api_key: str
    openai_chat_model: str = "gpt-4o"
    openai_compress_model: str = "gpt-4o-mini"

    # Anthropic (optional — planner 만 스위치 가능)
    anthropic_api_key: str = ""
    planner_provider: str = "openai"   # openai | anthropic
    planner_claude_model: str = "claude-sonnet-4-6"
    planner_openai_model: str = "gpt-4o"

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

    # Meta / Instagram (optional)
    meta_access_token: str = ""         # EAA 토큰 — graph.facebook.com 댓글 조회용
    meta_ig_access_token: str = ""      # IGAA 토큰 — graph.instagram.com DM 발송용
    instagram_user_id: str = ""         # Instagram 비즈니스 계정 숫자 ID

    # YouTube (optional)
    youtube_client_id: str = ""
    youtube_client_secret: str = ""
    youtube_redirect_uri: str = "http://localhost:8000/api/marketing/youtube/oauth/callback"

    # Square POS (optional)
    square_app_id: str = ""
    square_access_token: str = ""        # sandbox: EAAl... / prod: 교체
    square_environment: str = "sandbox"  # sandbox | production

    # Bizinfo (기업마당 공공 API)
    bizinfo_api_key: str = ""

    # PortOne V2 결제
    portone_api_secret: str = ""          # PortOne 대시보드 → 결제연동 → API Keys
    portone_store_id:   str = ""          # PortOne 대시보드 → 내 식별코드

    # App
    cors_origins: list[str] = ["http://localhost:3000"]
    memory_compress_threshold: int = 20  # 20턴 초과 시 압축


settings = Settings()
