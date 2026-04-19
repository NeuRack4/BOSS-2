from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.routers import activity, artifacts, chat, evaluations, memos, schedules, search, summary

app = FastAPI(title="BOSS-2 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router)
app.include_router(activity.router)
app.include_router(evaluations.router)
app.include_router(schedules.router)
app.include_router(artifacts.router)
app.include_router(summary.router)
app.include_router(memos.router)
app.include_router(search.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
