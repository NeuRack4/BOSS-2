# BOSS-2

![version](https://img.shields.io/badge/version-0.3.0-blue)

> AI 기반 소상공인 자율 운영 플랫폼. 오케스트레이터 챗봇 하나로 채용·마케팅·매출·서류를 자동 관리합니다.

## Overview

중앙 오케스트레이터 AI와 대화하면 채용 / 마케팅 / 매출 관리 노드가 자동으로 생성·실행됩니다.
생성된 모든 작업물에는 Celery 스케쥴러가 연결되어 켜두면 알아서 돌아갑니다.

```
[사용자 채팅]
      ↓
[Orchestrator Agent]  ← OpenAI API
      ↓ 라우팅
  ┌────┬────┬────┐
채용 마케팅 매출 서류
  │    │    │    │
생성물 + Celery Beat 스케쥴러
```

## Architecture

| 영역      | 기술                                           |
| --------- | ---------------------------------------------- |
| Frontend  | Next.js 16 (App Router), React Flow, Shadcn/ui |
| Backend   | FastAPI (Python 3.12)                          |
| Database  | Supabase (PostgreSQL + pgvector + Realtime)    |
| Scheduler | Celery + Redis / Upstash (Celery Beat)         |
| AI        | OpenAI API (GPT-4o), BAAI/bge-m3 (임베딩)      |
| RAG       | pgvector(1024dim) + BM25 하이브리드 서치 + RRF |
| Auth      | Supabase Auth (이메일 + 비밀번호)              |

## Key Features

- **자유 캔버스**: React Flow 기반 드래그 가능한 노드 뷰
- **오케스트레이터 채팅**: 대화만으로 모든 기능 제어
- **자율 스케쥴러**: 생성물마다 Celery Beat 태스크 연결
- **RAG + 하이브리드 서치**: pgvector 벡터 검색 + BM25 키워드 검색
- **계정별 장기 기억**: Supabase Auth 계정마다 독립 메모리 + context 압축
- **실시간 업데이트**: Supabase Realtime으로 캔버스 즉시 반영

## Project Structure

```
BOSS-2/
├── frontend/                    # Next.js App
│   ├── app/
│   │   ├── (auth)/login/        # 이메일+비밀번호 로그인
│   │   ├── dashboard/           # 메인 캔버스
│   │   └── api/chat/            # 스트리밍 프록시
│   ├── components/
│   │   ├── canvas/              # React Flow 노드들
│   │   ├── chat/                # 채팅 인터페이스
│   │   └── sidebar/             # 생성물 상세 패널
│   └── lib/
│       ├── supabase.ts
│       └── api.ts
│
├── backend/                     # FastAPI
│   ├── app/
│   │   ├── agents/              # Orchestrator + 도메인 Agents
│   │   ├── memory/              # 장기 기억 + context 압축
│   │   ├── rag/                 # 임베딩 + 하이브리드 서치
│   │   ├── scheduler/           # Celery 태스크
│   │   ├── routers/             # API 엔드포인트
│   │   └── models/              # Pydantic 스키마
│   ├── celeryconfig.py
│   └── requirements.txt
│
├── supabase/
│   ├── migrations/              # DB 스키마 (001~005, 순서대로 실행)
│   └── seed/                    # mock 데이터 + cleanup
│
├── .gitignore
├── .gitattributes
├── CHANGELOG.md
└── CLAUDE.md
```

## Getting Started

### 1. 환경 변수 설정

```bash
cp .env.example .env
# .env 파일에 값 입력
```

### 2. Supabase 설정

```bash
# supabase/migrations/ 파일을 Supabase MCP 또는 SQL Editor에서 순서대로 실행
#   001_extensions.sql        (pgcrypto, uuid-ossp, vector, pg_trgm)
#   002_schema.sql            (11개 테이블)
#   003_indexes.sql           (ivfflat, GIN, btree)
#   004_rls.sql               (Row Level Security)
#   005_functions_triggers.sql (bootstrap, hybrid_search, memory_search)
#
# (선택) mock 데이터 시드 / 제거
#   supabase/seed/seed_mock_data.sql
#   supabase/seed/cleanup_mock_data.sql
```

### 3. Backend 실행

```bash
cd backend
conda create -n boss2 python=3.12
conda activate boss2
uv pip install -r requirements.txt

# FastAPI
uvicorn app.main:app --reload --port 8000

# Celery Worker (별도 터미널)
celery -A app.scheduler.celery_app worker --loglevel=info

# Celery Beat (별도 터미널)
celery -A app.scheduler.celery_app beat --loglevel=info
```

### 4. Frontend 실행

```bash
cd frontend
npm install
npm run dev
```

## Available Slash Commands (Claude Code)

| 커맨드             | 설명                              |
| ------------------ | --------------------------------- |
| `/forge-agent`     | Agent 로직 개발/디버그            |
| `/forge-scheduler` | Celery 태스크 관리                |
| `/forge-rag`       | RAG 파이프라인 설정/디버그        |
| `/forge-schema`    | Supabase 스키마/마이그레이션 생성 |
| `/forge-memory`    | 계정별 장기 기억 관리             |
| `/forge-context`   | Context 압축 로직                 |

## Version

현재 버전: **0.3.0** — 자세한 변경 내역은 [CHANGELOG.md](./CHANGELOG.md) 참고.
