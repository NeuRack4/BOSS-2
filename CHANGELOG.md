# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-19

### Changed

- **Supabase 마이그레이션 전면 재작성**: 기존 `001_initial_schema` ~ `007_chat_sessions` 7개 파일을 실제 DB 상태(11개 테이블, RLS 정책, 트리거) 기준으로 5개 파일로 squash.
  - `001_extensions.sql` — pgcrypto / uuid-ossp / vector / pg_trgm
  - `002_schema.sql` — 11개 테이블 (profiles, artifacts, artifact_edges, embeddings, memory_long, activity_logs, schedules, task_logs, evaluations, chat_sessions, chat_messages)
  - `003_indexes.sql` — ivfflat(1024dim) + GIN(fts, domains[]) + btree
  - `004_rls.sql` — 모든 테이블 `auth.uid()` 기반 Row Level Security
  - `005_functions_triggers.sql` — `bootstrap_workspace`, `touch_chat_session`, `hybrid_search`, `memory_search` + 트리거 바인딩
- Mock 데이터 시드/클린업을 `supabase/migrations/` → `supabase/seed/` 로 분리.
- `schedules.artifact_id` 에 FK(ON DELETE CASCADE) 추가 — mock cleanup 시 누락 가능성 제거.

### Added

- `supabase/README.md` — 마이그레이션 실행 순서, 테이블 개요, 트리거 설명.
- `supabase/seed/cleanup_mock_data.sql` — `[MOCK]%` 프리픽스 + 연관 embeddings/schedules 명시적 삭제.
- 루트 `.gitignore` — Node / Next / Python / FastAPI / HuggingFace cache / Celery / IDE / OS 통합.
- 루트 `.gitattributes` — LF 통일, Windows 스크립트만 CRLF, 바이너리 자산 명시.
- `backend/pyproject.toml` — 버전/메타 표기 (의존성은 `requirements.txt` 유지).
- README 에 버전 배지 + 버전 섹션 추가.

### Fixed

- 기존 마이그레이션의 legacy `boss2` 스키마 잔재 정리 — 모든 테이블/함수가 `public` 스키마로 통일됨이 문서에 명시.

## [0.2.0] - 2026-04-18

### Changed

- 임베딩 모델을 OpenAI `text-embedding-3-small` (1536dim) → `BAAI/bge-m3` (1024dim) 로 교체
- DB `embeddings`, `memory_long` 컬럼을 `vector(1536)` → `vector(1024)` 로 변경
- Supabase `boss2` 커스텀 스키마 → `public` 스키마로 통합
- `memory_search`, `hybrid_search` DB 함수 vector 타입 업데이트
- `app/core/embedder.py` 신규 생성 (BGEM3FlagModel 래퍼, sync)
- `app/core/llm.py` 에서 `embed_text` 제거 — embedder.py 로 분리

### Added

- `FlagEmbedding`, `torch` 의존성 추가

## [0.1.0] - 2026-04-18

### Added

- 프로젝트 초기 설정
- **Frontend**: Next.js 16 App Router, React Flow 캔버스
  - 로그인/회원가입 (Supabase Auth)
  - OrchestratorNode (채팅 내장, 420×520px 고정)
  - DomainNode 3종 (채용/마케팅/매출) — 클릭 시 내부 확장
  - Header (BOSS v0.1.0, 활동이력, 로그아웃, 테마 토글)
  - 활동이력 페이지 (시간순 로그)
  - Dark/Light 테마 토글
- **Backend**: FastAPI (Python 3.12)
  - Orchestrator + 도메인 Agents (recruitment, marketing, sales)
  - 단기 메모리 (Upstash Redis)
  - 장기 메모리 (Supabase pgvector) + 20턴 context 압축
  - RAG 하이브리드 서치 (pgvector + BM25 + RRF)
  - `/api/chat`, `/api/activity` 엔드포인트
- **Database**: Supabase public 스키마 11개 테이블 + RLS
- `proxy.ts` 인증 가드 (Next.js 16)
- `CLAUDE.md`, `README.md`, `CHANGELOG.md` 문서화
