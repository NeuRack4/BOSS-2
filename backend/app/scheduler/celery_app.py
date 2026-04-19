from celery import Celery
from celery.schedules import schedule as celery_schedule

from app.core.config import settings


def _ensure_ssl_cert_reqs(url: str) -> str:
    """rediss:// URL 엔 ssl_cert_reqs 쿼리 파라미터가 있어야 Celery result backend 가 뜬다.
    없으면 CERT_REQUIRED 로 자동 추가. http/redis/memory 등은 그대로 반환.
    """
    if not url.startswith("rediss://"):
        return url
    if "ssl_cert_reqs=" in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}ssl_cert_reqs=CERT_REQUIRED"


broker = _ensure_ssl_cert_reqs(settings.celery_broker_url or "memory://")
backend = _ensure_ssl_cert_reqs(
    settings.celery_result_backend or settings.celery_broker_url or "cache+memory://"
)

celery_app = Celery(
    "boss2",
    broker=broker,
    backend=backend,
    include=["app.scheduler.tasks"],
)

celery_app.conf.update(
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    task_default_queue="boss2",
)

celery_app.conf.beat_schedule = {
    "scheduler-tick": {
        "task": "app.scheduler.tasks.tick",
        "schedule": celery_schedule(run_every=settings.scheduler_tick_seconds),
    },
}
