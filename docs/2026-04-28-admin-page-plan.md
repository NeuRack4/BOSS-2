# Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `profiles.is_admin = true` 계정으로 로그인 시 우하단 FAB 버튼이 나타나고, /admin 페이지에서 유저 목록(+스케줄), 구독/결제, 시스템 통계, Langsmith 기반 계정별 LLM 코스트를 확인할 수 있다.

**Architecture:** DB 마이그레이션으로 `profiles.is_admin` 컬럼 추가 → FastAPI `/api/admin/*` 라우터(service_role key로 전 계정 데이터 조회, is_admin 검증) → Next.js `/admin` 페이지(탭 4개) + 전역 AdminFab 컴포넌트.

**Tech Stack:** Python 3.12 / FastAPI / Supabase service_role / langsmith SDK / Next.js 16 App Router / TypeScript / Tailwind CSS

---

## File Map

| 파일 | 역할 |
|---|---|
| `supabase/migrations/040_admin_flag.sql` | profiles.is_admin 컬럼 추가 |
| `backend/app/routers/admin.py` | `/api/admin/*` 4개 엔드포인트 + require_admin 가드 |
| `backend/app/main.py` | admin 라우터 마운트 |
| `backend/tests/routers/test_admin.py` | admin 라우터 단위 테스트 |
| `frontend/hooks/useIsAdmin.ts` | Supabase로 is_admin 조회 훅 |
| `frontend/components/layout/AdminFab.tsx` | 우하단 FAB (isAdmin=true 시 렌더) |
| `frontend/app/providers.tsx` | AdminFab 마운트 추가 |
| `frontend/app/admin/page.tsx` | Admin 메인 페이지 (탭 4개) |

---

## Task 1: feature-admin 브랜치 생성

**Files:**
- (git only)

- [ ] **Step 1: 브랜치 생성 및 전환**

```bash
git checkout dev
git pull origin dev
git checkout -b feature-admin
```

Expected: `Switched to a new branch 'feature-admin'`

---

## Task 2: DB 마이그레이션 — profiles.is_admin 추가

**Files:**
- Create: `supabase/migrations/040_admin_flag.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/040_admin_flag.sql` 를 아래 내용으로 생성:

```sql
-- 040_admin_flag.sql
-- profiles 테이블에 is_admin 플래그 추가.
-- 기본값 false. DB에서 직접 UPDATE로 권한 부여.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
```

- [ ] **Step 2: Supabase SQL Editor 또는 MCP에서 실행**

Supabase 대시보드 → SQL Editor에 위 SQL을 붙여넣고 실행.
또는 MCP supabase 도구로 실행.

확인: `SELECT id, is_admin FROM profiles LIMIT 5;` → `is_admin` 컬럼이 false로 나타나야 함.

- [ ] **Step 3: 본인 계정에 is_admin=true 설정 (테스트용)**

```sql
UPDATE public.profiles
SET is_admin = true
WHERE id = '<your-auth-user-id>';
```

Supabase Auth → Users에서 본인 UUID 확인 후 대입.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/040_admin_flag.sql
git commit -m "db: profiles에 is_admin 컬럼 추가"
```

---

## Task 3: Backend — admin 라우터 스켈레톤 + require_admin 가드 + 테스트

**Files:**
- Create: `backend/app/routers/admin.py`
- Create: `backend/tests/routers/__init__.py`
- Create: `backend/tests/routers/test_admin.py`

- [ ] **Step 1: 테스트 파일 작성 (failing)**

`backend/tests/routers/__init__.py` → 빈 파일 생성.

`backend/tests/routers/test_admin.py`:

```python
"""admin 라우터 단위 테스트 — Supabase mock 사용."""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.routers.admin import router, _require_admin


# ── require_admin 헬퍼 ─────────────────────────────────────────────────────

def test_require_admin_raises_when_not_admin(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": False
    }
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)
    with pytest.raises(Exception) as exc_info:
        _require_admin("some-uid")
    assert "403" in str(exc_info.value) or "Forbidden" in str(exc_info.value)


def test_require_admin_passes_when_admin(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": True
    }
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)
    _require_admin("admin-uid")  # should not raise


def test_require_admin_raises_when_profile_missing(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = None
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)
    with pytest.raises(Exception) as exc_info:
        _require_admin("ghost-uid")
    assert "403" in str(exc_info.value) or "Forbidden" in str(exc_info.value)
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

```bash
cd backend
pytest tests/routers/test_admin.py -v
```

Expected: `ERROR` (모듈 없음 — `app.routers.admin` not found)

- [ ] **Step 3: admin.py 스켈레톤 구현**

`backend/app/routers/admin.py`:

```python
"""Admin 전용 엔드포인트.

모든 엔드포인트는 `account_id` 쿼리 파라미터를 받고,
`_require_admin(account_id)` 로 is_admin 여부를 검증한다.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta, timezone, datetime

from fastapi import APIRouter, HTTPException, Query
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin(account_id: str) -> None:
    """account_id의 profiles.is_admin이 true가 아니면 HTTP 403 발생."""
    sb = get_supabase()
    res = (
        sb.table("profiles")
        .select("is_admin")
        .eq("id", account_id)
        .single()
        .execute()
    )
    if not res.data or not res.data.get("is_admin"):
        raise HTTPException(status_code=403, detail="Forbidden")
```

- [ ] **Step 4: 테스트 재실행 → PASS 확인**

```bash
pytest tests/routers/test_admin.py -v
```

Expected: `3 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/app/routers/admin.py backend/tests/routers/
git commit -m "feat(admin): 라우터 스켈레톤 + require_admin 가드"
```

---

## Task 4: Backend — GET /api/admin/users

**Files:**
- Modify: `backend/app/routers/admin.py`
- Modify: `backend/tests/routers/test_admin.py`

- [ ] **Step 1: 테스트 추가 (failing)**

`test_admin.py` 끝에 추가:

```python
# ── /users 엔드포인트 ──────────────────────────────────────────────────────

def _make_app():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_users_returns_list(monkeypatch):
    mock_sb = MagicMock()
    # require_admin mock
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": True
    }
    # users query mock: auth.users via rpc not available in service_role simple client
    # We mock the profiles+subscriptions join response
    profiles_mock = MagicMock()
    profiles_mock.execute.return_value.data = [
        {
            "id": "uid-1",
            "display_name": "김테스트",
            "business_name": "테스트카페",
            "last_seen_at": "2026-04-27T10:00:00+00:00",
            "created_at": "2025-11-03T00:00:00+00:00",
        }
    ]
    # schedules mock
    sched_mock = MagicMock()
    sched_mock.execute.return_value.data = []

    def table_side_effect(name):
        m = MagicMock()
        if name == "profiles":
            m.select.return_value.order.return_value = profiles_mock
        elif name == "artifacts":
            m.select.return_value.eq.return_value.eq.return_value = sched_mock
        return m

    mock_sb.table.side_effect = table_side_effect
    # auth.list_users mock
    mock_sb.auth.admin.list_users.return_value = MagicMock(
        users=[MagicMock(id="uid-1", email="test@example.com")]
    )
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    client = _make_app()
    resp = client.get("/api/admin/users?account_id=admin-uid")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
```

- [ ] **Step 2: 테스트 실행 → FAIL**

```bash
pytest tests/routers/test_admin.py::test_users_returns_list -v
```

Expected: FAIL (엔드포인트 없음)

- [ ] **Step 3: /api/admin/users 구현**

`admin.py`의 `_require_admin` 함수 아래에 추가:

```python
@router.get("/users")
async def get_users(account_id: str = Query(...)):
    _require_admin(account_id)
    sb = get_supabase()

    # 전체 profiles 조회 (가입일 역순)
    profiles_res = (
        sb.table("profiles")
        .select("id,display_name,business_name,last_seen_at,created_at")
        .order("created_at", desc=True)
        .execute()
    )
    profiles = profiles_res.data or []

    # auth.users에서 이메일 수집 (service_role admin API)
    auth_users = sb.auth.admin.list_users()
    email_map: dict[str, str] = {
        u.id: u.email for u in (auth_users.users if auth_users else [])
    }

    # subscriptions에서 플랜 수집
    subs_res = sb.table("subscriptions").select("account_id,plan,status").execute()
    sub_map: dict[str, dict] = {
        s["account_id"]: s for s in (subs_res.data or [])
    }

    result = []
    for p in profiles:
        uid = p["id"]
        # 해당 계정의 활성 스케줄 (artifacts.metadata.schedule_enabled=true)
        sched_res = (
            sb.table("artifacts")
            .select("id,title,type,metadata")
            .eq("account_id", uid)
            .eq("kind", "artifact")
            .execute()
        )
        all_arts = sched_res.data or []
        active_schedules = [
            {
                "id": a["id"],
                "title": a["title"],
                "cron": a.get("metadata", {}).get("cron", ""),
                "schedule_enabled": True,
                "next_run": a.get("metadata", {}).get("next_run"),
            }
            for a in all_arts
            if a.get("metadata", {}).get("schedule_enabled")
        ]

        sub = sub_map.get(uid, {})
        result.append({
            "id": uid,
            "email": email_map.get(uid, ""),
            "display_name": p.get("display_name") or "",
            "business_name": p.get("business_name") or "",
            "plan": sub.get("plan", "free"),
            "subscription_status": sub.get("status", "active"),
            "last_seen_at": p.get("last_seen_at"),
            "created_at": p.get("created_at"),
            "active_schedule_count": len(active_schedules),
            "schedules": active_schedules,
        })

    return result
```

- [ ] **Step 4: 테스트 PASS 확인**

```bash
pytest tests/routers/test_admin.py -v
```

Expected: `4 passed`

- [ ] **Step 5: 커밋**

```bash
git add backend/app/routers/admin.py backend/tests/routers/test_admin.py
git commit -m "feat(admin): GET /api/admin/users 구현"
```

---

## Task 5: Backend — GET /api/admin/stats

**Files:**
- Modify: `backend/app/routers/admin.py`
- Modify: `backend/tests/routers/test_admin.py`

- [ ] **Step 1: 테스트 추가**

`test_admin.py` 끝에 추가:

```python
def test_stats_returns_counts(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": True
    }

    today = date.today().isoformat()

    def table_side_effect(name):
        m = MagicMock()
        if name == "profiles":
            # require_admin + total_users
            inner = MagicMock()
            inner.execute.return_value.data = {"is_admin": True}
            single_m = MagicMock()
            single_m.execute.return_value.data = {"is_admin": True}
            count_m = MagicMock()
            count_m.execute.return_value.count = 42
            m.select.return_value.eq.return_value.single.return_value = inner
            m.select.return_value.execute.return_value.count = 42
        elif name == "activity_logs":
            count_m = MagicMock()
            count_m.execute.return_value.count = 15
            m.select.return_value.gte.return_value = count_m
        elif name == "artifacts":
            count_m = MagicMock()
            count_m.execute.return_value.count = 10
            m.select.return_value.eq.return_value = count_m
        return m

    mock_sb.table.side_effect = table_side_effect
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    client = _make_app()
    resp = client.get("/api/admin/stats?account_id=admin-uid")
    assert resp.status_code == 200
    data = resp.json()
    assert "total_users" in data
    assert "dau_today" in data
    assert "active_schedules" in data
```

- [ ] **Step 2: 구현 — admin.py에 추가**

```python
@router.get("/stats")
async def get_stats(account_id: str = Query(...)):
    _require_admin(account_id)
    sb = get_supabase()
    today = date.today().isoformat()

    # 총 유저 수
    profiles_res = sb.table("profiles").select("id", count="exact").execute()
    total_users = profiles_res.count or 0

    # 오늘 DAU — activity_logs에서 오늘 생성된 고유 account_id 수
    logs_res = (
        sb.table("activity_logs")
        .select("account_id")
        .gte("created_at", f"{today}T00:00:00+00:00")
        .execute()
    )
    dau_today = len({r["account_id"] for r in (logs_res.data or [])})

    # 총 에이전트 실행 횟수 (activity_logs type=agent_run)
    agent_runs_res = (
        sb.table("activity_logs")
        .select("id", count="exact")
        .eq("type", "agent_run")
        .execute()
    )
    total_agent_runs = agent_runs_res.count or 0

    # 전체 활성 스케줄 수
    arts_res = sb.table("artifacts").select("metadata").execute()
    active_schedules = sum(
        1 for a in (arts_res.data or [])
        if (a.get("metadata") or {}).get("schedule_enabled")
    )

    return {
        "total_users": total_users,
        "dau_today": dau_today,
        "total_agent_runs": total_agent_runs,
        "active_schedules": active_schedules,
    }
```

- [ ] **Step 3: 테스트 PASS**

```bash
pytest tests/routers/test_admin.py -v
```

Expected: `5 passed`

- [ ] **Step 4: 커밋**

```bash
git add backend/app/routers/admin.py backend/tests/routers/test_admin.py
git commit -m "feat(admin): GET /api/admin/stats 구현"
```

---

## Task 6: Backend — GET /api/admin/costs (Langsmith)

**Files:**
- Modify: `backend/app/routers/admin.py`
- Modify: `backend/tests/routers/test_admin.py`

- [ ] **Step 1: 테스트 추가**

```python
def test_costs_returns_per_account(monkeypatch):
    # require_admin mock
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": True
    }
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    # Langsmith client mock
    mock_run = MagicMock()
    mock_run.inputs = {"account_id": "uid-1"}
    mock_run.total_tokens = 1000
    mock_run.prompt_tokens = 700
    mock_run.completion_tokens = 300
    mock_run.total_cost = 0.025

    mock_ls = MagicMock()
    mock_ls.list_runs.return_value = iter([mock_run])
    monkeypatch.setattr("app.routers.admin.langsmith.Client", lambda: mock_ls)

    client = _make_app()
    resp = client.get("/api/admin/costs?account_id=admin-uid&days=7")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert data[0]["account_id"] == "uid-1"
    assert data[0]["total_tokens"] == 1000
```

- [ ] **Step 2: 구현 — admin.py 상단 import에 추가 후 엔드포인트 작성**

`admin.py` 상단 import 블록에 추가:
```python
import langsmith
```

엔드포인트 추가:

```python
@router.get("/costs")
async def get_costs(account_id: str = Query(...), days: int = Query(30, ge=1, le=90)):
    _require_admin(account_id)

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    client = langsmith.Client()

    # orchestrator.run 트레이스만 집계 (최상위 span, inputs.account_id 포함)
    runs = client.list_runs(
        project_name="boss",
        run_type="chain",
        filter='eq(name, "orchestrator.run")',
        start_time=since,
    )

    aggregated: dict[str, dict] = {}
    for run in runs:
        uid = (run.inputs or {}).get("account_id")
        if not uid:
            continue
        if uid not in aggregated:
            aggregated[uid] = {
                "account_id": uid,
                "total_tokens": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_cost": 0.0,
                "run_count": 0,
            }
        agg = aggregated[uid]
        agg["total_tokens"] += run.total_tokens or 0
        agg["prompt_tokens"] += run.prompt_tokens or 0
        agg["completion_tokens"] += run.completion_tokens or 0
        agg["total_cost"] += float(run.total_cost or 0)
        agg["run_count"] += 1

    # 비용 내림차순 정렬
    result = sorted(aggregated.values(), key=lambda x: x["total_cost"], reverse=True)
    return result
```

- [ ] **Step 3: 테스트 PASS**

```bash
pytest tests/routers/test_admin.py -v
```

Expected: `6 passed`

- [ ] **Step 4: 커밋**

```bash
git add backend/app/routers/admin.py backend/tests/routers/test_admin.py
git commit -m "feat(admin): GET /api/admin/costs Langsmith 기반 구현"
```

---

## Task 7: Backend — GET /api/admin/payments + 라우터 마운트

**Files:**
- Modify: `backend/app/routers/admin.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/routers/test_admin.py`

- [ ] **Step 1: 테스트 추가**

```python
def test_payments_returns_plan_summary(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        "is_admin": True
    }

    def table_side_effect(name):
        m = MagicMock()
        if name == "profiles":
            inner = MagicMock()
            inner.execute.return_value.data = {"is_admin": True}
            m.select.return_value.eq.return_value.single.return_value = inner
        elif name == "subscriptions":
            m.select.return_value.execute.return_value.data = [
                {"account_id": "uid-1", "plan": "pro", "status": "active",
                 "next_billing_date": "2026-05-28"},
                {"account_id": "uid-2", "plan": "free", "status": "active",
                 "next_billing_date": None},
            ]
        return m

    mock_sb.table.side_effect = table_side_effect
    monkeypatch.setattr("app.routers.admin.get_supabase", lambda: mock_sb)

    client = _make_app()
    resp = client.get("/api/admin/payments?account_id=admin-uid")
    assert resp.status_code == 200
    data = resp.json()
    assert "summary" in data
    assert "rows" in data
```

- [ ] **Step 2: /api/admin/payments 구현**

`admin.py`에 추가:

```python
@router.get("/payments")
async def get_payments(account_id: str = Query(...)):
    _require_admin(account_id)
    sb = get_supabase()

    subs_res = sb.table("subscriptions").select(
        "account_id,plan,status,next_billing_date,started_at,cancelled_at"
    ).execute()
    rows = subs_res.data or []

    summary: dict[str, int] = {}
    for row in rows:
        plan = row.get("plan", "free")
        summary[plan] = summary.get(plan, 0) + 1

    return {"summary": summary, "rows": rows}
```

- [ ] **Step 3: main.py에 admin 라우터 마운트**

`backend/app/main.py`의 import 블록 끝에 추가:
```python
from app.routers import admin
```

`app.include_router(docx.router)` 줄 바로 아래에 추가:
```python
app.include_router(admin.router)
```

- [ ] **Step 4: 전체 테스트 PASS**

```bash
pytest tests/routers/test_admin.py -v
```

Expected: `7 passed`

- [ ] **Step 5: 서버 기동 확인**

```bash
uvicorn app.main:app --reload --port 8000
```

브라우저에서 `http://localhost:8000/docs` → `/api/admin/*` 엔드포인트 4개 확인.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/admin.py backend/app/main.py backend/tests/routers/test_admin.py
git commit -m "feat(admin): GET /api/admin/payments + 라우터 마운트"
```

---

## Task 8: Frontend — useIsAdmin hook

**Files:**
- Create: `frontend/hooks/useIsAdmin.ts`

- [ ] **Step 1: hooks 디렉토리 확인 및 파일 생성**

```bash
ls frontend/hooks 2>/dev/null || echo "no hooks dir yet"
```

`frontend/hooks/useIsAdmin.ts`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const useIsAdmin = (userId: string | null) => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const check = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId)
        .single();
      setIsAdmin(data?.is_admin === true);
      setLoading(false);
    };

    void check();
  }, [userId]);

  return { isAdmin, loading };
};
```

- [ ] **Step 2: 커밋**

```bash
git add frontend/hooks/useIsAdmin.ts
git commit -m "feat(admin): useIsAdmin hook 추가"
```

---

## Task 9: Frontend — AdminFab 컴포넌트

**Files:**
- Create: `frontend/components/layout/AdminFab.tsx`

- [ ] **Step 1: 컴포넌트 생성**

`frontend/components/layout/AdminFab.tsx`:

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat/ChatContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export const AdminFab = () => {
  const router = useRouter();
  const { userId } = useChat();
  const { isAdmin, loading } = useIsAdmin(userId);

  if (loading || !isAdmin) return null;

  return (
    <button
      onClick={() => router.push("/admin")}
      title="Admin 패널"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        width: "44px",
        height: "44px",
        borderRadius: "50%",
        background: "#2563eb",
        color: "white",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "18px",
        boxShadow: "0 4px 16px rgba(37,99,235,0.45)",
        zIndex: 9999,
        transition: "transform .15s, box-shadow .15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      ⚙
    </button>
  );
};
```

- [ ] **Step 2: Providers에 AdminFab 마운트**

`frontend/app/providers.tsx` 현재 내용:
```typescript
"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>
    <NodeDetailProvider>{children}</NodeDetailProvider>
  </ChatProvider>
);
```

수정 후:
```typescript
"use client";

import { NodeDetailProvider } from "@/components/detail/NodeDetailContext";
import { ChatProvider } from "@/components/chat/ChatContext";
import { AdminFab } from "@/components/layout/AdminFab";

export const Providers = ({ children }: { children: React.ReactNode }) => (
  <ChatProvider>
    <NodeDetailProvider>
      {children}
      <AdminFab />
    </NodeDetailProvider>
  </ChatProvider>
);
```

- [ ] **Step 3: dev 서버 기동 후 FAB 확인**

```bash
cd frontend && npm run dev
```

1. `http://localhost:3000/dashboard` 접속
2. is_admin=true 계정으로 로그인 → 우하단에 파란 ⚙ 버튼 확인
3. is_admin=false 계정 → 버튼 미표시 확인

- [ ] **Step 4: 커밋**

```bash
git add frontend/components/layout/AdminFab.tsx frontend/app/providers.tsx
git commit -m "feat(admin): AdminFab 컴포넌트 + Providers 마운트"
```

---

## Task 10: Frontend — Admin 페이지 (탭 스켈레톤 + stat 카드)

**Files:**
- Create: `frontend/app/admin/page.tsx`

- [ ] **Step 1: admin 디렉토리 생성 및 페이지 파일 작성**

`frontend/app/admin/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat/ChatContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";

type Tab = "users" | "payments" | "stats" | "costs";

export default function AdminPage() {
  const router = useRouter();
  const { userId } = useChat();
  const { isAdmin, loading } = useIsAdmin(userId);
  const [activeTab, setActiveTab] = useState<Tab>("users");

  const [stats, setStats] = useState<{
    total_users: number;
    dau_today: number;
    total_agent_runs: number;
    active_schedules: number;
  } | null>(null);

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [loading, isAdmin, router]);

  useEffect(() => {
    if (!userId || !isAdmin) return;
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/stats?account_id=${userId}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => null);
  }, [userId, isAdmin]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f2e9d5" }}>
        <span style={{ fontSize: 13, color: "#9a9287" }}>불러오는 중…</span>
      </div>
    );
  }

  if (!isAdmin) return null;

  const TABS: { key: Tab; label: string }[] = [
    { key: "users", label: "유저 목록" },
    { key: "payments", label: "구독 / 결제" },
    { key: "stats", label: "시스템 통계" },
    { key: "costs", label: "계정별 코스트" },
  ];

  return (
    <div style={{ background: "#f2e9d5", minHeight: "100vh", fontFamily: "var(--font-roboto), system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#1a1816", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#fffdf9", fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" }}>BOSS</span>
          <span style={{ background: "#2563eb", color: "white", fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 999, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Admin</span>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          style={{ color: "rgba(255,253,249,0.45)", fontSize: 12, background: "none", border: "none", cursor: "pointer" }}
        >
          ← 대시보드로 돌아가기
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
        {/* Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "총 유저", value: stats?.total_users ?? "—" },
            { label: "오늘 DAU", value: stats?.dau_today ?? "—" },
            { label: "에이전트 실행", value: stats?.total_agent_runs ?? "—" },
            { label: "활성 스케줄", value: stats?.active_schedules ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: "#9a9287", textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "monospace", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.03em" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e6e1d8", marginBottom: 20 }}>
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 500,
                color: activeTab === key ? "#1a1816" : "#9a9287",
                background: "none",
                border: "none",
                borderBottom: activeTab === key ? "2px solid #1a1816" : "2px solid transparent",
                marginBottom: -1,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === "users" && userId && <UsersTab accountId={userId} />}
        {activeTab === "payments" && userId && <PaymentsTab accountId={userId} />}
        {activeTab === "stats" && userId && <StatsTab accountId={userId} stats={stats} />}
        {activeTab === "costs" && userId && <CostsTab accountId={userId} />}
      </div>
    </div>
  );
}

// ── 탭 컴포넌트 (플레이스홀더 — Task 11~12에서 실제 구현으로 교체) ──────────────

const UsersTab = ({ accountId }: { accountId: string }) => (
  <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: 24, color: "#9a9287", fontSize: 13 }}>
    유저 목록 로딩 중…
  </div>
);

const PaymentsTab = ({ accountId }: { accountId: string }) => (
  <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: 24, color: "#9a9287", fontSize: 13 }}>
    구독/결제 로딩 중…
  </div>
);

const StatsTab = ({ accountId, stats }: { accountId: string; stats: any }) => (
  <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: 24, color: "#9a9287", fontSize: 13 }}>
    통계 로딩 중…
  </div>
);

const CostsTab = ({ accountId }: { accountId: string }) => (
  <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: 24, color: "#9a9287", fontSize: 13 }}>
    코스트 데이터 로딩 중…
  </div>
);
```

- [ ] **Step 2: 라우팅 확인**

```bash
# frontend dev 서버가 실행 중인 상태에서
open http://localhost:3000/admin
```

- is_admin=true 계정: 헤더 + stat 카드 + 탭 4개 렌더 확인
- is_admin=false 계정: `/dashboard`로 redirect 확인

- [ ] **Step 3: 커밋**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat(admin): admin 페이지 스켈레톤 (헤더 + stat 카드 + 탭)"
```

---

## Task 11: Frontend — UsersTab 구현 (스케줄 인라인 펼치기)

**Files:**
- Modify: `frontend/app/admin/page.tsx`

- [ ] **Step 1: UsersTab을 실제 구현으로 교체**

`page.tsx`의 `const UsersTab = ...` 플레이스홀더를 아래로 교체:

```typescript
type Schedule = {
  id: string;
  title: string;
  cron: string;
  schedule_enabled: boolean;
  next_run: string | null;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  business_name: string;
  plan: string;
  subscription_status: string;
  last_seen_at: string | null;
  created_at: string;
  active_schedule_count: number;
  schedules: Schedule[];
};

const UsersTab = ({ accountId }: { accountId: string }) => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/users?account_id=${accountId}`)
      .then((r) => r.json())
      .then((data) => { setUsers(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accountId]);

  const planBadge = (plan: string) => {
    const styles: Record<string, { background: string; color: string }> = {
      pro:      { background: "#dbeafe", color: "#1d4ed8" },
      business: { background: "#d1fae5", color: "#065f46" },
      free:     { background: "#f0ece4", color: "#6a6460" },
    };
    const s = styles[plan] ?? styles.free;
    return (
      <span style={{ ...s, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 999, display: "inline-block" }}>
        {plan}
      </span>
    );
  };

  if (loading) return <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>;

  return (
    <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #e6e1d8", fontSize: 13, fontWeight: 500 }}>
        전체 계정 ({users.length})
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#faf7f2", borderBottom: "1px solid #e6e1d8" }}>
            {["", "계정", "사업체명", "플랜", "활성 스케줄", "마지막 접속", "상태"].map((h) => (
              <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, color: "#9a9287", fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "monospace" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <>
              <tr
                key={u.id}
                onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                style={{ borderBottom: "1px solid #f0ece4", cursor: "pointer", background: expandedId === u.id ? "#f5f1ea" : undefined }}
              >
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287" }}>
                  {expandedId === u.id ? "▼" : "▶"}
                </td>
                <td style={{ padding: "11px 18px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{u.display_name || "—"}</div>
                  <div style={{ fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{u.email}</div>
                </td>
                <td style={{ padding: "11px 18px", fontSize: 12.5 }}>{u.business_name || "—"}</td>
                <td style={{ padding: "11px 18px" }}>{planBadge(u.plan)}</td>
                <td style={{ padding: "11px 18px" }}>
                  {u.active_schedule_count > 0 ? (
                    <span style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999 }}>
                      {u.active_schedule_count}개 활성
                    </span>
                  ) : (
                    <span style={{ background: "#f5f1ea", border: "1px solid #e6e1d8", color: "#9a9287", fontSize: 11, padding: "3px 9px", borderRadius: 999 }}>없음</span>
                  )}
                </td>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>
                  {u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString("ko-KR") : "—"}
                </td>
                <td style={{ padding: "11px 18px", fontSize: 12 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: u.last_seen_at ? "#22c55e" : "#d1d5db", display: "inline-block", marginRight: 6 }} />
                  {u.last_seen_at ? "활성" : "비활성"}
                </td>
              </tr>
              {expandedId === u.id && (
                <tr key={`${u.id}-detail`} style={{ background: "#f0ece4", borderBottom: "1px solid #e6e1d8" }}>
                  <td colSpan={7} style={{ padding: "14px 24px 14px 52px" }}>
                    {u.schedules.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#9a9287" }}>등록된 스케줄이 없습니다.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {u.schedules.map((s) => (
                          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #e6e1d8", borderRadius: 8, padding: "9px 14px" }}>
                            <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{s.title}</span>
                            <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "#9a9287" }}>{s.cron || "—"}</span>
                            <span style={{ background: "#dcfce7", color: "#15803d", fontSize: 10, padding: "2px 8px", borderRadius: 999 }}>실행 중</span>
                            <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "#9a9287" }}>
                              {s.next_run ? `다음: ${new Date(s.next_run).toLocaleString("ko-KR")}` : "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

- [ ] **Step 2: 브라우저에서 유저 목록 탭 확인**

`http://localhost:3000/admin` → 유저 목록 탭:
- 행 클릭 시 스케줄 상세 펼치기/접기 동작 확인
- 활성 스케줄 뱃지 표시 확인

- [ ] **Step 3: 커밋**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat(admin): UsersTab 구현 (스케줄 인라인 펼치기)"
```

---

## Task 12: Frontend — PaymentsTab + StatsTab + CostsTab 구현

**Files:**
- Modify: `frontend/app/admin/page.tsx`

- [ ] **Step 1: PaymentsTab 플레이스홀더 교체**

```typescript
const PaymentsTab = ({ accountId }: { accountId: string }) => {
  const [data, setData] = useState<{ summary: Record<string, number>; rows: any[] } | null>(null);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/payments?account_id=${accountId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => null);
  }, [accountId]);

  if (!data) return <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>;

  const planLabels: Record<string, string> = { pro: "Pro", business: "Business", free: "Free" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 12 }}>
        {Object.entries(data.summary).map(([plan, count]) => (
          <div key={plan} style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: "16px 20px", minWidth: 120 }}>
            <div style={{ fontSize: 10, color: "#9a9287", textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "monospace", marginBottom: 6 }}>{planLabels[plan] ?? plan}</div>
            <div style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.03em" }}>{count}</div>
          </div>
        ))}
      </div>
      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#faf7f2", borderBottom: "1px solid #e6e1d8" }}>
              {["계정 ID", "플랜", "상태", "다음 결제일", "시작일"].map((h) => (
                <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, color: "#9a9287", fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "monospace" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f0ece4" }}>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{row.account_id?.slice(0, 8)}…</td>
                <td style={{ padding: "11px 18px", fontSize: 12.5 }}>{row.plan}</td>
                <td style={{ padding: "11px 18px", fontSize: 12.5 }}>{row.status}</td>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{row.next_billing_date || "—"}</td>
                <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{row.started_at ? new Date(row.started_at).toLocaleDateString("ko-KR") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: StatsTab 플레이스홀더 교체**

```typescript
const StatsTab = ({ accountId, stats }: { accountId: string; stats: any }) => {
  if (!stats) return <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>;
  const items = [
    { label: "총 유저 수", value: stats.total_users },
    { label: "오늘 DAU", value: stats.dau_today },
    { label: "전체 에이전트 실행 횟수", value: stats.total_agent_runs },
    { label: "전체 활성 스케줄", value: stats.active_schedules },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
      {items.map(({ label, value }) => (
        <div key={label} style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, padding: "20px 24px" }}>
          <div style={{ fontSize: 10, color: "#9a9287", textTransform: "uppercase" as const, letterSpacing: "0.08em", fontFamily: "monospace", marginBottom: 10 }}>{label}</div>
          <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em" }}>{value ?? "—"}</div>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 3: CostsTab 플레이스홀더 교체**

```typescript
type CostRow = {
  account_id: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost: number;
  run_count: number;
};

const CostsTab = ({ accountId }: { accountId: string }) => {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const api = process.env.NEXT_PUBLIC_API_URL;
    fetch(`${api}/api/admin/costs?account_id=${accountId}&days=${days}`)
      .then((r) => r.json())
      .then((data) => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [accountId, days]);

  const maxCost = Math.max(...rows.map((r) => r.total_cost), 0.001);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: days === d ? 600 : 400,
              background: days === d ? "#1a1816" : "#fff",
              color: days === d ? "#fffdf9" : "#6a6460",
              border: "1px solid #e6e1d8",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {d}일
          </button>
        ))}
      </div>
      <div style={{ background: "#fff", border: "1px solid #e6e1d8", borderRadius: 10, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 24, color: "#9a9287", fontSize: 13 }}>불러오는 중…</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#faf7f2", borderBottom: "1px solid #e6e1d8" }}>
                {["계정 ID", "실행 수", "총 토큰", "입력 토큰", "출력 토큰", "예상 비용", "비중"].map((h) => (
                  <th key={h} style={{ padding: "10px 18px", textAlign: "left", fontSize: 10, color: "#9a9287", fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "monospace" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const pct = Math.round((row.total_cost / maxCost) * 100);
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #f0ece4" }}>
                    <td style={{ padding: "11px 18px", fontSize: 11, color: "#9a9287", fontFamily: "monospace" }}>{row.account_id.slice(0, 8)}…</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, fontFamily: "monospace" }}>{row.run_count}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, fontFamily: "monospace" }}>{row.total_tokens.toLocaleString()}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, color: "#9a9287", fontFamily: "monospace" }}>{row.prompt_tokens.toLocaleString()}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, color: "#9a9287", fontFamily: "monospace" }}>{row.completion_tokens.toLocaleString()}</td>
                    <td style={{ padding: "11px 18px", fontSize: 12, fontFamily: "monospace", color: row.total_cost > 10 ? "#dc2626" : "#1a1816", fontWeight: 500 }}>
                      ${row.total_cost.toFixed(3)}
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: "#f0ece4", borderRadius: 2, minWidth: 60 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "#2563eb", borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10.5, color: "#9a9287", fontFamily: "monospace" }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: 전체 탭 브라우저 확인**

`http://localhost:3000/admin` 에서:
- 유저 목록 탭: 행 클릭 → 스케줄 펼치기 동작
- 구독/결제 탭: 플랜별 카운트 카드 + 테이블
- 시스템 통계 탭: 4개 지표 카드
- 계정별 코스트 탭: 7일/30일/90일 필터 + 테이블 + 비중 바

- [ ] **Step 5: 커밋**

```bash
git add frontend/app/admin/page.tsx
git commit -m "feat(admin): PaymentsTab + StatsTab + CostsTab 구현"
```

---

## Task 13: 최종 확인 및 PR

**Files:**
- (git only)

- [ ] **Step 1: 전체 백엔드 테스트 통과 확인**

```bash
cd backend
pytest tests/routers/test_admin.py -v
```

Expected: `7 passed, 0 failed`

- [ ] **Step 2: 프론트 린트 통과 확인**

```bash
cd frontend
npm run lint
```

Expected: 에러 없음 (경고는 무시 가능)

- [ ] **Step 3: E2E 체크리스트**

1. is_admin=true 계정으로 로그인 → 우하단 파란 FAB ⚙ 확인
2. FAB 클릭 → `/admin` 진입
3. 상단 stat 카드 수치 확인
4. 유저 목록 탭 → 행 클릭 → 스케줄 목록 펼치기/접기
5. 구독/결제 탭 → 데이터 확인
6. 시스템 통계 탭 → 수치 확인
7. 계정별 코스트 탭 → 7일/30일/90일 필터 전환 확인
8. is_admin=false 계정으로 로그인 → FAB 미표시
9. is_admin=false로 `/admin` 직접 접근 → `/dashboard` 리다이렉트

- [ ] **Step 4: PR 생성**

```bash
git push origin feature-admin
gh pr create --base dev --title "feat: Admin 페이지 추가" --body "$(cat <<'EOF'
## Summary
- profiles.is_admin 컬럼 추가 (040_admin_flag.sql)
- /api/admin/* 엔드포인트 4개 구현 (users, stats, costs, payments)
- Langsmith 기반 계정별 LLM 코스트 집계 (inputs.account_id 활용)
- AdminFab 컴포넌트 전역 마운트 (is_admin=true 시만 렌더)
- /admin 페이지: 유저 목록(스케줄 인라인 펼치기) + 구독/결제 + 통계 + 코스트 탭

## Test plan
- [ ] 백엔드: pytest tests/routers/test_admin.py → 7 passed
- [ ] is_admin=true 계정 FAB 표시 확인
- [ ] is_admin=false 계정 FAB 미표시 + /admin 직접 접근 시 redirect 확인
- [ ] 4개 탭 데이터 로딩 확인
- [ ] 유저 목록 행 클릭 스케줄 펼치기 동작 확인
- [ ] 코스트 탭 기간 필터 (7/30/90일) 동작 확인
EOF
)"
```
