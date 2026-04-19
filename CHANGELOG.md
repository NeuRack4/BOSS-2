# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-04-19

### Added — Orchestrator 대규모 확장 (`backend/app/agents/orchestrator.py` +800 라인)

- **Multi-intent 분류** — `classify_intent` 가 단일 도메인 문자열이 아니라 **라벨 리스트**를 반환. 가능한 라벨: `recruitment | marketing | sales | documents | chitchat | refuse | planning`. 복수 도메인 요청은 쉼표로 연결(`recruitment,marketing`)되어 리스트로 파싱되고, `planning` / `refuse` 는 단독 라벨로만 허용.
- **크로스 도메인 합성** (`_synthesize_cross_domain`) — 2개 이상 도메인이 걸리면 각 에이전트를 순차 호출 → 각 응답의 ARTIFACT/CHOICES/SET_NICKNAME 블록을 전부 스트립 → "도메인별 헤더 없이 하나의 자연스러운 답"으로 GPT-4o 재합성. 저장된 아티팩트는 "캔버스에 올려뒀어요" 수준으로 축약.
- **CHOICES shortcut** (`_try_choices_shortcut`) — 도메인 에이전트가 `[CHOICES]` 객관식 질문을 던질 때 히스토리 + 장기기억으로 답을 자신있게 추정할 수 있는지 compress 모델로 판정. 추정 성공 시 에이전트를 guess 로 **재호출**해서 한 턴에 최종 응답까지 제공하고, _"대화 맥락으로 X 쪽이라고 판단해서 그대로 진행했어요"_ 노티스를 prefix 로 붙임.
- **Planning 모드** (`_handle_planning`) — "이번 주 할 일" 류 요청을 처리. `_extract_date_range` 로 기간 추출(실패 시 오늘±2일) → `_gather_plan_facts` 가 `activity_logs` + 기한 artifact(`start/end/due_date`) + 예정 schedule(`metadata.next_run`) 수집 → 4개 도메인 `suggest_today` 후보 첨부 → 일자별(`### MM-DD (요일)`)/도메인별 플랜 + 우선순위 1개 추천.
- **Refuse 처리** (`_refusal_message`) — 4개 도메인 밖 요청(코딩·날씨·일반 QA 등)은 "BOSS는 채용·마케팅·매출·서류만 담당합니다" 명시적 거절. 닉네임이 있으면 `{name} 사장님,` prefix.
- **닉네임 자동 학습** — `[SET_NICKNAME]` 블록 추출/저장/본문에서 제거. `profiles.display_name` 에 upsert. system 프롬프트에 주입되어 에이전트 응답에서 호칭이 자연스럽게 반복.
- **사업 프로필 자동 학습** — `[SET_PROFILE]` 블록으로 7개 core 필드(`business_type / business_name / business_stage / employees_count / location / channels / primary_goal`) + 자유 key/value(`profile_meta` jsonb, `sns_channels` 등) 저장. `business_stage` 는 `창업 준비 | 오픈 직전 | 영업 중 | 확장 중`, `channels` 는 `offline | online | both` 로 enum 검증.
- **로그인 브리핑** (`build_briefing`) — 직전 접속 이후 자동 실행·알림·실패·에이전트별 오늘 추천·장기기억 관련 조각을 **헤드라인 3줄 + `### 자리 비운 사이` / `### 최근 이어가기` / `### 오늘 추천`** 섹션으로 요약. 발사 조건: `last_seen_at` 없음 OR `(now - last_seen_at) ≥ 8h` OR 이전 접속 이후 `task_logs.failed ≥ 1`. 프로필 core 필드가 3개 미만이면 "프로필 보강 넛지"를 system 인스트럭션에 추가해 본문 마지막 질문에 **비어있는 필드 1개**만 자연스럽게 물어봄.
- **도메인 에이전트 `suggest_today()` export** — `recruitment / marketing / sales / documents` 각 모듈이 `_suggest.suggest_today_for_domain(account_id, domain)` 을 래핑해 export. 임박 마감 artifact + 오늘~내일 예정 schedule 기반.

### Added — Scheduler 실제 가동 (`backend/app/scheduler/`)

- **`celery_app.py`** — Upstash Redis TCP 엔드포인트(`rediss://`) 용 `_ensure_ssl_cert_reqs` 헬퍼로 SSL 쿼리 파라미터 자동 주입. Beat 기본 스케쥴 `scheduler-tick` 등록(기본 60s).
- **`tasks.tick`** — Beat 이 주기 호출하는 스캐너. `find_due_schedules` 로 실행 대상 fan-out(`run_schedule_artifact.delay`) + `find_date_notifications` 로 `activity_logs.schedule_notify` 레코드 생성.
- **`tasks.run_schedule_artifact(id)`** — 단일 schedule 실행. `status=running` 전이 → `orchestrator.run_scheduled` → 결과에 따라 `status/metadata.executed_at/metadata.next_run`(cron 기반) 갱신 + `task_logs` + `activity_logs.schedule_run` + **`kind='log'` artifact 노드** 를 캔버스에 자동 추가(`artifact_edges.relation='logged_from'`).
- **`scanner.py`** — `find_due_schedules(now)` / `find_date_notifications(today)`. 후자는 `start_date == today` / `due_date ∈ {today, today+1}` 을 잡고 `(artifact_id, notify_kind, for_date)` 중복 방지.
- **`log_nodes.create_log_node`** — 스케쥴러 runtime 과 수동 `run_now` 엔드포인트가 공유하는 log 노드 생성 헬퍼.
- `POST /api/schedules/{id}/run` 의 수동 실행 경로도 성공/실패 모두 log 노드 + `task_logs` 를 기록하도록 통합 (`backend/app/routers/schedules.py`).

### Added — 로그인 브리핑 파이프라인

- **`backend/app/routers/auth.py`** — `POST /api/auth/session/touch {account_id}` 엔드포인트. `profiles.last_seen_at` 을 읽어 브리핑 조건 판정 → `orchestrator.build_briefing` 호출 → 마지막으로 `last_seen_at` 을 now 로 갱신.
- **`frontend/app/(auth)/login/page.tsx`** — `signInWithPassword` 성공 직후 `/api/auth/session/touch` 호출. `briefing.should_fire && briefing.message` 가 있으면 `sessionStorage.boss2:pending-briefing` 에 저장 후 대시보드로 라우팅.
- **`frontend/components/chat/BriefingLoader.tsx`** — `/dashboard` 마운트 시 sessionStorage 의 pending briefing 을 꺼내 `openChatWithBriefing(content)` 호출 → 채팅창이 열리며 첫 assistant 메시지가 브리핑으로 교체.
- **`ChatContext`** 에 `pendingBriefing` / `openChatWithBriefing` / `consumeBriefing` 추가. `ChatOverlay` 가 새 세션을 열 때 pendingBriefing 이 있으면 GREETING 대신 그것을 초기 메시지로 사용.

### Added — Database

- **`supabase/migrations/008_expand_activity_log_types.sql`** — `activity_logs.type` CHECK 에 `schedule_run` / `schedule_notify` 추가.
- **`supabase/migrations/009_profile_last_seen.sql`** — `profiles.last_seen_at timestamptz`.
- **`supabase/migrations/010_profile_expansion.sql`** — `profiles` 에 `business_type / business_name / business_stage / employees_count / location / channels / primary_goal` 7개 core 필드 + `profile_meta jsonb default '{}'` 추가.

### Added — Config / Pydantic

- `Settings.celery_broker_url` / `celery_result_backend` / `scheduler_tick_seconds`. `.env.example` 에 `CELERY_BROKER_URL=rediss://…@upstash:6379/0` 샘플.
- `SessionTouchRequest` / `SessionTouchResponse` 스키마.

### Changed

- **도메인 에이전트 system 프롬프트** — 4개 에이전트 모두 `CLARIFY_RULE + NICKNAME_RULE + PROFILE_RULE` 을 append. 응답마다 닉네임·프로필 블록을 자동 삽입할 수 있는 규약 공유.
- **`FlowCanvas` 의 `boss:focus-node` 포커스** — 기존 `fitView({ nodes: [{id}] })` → `setCenter(x+w/2, y+h/2, { zoom: 1.4, duration: 600 })`. 타겟이 현재 렌더에 없으면(아카이브 자식이면서 `showArchive=false`) `setShowArchive(true)` 후 최대 8회 재시도.
- **`FlowCanvas` 의 자동 아카이브 edge 생성** — overflow 자식을 아카이브 노드로 이동시킬 때 `artifact_edges.account_id` 까지 명시적으로 넣어 RLS insert 정책 충족.
- **`NodeContextMenu`** — 바깥 클릭 감지를 `mousedown` → `pointerdown`(capture) 로 변경, 캔버스 팬/줌(wheel) 발생 시에도 메뉴 자동 닫힘.
- **Header 검색바** — flex 중앙 정렬 → `absolute left-1/2 -translate-x-1/2` 로 전환. 로고·버튼 폭과 무관하게 진짜 뷰포트 중앙 고정.

### Chore

- `.gitignore` — `celerybeat-schedule.*` 런타임 산출물 패턴 추가.

## [0.5.0] - 2026-04-19

### Added

- **전역 검색 팔레트** (`components/search/SearchPalette.tsx`) — `⌘K` / `Ctrl+K` 오픈. 제목·본문·메모·metadata를 대상으로 백엔드 `hybrid_search`(pgvector + FTS + RRF) 호출. 결과 클릭 시 `boss:focus-node` CustomEvent → `FlowCanvas`가 해당 노드로 `fitView`. 200ms debounce, ↑↓/Enter 키보드 탐색, memo 매치는 별도 아이콘/배지.
- **Header 중앙 검색바** — 항상 보이는 검색 트리거(`⌘K` 힌트 포함). 로고는 `boss-logo.svg` → `boss-logo.png` 로 교체.
- **노드 상세 모달** (`components/canvas/modals/NodeDetailModal.tsx`) — 노드 클릭 시 hover → 모달로 동작 변경. 좌측: content / sub-domain / metadata / parents·children / ID. 우측: **타임라인 메모** (생성·편집·삭제, 작성 즉시 임베딩되어 검색·대화 컨텍스트에 반영).
- **Memo 서브시스템**
  - DB `public.memos` (artifact_id FK + account_id RLS, `updated_at` 트리거).
  - Backend `app/routers/memos.py` — `GET/POST/PATCH/DELETE /api/memos`. 생성·편집 시 `upsert_embedding` RPC로 `source_type='memo'` 자동 인덱싱. 삭제 시 연관 embedding 제거.
  - `embeddings.source_type` CHECK 에 `memo` 포함.
- **Backend `/api/search`** (`app/routers/search.py`) — 하이브리드 검색 결과를 memo→artifact 매핑/중복 제거 후 `{artifact_id, kind, type, title, domains, status, match, snippet, score}` 로 정규화. anchor 제외.
- **임베딩 범위 확장** — `embeddings.source_type` 에 `schedule` / `log` / `hub` 추가 (`006_expand_embeddings_source_type.sql`). `upsert_embedding(account_id, source_type, source_id, content, embedding)` RPC 신설 — runtime `index_artifact` + 백필 스크립트가 공용으로 사용. `source_id` 유니크 인덱스로 upsert 안전.
- **`backend/scripts/backfill_embeddings.py`** — `--force` / `--account-id` 옵션 지원. 기존 artifact/schedule/log/hub 를 BATCH=32로 일괄 임베딩. title + content + (cron/start/end/due/type) 메타를 합쳐 1문자열로 인덱싱.
- **Hover Inspector 최소화 토글** — `HoverInfoPanel` 에 최소화 버튼 추가, 상태는 `localStorage` (`boss2:hover-panel:minimized`) 에 저장.
- **Activity / Schedule → 캔버스 점프** — `ActivityModal` 항목 / `ScheduleManagerModal` 리스트·달력 항목 클릭 시 `boss:focus-node` 이벤트 발행으로 해당 노드로 이동. Activity 라우트는 `activity_logs.metadata.artifact_id` 기록 후 조회 (fallback: title+domain 매칭).
- **에이전트 artifact 저장 시 activity_logs.metadata.artifact_id 기록** — 4개 도메인 agent(recruitment/marketing/sales/documents) 공통 적용.
- **Branch Policy 명시** — `dev` 를 default branch 로 문서화 (README · CLAUDE.md).

### Changed

- **캔버스 스케일 업** — Anchor 872×176 → 980×198, DomainNode 266×64 → 310×76, ArtifactChip 218×44 → 260×52 (schedule 260×82). 허브 오프셋 215 → 260. 기본 폰트·아이콘 사이즈도 1~2pt 상향.
- **Radial 레이아웃** — `HORIZONTAL_BIAS=0.5` 도입으로 outward 각도를 수평축 쪽으로 당김 → 캔버스가 상하보다 좌우로 더 퍼짐.
- **노드 클릭 동작** — 기존 "zoom-focus on low zoom" → **항상 NodeDetailModal 오픈** (anchor 제외). Hover 패널은 그대로 유지.
- **Edge 초기 불투명도 0** — `FlowCanvas` 가 edge opacity 를 전부 0으로 렌더 후, hover/selected 인터랙션 레이어에서 반투명 복원 (시각적 노이즈 감소).
- **`backend/app/main.py`** 에 `memos` / `search` 라우터 등록.

### Fixed

- minZoom 0.2 → 0.3 — 과도한 축소로 노드가 판독 불가해지는 현상 개선.
- `brandmark` / 로고 자산 정리: `boss-logo.svg` · `icon.svg` 제거, PNG 기반 (`boss-logo.png`, `app/icon.png`, 갱신된 `favicon.ico`, `apple-icon.png`) 로 통일.

## [0.4.0] - 2026-04-19

### Changed

- **UI 전면 재디자인 — Sand/Paper 테마**: dark zinc palette를 warm sand 톤으로 교체 (`#f2e9d5` 배경 / `#fbf6eb` 카드 / `#2e2719` 본문). domain chart 컬러도 sand 계열로 통일.
- 폰트 스택을 `Pretendard Variable` + `JetBrains Mono` 로 전환 (한글 가독성 우선).
- **Header 리디자인**: "BOSS v0.1.0" 텍스트를 로고 이미지(`/boss-logo.svg`)로 교체. 버튼을 `정렬` / `일정 관리` / `활동이력` / 로그아웃 4종으로 재구성.
- 활동이력을 별도 `/activity` 페이지 → `ActivityModal` 모달로 이관 (페이지 전환 없이 캔버스 위에서 확인).
- `FlowCanvas` 대규모 리팩터 (+526 / -172) — hover info 분리, 일정 관리 연동, reset-layout 이벤트, 드래그 좌표 유지 로직 개선.

### Added

- **`ScheduleManagerModal`** (`components/layout/`) — 달력 뷰 + 리스트 뷰 토글. `kind='schedule'` ∪ (`metadata`에 `start_date`/`end_date`/`due_date`가 있는 `kind='artifact'`)를 통합 조회. 월 단위 내비게이션, 지연/진행 중/예정/일시정지 배지.
- **`DateRangeModal`** (`components/canvas/modals/`) — artifact에 기간(`start_date`+`end_date`) 또는 마감일(`due_date`) metadata 설정. 기간 모드 ↔ 마감일 모드 토글.
- **`HoverInfoPanel`** (`components/canvas/`) — 노드 호버 시 부모/자식 관계, metadata, 도메인·상태를 우측 패널에 표시.
- **`NebulaBackground`** (`components/canvas/`) — 캔버스 배경에 radial gradient + paper-grain overlay 레이어.
- **브랜드 자산**: `public/boss-logo.svg`, `app/apple-icon.png`, `app/icon.svg`.
- Mock 시드에 **기간/마감 artifact 8종** 추가 — 바리스타 2차 면접(`due_date`), 주말 알바 공고 게시 기간, 5월 신메뉴 캠페인, 여름 오픈 4주년 이벤트, 망고 라떼 프로모션, 임대차 계약 갱신, 1분기 부가세 신고, 3월 카드 매출 증빙(지연).
- Header `정렬` 버튼 → `boss:reset-layout` CustomEvent 발행 → `localStorage`에 저장된 노드 좌표 초기화.

### Fixed

- 드래그 가능한 노드만 좌표를 저장하도록 `layout.ts` 가드 정리.

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
