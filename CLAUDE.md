# CLAUDE.md — BOSS-2

## Project Overview

소상공인 자율 운영 AI 플랫폼. 오케스트레이터 챗봇이 채용/마케팅/매출/서류 도메인 에이전트를 라우팅하고, Celery Beat 스케쥴러로 자동 실행한다.

## Git / Branch Policy

- **default branch: `dev`** — 모든 feature 브랜치는 반드시 `dev` 를 base 로 PR 한다. `main` 은 릴리스 스냅샷 전용.
- 버전 bump PR 타이틀은 `chore: vX.Y.Z — …`, 기능은 `feat: …`, 수정은 `fix: …` 관례.

## Tech Stack

- **Frontend**: Next.js 16 App Router, React Flow, Shadcn/ui, Tailwind CSS
- **Backend**: FastAPI (Python 3.12)
- **DB**: Supabase (PostgreSQL + pgvector + Realtime) — public 스키마 사용
- **Scheduler**: Celery + Upstash Redis (Celery Beat)
- **AI**: OpenAI API (GPT-4o chat/compress), BAAI/bge-m3 (로컬 임베딩, 1024dim)
- **Auth**: Supabase Auth (이메일 + 비밀번호)

## Architecture Rules

### Agent 구조

- `orchestrator.py` — 의도 분류 + 도메인 라우팅만 담당. 비즈니스 로직 없음
- `recruitment.py` / `marketing.py` / `sales.py` / `documents.py` — 각 도메인 독립 에이전트
- 에이전트 간 직접 호출 금지. 반드시 orchestrator를 통해 라우팅
- 하나의 artifact가 여러 도메인에 속할 수 있음 (크로스 도메인) — `domains TEXT[]` 배열로 표현

### Memory 구조

- 계정 = Supabase Auth `auth.uid()` (이메일+비밀번호 로그인)
- 계정마다 독립적인 `short_term` (Upstash Redis) + `long_term` (Supabase pgvector) 메모리
- 대화 턴이 20을 넘으면 자동 context 압축 (GPT-4o-mini로 요약)
- 장기 기억은 RAG 하이브리드 서치로 recall

### RAG / 하이브리드 서치

- 벡터 검색: pgvector (BAAI/bge-m3, 1024dim) — `app/core/embedder.py`
- 키워드 검색: PostgreSQL Full-Text Search (BM25 근사)
- 최종 결과: RRF(Reciprocal Rank Fusion)로 병합 — DB 함수 `public.hybrid_search`
- 임베딩 대상: artifacts(kind=artifact/schedule/log/domain-hub), memos, 장기 기억, 업로드 문서
- 공용 upsert: `public.upsert_embedding(account_id, source_type, source_id, content, embedding)` — runtime `index_artifact` / 메모 CRUD / `scripts/backfill_embeddings.py` 모두 이 RPC 사용. `source_id` 유니크 인덱스로 upsert 안전.
- `source_type` 허용값: `recruitment | marketing | sales | documents | memory | document | schedule | log | hub | memo` (006 · 007 마이그레이션으로 확장).

### Scheduler 구조

- 모든 artifact는 생성 시 `schedule` 필드를 가짐 (cron 표현식)
- Celery Beat이 Supabase `schedules` 테이블을 주기적으로 읽어 동적 등록
- 태스크 실행 결과는 `task_logs` 테이블에 저장

### Realtime

- Supabase Realtime으로 `artifacts` 테이블 변경 구독
- 프론트엔드 캔버스에서 INSERT 이벤트 → 서브노드 자동 추가

## Database Tables (public schema)

```
profiles              — auth.users 확장, display_name
artifacts             — account_id(auth.uid), domains text[] (recruitment|marketing|sales|documents),
                        kind(anchor|domain|artifact|schedule|log), type, title, content, status,
                        metadata(jsonb: pinned, position, cron, ...), created_at
artifact_edges        — parent_id, child_id, relation(contains|derives_from|scheduled_by|revises|logged_from)
evaluations           — artifact_id, account_id, rating(up|down), feedback
embeddings            — account_id, source_type, source_id, embedding(vector 1024), fts, content
                        (source_type 확장: schedule | log | hub | memo — 006/007 마이그레이션 기준)
memory_short          — account_id, messages(jsonb), turn_count
memory_long           — account_id, content, embedding(vector 1024), importance
activity_logs         — account_id, type, domain, title, description, metadata(jsonb: artifact_id 포함)
schedules             — account_id, artifact_id, domain, cron_expr, is_active, last_run, next_run
task_logs             — schedule_id, account_id, status, result, error, executed_at
memos                 — account_id, artifact_id(FK→artifacts), content, created_at, updated_at
                        (artifact별 타임라인 메모. CRUD 시 embeddings 에 source_type='memo' 자동 upsert)
```

- `artifacts`는 캔버스의 모든 노드를 하나의 테이블로 통합한 DAG 구조.
- `kind === "anchor"`는 계정당 1개, 4개 도메인 허브의 부모.
- `kind === "domain"`은 도메인 허브 계층:
  - **메인 허브** — `type` 필드 없음/기본값. 4개 (recruitment/marketing/sales/documents).
  - **서브 허브** — `type = 'category'`. 메인 허브당 4~5개 카테고리 (예: Job Postings, Interviews, Social, Ads, Reports, Contracts 등).
- `kind === "artifact"` + `type === 'archive'` — 아카이브 폴더 노드. 자식 artifact들을 묶는 컨테이너. 타이틀에 개수 표시 (예: "📦 과거 Ads (3개)").
- 크로스 도메인 artifact는 `domains`에 여러 값 저장 (예: `['recruitment','documents']`). 30 × 2-dom / 10 × 3-dom / 2 × 4-dom 분포로 mock 시드.

### Metadata 규약 (jsonb)

`artifacts.metadata`는 스키마 없는 jsonb지만 다음 키들은 표준으로 합의된 공용 필드다. 새 키를 도입할 땐 여기에 먼저 등록한다.

| key              | 타입                    | 대상 kind         | 의미                                                |
| ---------------- | ----------------------- | ----------------- | --------------------------------------------------- |
| `pinned`         | boolean                 | 전체              | 캔버스 위치 고정 (사용자 드래그 좌표 유지)          |
| `position`       | {x,y}                   | 전체              | pinned=true일 때 저장된 좌표                        |
| `is_archive`     | boolean                 | artifact          | 아카이브 폴더 노드 여부 (`type='archive'`와 페어링) |
| `count`          | number                  | artifact(archive) | 아카이브가 포함한 자식 수                           |
| `cron`           | string                  | schedule          | cron 표현식 (5필드)                                 |
| `next_run`       | ISO dt                  | schedule          | 다음 실행 예정 (UTC)                                |
| `executed_at`    | ISO dt                  | log               | 실행 완료 시각                                      |
| **`start_date`** | ISO date (`YYYY-MM-DD`) | artifact          | **기간성 artifact의 시작일** (선택)                 |
| **`end_date`**   | ISO date (`YYYY-MM-DD`) | artifact          | **기간성 artifact의 종료일** (선택)                 |
| **`due_date`**   | ISO date (`YYYY-MM-DD`) | artifact          | **마감일** (`end_date`와 양자택일, 선택)            |

- 일회성 기간(캠페인/계약/면접/프로모션)은 `start_date`+`end_date` 혹은 `due_date`로 표현. 반복은 `cron`.
- 일정 관리 모달은 `kind='schedule'` ∪ (`metadata`에 `start_date|end_date|due_date` 중 하나 이상 있는 `kind='artifact'`)를 대상으로 한다.
- "종료" 판정: `status ∈ {paused, archived}` 또는 (schedule의 `next_run` < now) 또는 (artifact의 `end_date`/`due_date` < today).

모든 RLS 정책은 `auth.uid()` 기반. Supabase Auth 이메일+비밀번호 사용.

## Canvas Layout (frontend)

### 4-Quadrant 구조

- Anchor `(0,0)` 중앙 고정 (BOSS, 120×40). 4 메인 허브는 `(±215, ±215)`에 **등거리 배치**, `kind='domain'`은 전부 **드래그 불가**.
- 사분면 매핑: **TL=Recruitment, TR=Marketing, BL=Documents, BR=Sales**.
- 각 허브의 subtree는 **해당 사분면 바깥 방향으로만 전개** (TL은 좌상, TR은 우상, BL은 좌하, BR은 우하):
  - `frontend/components/canvas/FlowCanvas.tsx`의 `layoutSubtree`: dagre로 subtree 배치 후, hub는 target 고정, 자식들만 `OUTWARD_GAP` 이상 바깥으로 Y-shift (상단 허브면 위로, 하단이면 아래로).
  - dagre rankdir: 좌측 사분면 `'RL'`, 우측 사분면 `'LR'` — 가로 방향 자연스러운 바깥 전개.
- Anchor → 메인 허브 `contains` 엣지는 구조상 존재하지만 **렌더하지 않음** (긴 중심선 방지).
- 중앙 얇은 회색 십자선(`CrosshairOverlay`) + anchor 작게 중앙 유지.

### 노드 모양

- 모든 artifact chip: 180×36 수평 pill (`rounded-[11px]`).
- **Schedule**: 180×58, 칩 내부에 2행 — 1행 메타, 2행 **상태 배지**(대기/실행 중/일시정지/지연 color-coded). 2행 클릭 시 pause↔active 토글 / 지연 상태에서 run-now 컨펌.
- **Archive** (`type='archive'`): 동일 pill + `border-dashed`.
- Anchor/Domain hub/Sub-hub: 별도 컴포넌트 (`AnchorNode`, `DomainNode`).

### 엣지 라우팅

- 핸들 4개/노드: `l`(target), `l-s`(source), `r`(source), `r-t`(target). `ConnectionMode.Loose`.
- 좌측 사분면(Recruitment, Documents) source → `sourceHandle='l-s'`, `targetHandle='r-t'` (왼쪽으로 뻗음).
- 우측 사분면 → `sourceHandle='r'`, `targetHandle='l'`.
- Hover 인터랙션: 기본 가시, 노드 호버 시 비관련 엣지 opacity 0.08로 어두워짐.

### 필터 시스템

`frontend/components/canvas/FilterContext.tsx` + `frontend/components/chat/CanvasFilterBar.tsx`(채팅창 아래 3행 패널):

| 필터              | 상태          | 기본값    | 동작                                                                                               |
| ----------------- | ------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `timeRangeDays`   | `null\|1..7`  | `7`       | 범위 밖 노드 opacity 0.15. 도메인 허브/아카이브 노드 **면제**.                                     |
| `selectedDomains` | `Set<Domain>` | 전체 선택 | 노드의 `domains` 중 하나라도 선택 시 visible. 모두 해제 → Anchor만 선명.                           |
| `showArchive`     | `boolean`     | `false`   | OFF면 아카이브 노드 자식들을 **렌더에서 제외** (dagre 재레이아웃). 아카이브 폴더 자체는 항상 표시. |

### 위치 저장

- `frontend/components/canvas/layout.ts` — localStorage 키 `boss2:node_positions:quadrant-v1`.
- 사용자가 드래그 가능한 노드(artifact/schedule/log)를 드래그하면 즉시 저장. 새로고침/재진입 시 복원.
- Anchor, 메인 허브, 서브 허브는 드래그 불가 → 항상 dagre 결과 유지.
- Header의 `정렬` 버튼은 `boss:reset-layout` CustomEvent를 발행 → `FlowCanvas`가 수신하여 localStorage 비우고 dagre 기준으로 재배치.

### 테마 / 배경

- **Sand/Paper 팔레트** (v0.4.0~): `--background:#f2e9d5` / `--card:#fbf6eb` / `--foreground:#2e2719`. domain chart 컬러 5종도 sand 계열(#c47865 / #d89a2b / #7f8f54 / #8e5572 / #8c7e66).
- 폰트: `Pretendard Variable` (본문) + `JetBrains Mono` (코드).
- `NebulaBackground` (`components/canvas/NebulaBackground.tsx`) — radial gradient + paper-grain overlay 레이어. 캔버스 하단 고정 배경.

### UI Layer (캔버스 바깥)

- **`HoverInfoPanel`** (`components/canvas/`) — 노드 호버/선택 시 상단-좌측 패널에 부모/자식(`artifact_edges` 기반), metadata, 도메인·상태 표시. 최소화 토글 상태는 `localStorage` 키 `boss2:hover-panel:minimized` 에 저장.
- **`NodeDetailModal`** (`components/canvas/modals/`) — 노드 클릭 시 오픈 (anchor 제외). 좌측: content / sub-domain / metadata / parents·children / ID. 우측: **타임라인 메모** (작성·편집·삭제, 작성 즉시 `source_type='memo'` 로 임베딩 → 검색/대화 컨텍스트 합류).
- **`SearchPalette`** (`components/search/`) — `⌘K` / `Ctrl+K` 로 오픈. Header 중앙 검색바 클릭으로도 호출. 200ms debounce 후 `GET /api/search` 호출, RRF 점수 순 결과. ↑↓/Enter 키보드 탐색, 선택 시 `boss:focus-node` CustomEvent 발행 → `FlowCanvas` 가 `fitView` 로 포커스.
- **`ScheduleManagerModal`** (`components/layout/`) — Header `일정 관리` 버튼에서 오픈. 달력 뷰 ↔ 리스트 뷰 토글. `kind='schedule'` ∪ (`metadata.start_date`/`end_date`/`due_date` 중 하나 이상 있는 `kind='artifact'`) 통합 조회. 항목 클릭 시 `boss:focus-node` 발행.
- **`DateRangeModal`** (`components/canvas/modals/`) — artifact의 `start_date`+`end_date`(기간) ↔ `due_date`(마감) metadata 설정. 컨텍스트 메뉴에서 호출.
- **`ActivityModal`** (`components/layout/`) — `/activity` 페이지 대체. Header `활동이력` 버튼에서 오픈. 항목 클릭 시 `metadata.artifact_id`(없으면 title+domain fallback)로 노드 포커스.

### Custom Events (frontend 전역)

| 이벤트              | 발행 위치                                                  | 구독 위치    | 페이로드         |
| ------------------- | ---------------------------------------------------------- | ------------ | ---------------- |
| `boss:reset-layout` | Header `정렬` 버튼                                         | `FlowCanvas` | —                |
| `boss:focus-node`   | `SearchPalette` / `ActivityModal` / `ScheduleManagerModal` | `FlowCanvas` | `{ id: string }` |

## Mock Data

- `test@test.com` (`auth.uid = 20fe9518-243d-49b8-8115-f99984396bb6`) 계정에 ~200 노드 시드.
- 구성: 1 anchor + 4 메인 허브 + 17 서브허브 + ~155 artifact (기간/마감 메타 8종 포함) + 17 archive + 7 schedule + 5 log.
- 허브 기준 최대 **6대손** (revision 체인 `derives_from` 10개 × 4세대).
- 시간 분포: 0~1일 ~ 21일+까지 10개 버킷에 고르게 분산 (시간 슬라이더 테스트용).
- 모든 타이틀 `[MOCK]` 프리픽스. 삭제 스크립트: `supabase/migrations/cleanup_mock_data.sql`.

## Code Conventions

- 모든 함수는 arrow function (frontend) / async def (backend)
- Pydantic v2 사용 (BaseModel, field_validator)
- API 응답은 항상 `{ data, error, meta }` 구조
- 에러는 FastAPI HTTPException으로 통일
- 환경변수는 `backend/app/core/config.py`의 Settings 클래스로 관리
- 임베딩은 반드시 `backend/app/core/embedder.py`를 통해서만 (BAAI/bge-m3, sync)
- OpenAI API 호출은 반드시 `backend/app/core/llm.py`를 통해서만 (chat/compress 전용)

## Dev Workflow

1. DB 스키마 변경 → `supabase/migrations/` 에 SQL 파일 추가 → Supabase MCP로 실행
2. Mock 데이터는 `supabase/seed/` 에서 관리 (`seed_mock_data.sql` / `cleanup_mock_data.sql`)
3. Backend 먼저 개발 → Frontend 연동
4. 새 도메인 Agent 추가 시 → orchestrator의 intent 분류 프롬프트도 업데이트

### Migration File Layout (v0.5.0 기준)

```
supabase/
├── migrations/
│   ├── 001_extensions.sql                       # pgcrypto, uuid-ossp, vector, pg_trgm
│   ├── 002_schema.sql                           # 11개 테이블 (public 스키마)
│   ├── 003_indexes.sql                          # ivfflat + GIN + btree
│   ├── 004_rls.sql                              # Row Level Security
│   ├── 005_functions_triggers.sql               # bootstrap_workspace, hybrid_search, memory_search
│   ├── 006_expand_embeddings_source_type.sql    # schedule/log/hub source_type + upsert_embedding RPC + source_id uniq
│   └── 007_memos.sql                            # memos 테이블 + RLS + 'memo' source_type + updated_at 트리거
└── seed/
    ├── seed_mock_data.sql           # test@test.com 용 mock 시드
    └── cleanup_mock_data.sql        # '[MOCK]%' 일괄 제거
```

### 임베딩 백필

- 마이그레이션 006 적용 후, 기존 artifact/schedule/log/hub 에 임베딩을 채우려면:
  ```
  cd backend
  python scripts/backfill_embeddings.py                  # 미인덱싱 행만
  python scripts/backfill_embeddings.py --force          # 전체 재인덱싱
  python scripts/backfill_embeddings.py --account-id <UUID>
  ```
- 신규 artifact/memo 는 runtime 에서 자동 인덱싱되므로 백필은 1회성.

## Available Slash Commands

| 커맨드             | 용도                        |
| ------------------ | --------------------------- |
| `/forge-agent`     | Agent 로직 개발/디버그      |
| `/forge-scheduler` | Celery 태스크 추가/수정     |
| `/forge-rag`       | RAG 파이프라인 개발         |
| `/forge-schema`    | DB 마이그레이션 생성        |
| `/forge-memory`    | 메모리/context 압축 로직    |
| `/forge-context`   | Context 구조 분석 및 최적화 |

## Important Constraints

- 인증은 Supabase Auth만 사용 — 커스텀 auth 로직 추가 금지
- Supabase 쿼리는 public 스키마 직접 사용 — `.schema()` 호출 금지
- Supabase RLS(Row Level Security) 반드시 활성화 — 모든 쿼리는 auth.uid() 기반
