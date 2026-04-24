import logging

# .env 를 os.environ 에 주입 — pydantic-settings 는 Settings 필드만 읽으므로
# LANGCHAIN_* 처럼 Settings 에 없는 외부 라이브러리 환경변수는 명시적 로드 필요.
# 다른 import 보다 먼저 실행돼야 langsmith.traceable 이 활성 상태로 로드됨.
from dotenv import load_dotenv
load_dotenv()

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
    comments,
    costs,
    dashboard,
    dm_campaigns,
    docx,
    evaluations,
    integrations,
    kanban,
    marketing,
    memory,
    menus,
    memos,
    payment,
    pos,
    recruitment,
    reviews,
    sales,
    schedules,
    stats,
    search,
    subsidies,
    summary,
    uploads,
)
from app.routers.employees import router as employees_router, work_router as work_records_router

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
app.include_router(integrations.router)
app.include_router(payment.router)
app.include_router(comments.router)
app.include_router(dm_campaigns.router)
app.include_router(activity.router)
app.include_router(evaluations.router)
app.include_router(schedules.router)
app.include_router(artifacts.router)
app.include_router(summary.router)
app.include_router(dashboard.router)
app.include_router(kanban.router)
app.include_router(marketing.router)
app.include_router(memory.router)
app.include_router(memos.router)
app.include_router(recruitment.router)
app.include_router(search.router)
app.include_router(uploads.router)
app.include_router(reviews.router)
app.include_router(costs.router)
app.include_router(menus.router)
app.include_router(pos.router)
app.include_router(sales.router)
app.include_router(subsidies.router)
app.include_router(stats.router)
app.include_router(employees_router)
app.include_router(work_records_router)
app.include_router(docx.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
