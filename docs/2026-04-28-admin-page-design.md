# Admin Page Design Spec

Date: 2026-04-28

## Overview

BOSS-2에 admin 전용 페이지를 추가한다. `profiles.is_admin = true`인 계정으로 로그인하면 우하단 FAB 버튼이 나타나고, 클릭 시 `/admin` 페이지로 진입한다. 유저 목록(스케줄 포함), 구독/결제 현황, 시스템 통계, 계정별 LLM 코스트 4개 탭을 제공한다.

## Admin 판별

- `profiles` 테이블에 `is_admin boolean DEFAULT false` 컬럼 추가 (마이그레이션)
- 기존 코드베이스에 `is_admin` 참조 없음 — 신규 추가
- 프론트: 로그인 후 Supabase client로 `profiles.is_admin` 조회 → `useIsAdmin` hook
- 백엔드: 모든 `/api/admin/*` 엔드포인트에서 JWT uid로 `profiles.is_admin` 재검증 → false면 403

## DB 마이그레이션

**파일**: `supabase/migrations/040_admin_flag.sql`

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
```

RLS 정책 추가 불필요 — 백엔드는 service_role key로 RLS 우회, 프론트는 자신의 row만 읽음 (기존 정책 적용).

## Backend

### 라우터: `backend/app/routers/admin.py`

공통 의존성 `require_admin(account_id)` — JWT에서 uid 추출 → `profiles.is_admin` 확인 → false면 HTTP 403.

| 엔드포인트                | 반환                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/users`    | 전체 계정 목록: email, display_name, business_name, plan, last_seen, created_at, 활성 스케줄 수 + 스케줄 목록                 |
| `GET /api/admin/stats`    | DAU (activity_logs), 총 메시지 수, 에이전트 실행 횟수, 전체 활성 스케줄 수                                                    |
| `GET /api/admin/costs`    | Langsmith API 호출 → `orchestrator.run` runs 집계, account_id별 total_tokens / prompt_tokens / completion_tokens / total_cost |
| `GET /api/admin/payments` | profiles의 plan 필드 기반 구독 현황 (plan 컬럼 미존재 시 "unknown" 반환, 향후 확장)                                           |

**Langsmith 코스트 집계 방법**: `orchestrator.run` 인풋에 `account_id`가 이미 포함되어 있음(확인 완료). `langsmith.Client().list_runs(project_name="boss", filter='eq(name, "orchestrator.run")')` 로 runs를 가져와 `inputs.account_id`로 그룹핑 후 토큰/비용 합산.

### `backend/app/main.py`

기존 라우터 마운트 순서 맨 뒤에 `admin` 라우터 추가.

## Frontend

### 파일 구조

```
frontend/
  hooks/
    useIsAdmin.ts              # Supabase로 profiles.is_admin 조회
  components/layout/
    AdminFab.tsx               # 우하단 고정 FAB (isAdmin=true일 때만 렌더)
  app/
    admin/
      page.tsx                 # Admin 메인 페이지 (탭 4개)
```

### `useIsAdmin` hook

- Supabase client로 `profiles` 테이블에서 `is_admin` 단일 컬럼 조회
- 반환: `{ isAdmin: boolean, loading: boolean }`
- userId가 없으면 `isAdmin: false`

### `AdminFab` 컴포넌트

- `useIsAdmin()` 호출 → `isAdmin=true`일 때만 렌더
- 위치: `position: fixed; bottom: 24px; right: 24px`
- 스타일: 지름 44px 원형, 파란색(#2563eb), ⚙ 아이콘, 블루 그림자
- 클릭 시 `/admin`으로 라우팅 (`useRouter().push('/admin')`)
- `frontend/app/providers.tsx`의 `Providers` 컴포넌트 내부에 마운트 (`"use client"` 필요, root layout은 서버 컴포넌트라 불가)

### `proxy.ts` 수정

`/admin` 경로를 PUBLIC_PATHS에서 제외하고, 로그인된 사용자의 `is_admin` 검증 추가. `is_admin=false`이면 `/dashboard`로 리다이렉트.

단, proxy에서 DB 조회는 비용이 있으므로 **클라이언트 사이드 가드**와 **백엔드 403**을 1차/2차 방어선으로 사용하고, proxy는 미인증 사용자만 막는 기존 역할 유지 (is_admin 검증은 page.tsx 레벨에서 수행).

### Admin 페이지 (`app/admin/page.tsx`)

- 진입 시 `useIsAdmin()` 재확인 → false면 `/dashboard` redirect
- 상단 Stat 카드 4개: 총 유저 / DAU / 오늘 LLM 비용 / 전체 활성 스케줄 수
- 탭 4개:
  - **유저 목록**: 이메일, 사업체명, 플랜 배지, 활성 스케줄 수, 마지막 접속, 상태. 행 클릭 시 해당 계정의 스케줄 목록 인라인 펼치기(cron, 상태, 다음 실행 시각)
  - **구독/결제**: plan별 카운트, 계정별 플랜 테이블
  - **시스템 통계**: DAU 트렌드, 메시지 수, 에이전트 실행 횟수
  - **계정별 코스트**: Langsmith 기반, total_tokens / 예상 비용 / 비중 바 차트, 기간 필터(7일/30일)

### 헤더

Admin 페이지는 기존 `<Header>` 미사용. 전용 심플 헤더: "BOSS + ADMIN 배지 + 대시보드로 돌아가기".

## 브랜치

`feature-admin` 브랜치에서 작업 → `dev`로 PR.

## 범위 밖 (이번 구현 제외)

- plan/구독 실제 결제 데이터 연동 (결제 테이블 미존재 — UI 뼈대만 구현)
- 관리자 권한 부여 UI (DB에서 직접 수정)
- 계정 강제 정지/삭제 기능
