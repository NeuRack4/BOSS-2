from celery import Celery
from celery.schedules import crontab, schedule as celery_schedule

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
    # Beat crontab 은 KST 기준 (timezone="Asia/Seoul"), UTC 내부 저장으로 expires 비교 정확히 동작.
    timezone="Asia/Seoul",
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
        # Worker 다운 중 쌓인 stale tick은 버림 — backlog 방지
        "options": {"expires": settings.scheduler_tick_seconds},
    },
    # YouTube 댓글 1시간마다 자동 수집 (dev)
    "comment-scan": {
        "task":     "app.scheduler.tasks.scan_comments",
        "schedule": celery_schedule(run_every=3600),
    },
    # v1.3: memory_long 7일 이전 row 매일 00:00 KST 청소.
    "cleanup-old-memories": {
        "task":     "app.scheduler.tasks.cleanup_old_memories",
        "schedule": crontab(hour=0, minute=0),
    },
    # 월정액 자동 청구 — 매일 09:00 KST next_billing_date 도래 구독 청구.
    "charge-subscriptions": {
        "task":     "app.scheduler.tasks.charge_subscriptions",
        "schedule": crontab(hour=9, minute=0),
    },
    # Sales Slack 알림 — 매시 정각 KST
    "sales-slack-notify": {
        "task": "app.scheduler.tasks.sales_slack_notify",
        "schedule": crontab(minute=0),
    },
}
