# Supabase Migrations

BOSS-2의 DB 스키마는 `public` 스키마 하나로 통합되어 있으며, `auth.uid()` 기반 RLS로 계정별 격리됩니다.

## 실행 순서

Supabase SQL Editor 또는 Supabase MCP로 **순번대로** 실행:

```
migrations/
├── 001_extensions.sql         # pgcrypto / uuid-ossp / vector / pg_trgm
├── 002_schema.sql             # 11개 테이블 (profiles, artifacts, ...)
├── 003_indexes.sql            # 성능 인덱스 (ivfflat, GIN, btree)
├── 004_rls.sql                # Row Level Security 정책
└── 005_functions_triggers.sql # bootstrap_workspace, touch_chat_session, hybrid_search, memory_search
```

## Seed / Cleanup

Mock 데이터는 **프로덕션 스키마와 분리**해 `seed/` 폴더에 둡니다.
`test@test.com` (`20fe9518-243d-49b8-8115-f99984396bb6`) 계정에만 적용되며, 타이틀에 `[MOCK]` 프리픽스를 남깁니다.

```
seed/
├── seed_mock_data.sql     # DAG + cross-domain 시연용 mock 데이터 삽입
└── cleanup_mock_data.sql  # '[MOCK]%' 프리픽스 데이터 일괄 삭제
```

## 테이블 개요

| 테이블           | 역할                                                     |
| ---------------- | -------------------------------------------------------- |
| `profiles`       | auth.users 확장 (display_name)                           |
| `artifacts`      | 캔버스 DAG 노드 (anchor/domain/artifact/schedule/log)    |
| `artifact_edges` | DAG 엣지 (contains / derives_from / revises / ...)       |
| `embeddings`     | RAG 하이브리드 서치 대상 (vector 1024dim + FTS tsvector) |
| `memory_long`    | 계정별 장기 기억 (vector 1024dim)                        |
| `activity_logs`  | 활동이력 타임라인                                        |
| `schedules`      | Celery Beat 동적 스케쥴                                  |
| `task_logs`      | 스케쥴 실행 결과                                         |
| `evaluations`    | 생성물 피드백 (up/down)                                  |
| `chat_sessions`  | 대화 세션                                                |
| `chat_messages`  | 세션 내 메시지                                           |

`memory_short`는 DB가 아니라 Upstash Redis에 보관됩니다.

## 트리거

- `auth.users` insert → `bootstrap_workspace()` → anchor + 4개 도메인 허브 자동 생성
- `public.chat_messages` insert → `touch_chat_session()` → 세션 `updated_at` 갱신
