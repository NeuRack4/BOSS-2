import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

# INFO 레벨 라우팅 로그(orchestrator/documents/_legal) 를 uvicorn 콘솔에 노출.
# 이미 루트 로거가 설정되어 있으면 중복 추가하지 않는다.
if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
logging.getLogger("boss2.orchestrator").setLevel(logging.INFO)
logging.getLogger("app.agents.documents").setLevel(logging.INFO)
logging.getLogger("app.agents._legal").setLevel(logging.INFO)

# 우리 로그를 덮지 않도록 외부 라이브러리 소음 억제.
for _noisy in ("httpx", "httpcore", "huggingface_hub", "sentence_transformers",
               "urllib3", "asyncio", "watchfiles"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)
from app.routers import (
    activity,
    artifacts,
    auth,
    chat,
    evaluations,
    marketing,
    memos,
    recruitment,
    reviews,
    schedules,
    search,
    summary,
    uploads,
)

app = FastAPI(title="BOSS-2 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(activity.router)
app.include_router(evaluations.router)
app.include_router(schedules.router)
app.include_router(artifacts.router)
app.include_router(summary.router)
app.include_router(marketing.router)
app.include_router(memos.router)
app.include_router(recruitment.router)
app.include_router(search.router)
app.include_router(uploads.router)
app.include_router(reviews.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
