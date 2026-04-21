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

- `orchestrator.py` — 의도 분류 + 도메인 라우팅 + **복수 도메인 합성** + **plan 모드** + **로그인 브리핑** + **닉네임/프로필 추출** + **Capability (function-calling) 라우팅 v0.9**. 비즈니스 로직 없음
- `_capability.py` (v0.9.0~) — 각 도메인의 `describe(account_id)` 를 모아 OpenAI `tools` 스펙 + handler dispatch map 조립. `V2_DOMAINS = ("recruitment", "documents", "marketing")` — sales 는 팀원 기능 구현 완료 후 합류 예정. `_dispatch_via_tools` 가 single/multi domain 분기에서 V2 도메인만 섞인 경우 우선 시도 → 실패 시 legacy `_call_domain_with_shortcut` 자동 폴백. `parallel_tool_calls=True` 로 cross-domain 요청 병렬 처리 후 `_synthesize_cross_domain` 합성.
- `recruitment.py` / `marketing.py` / `sales.py` / `documents.py` — 각 도메인 독립 에이전트. 각 모듈은 `suggest_today(account_id)` 를 export (`_suggest.suggest_today_for_domain` 래핑). V2 도메인(recruitment/documents/marketing)은 `describe(account_id)` + capability 별 `run_*` 핸들러 export (legacy `run()` 도 유지 — 폴백).
- `recruitment.py` (v0.9.0~) — type 매트릭스(`job_posting | job_posting_set | job_posting_poster | interview_questions | checklist | guide | hiring_drive`). 3종 플랫폼 공고 동시 작성 (`[JOB_POSTINGS]` 마커 → 부모 `job_posting_set` + 자식 `job_posting × 3` + metadata.platform). HTML 포스터 생성 (`[POSTING_POSTER_REQUEST]` 마커 → `core.poster_gen.generate_job_posting_poster` → GPT-4o standalone HTML → Supabase Storage `recruitment-posters` 버킷 + `artifacts.content` 이중 저장). 업종별 CHOICES 분기는 `_recruit_templates.detect_category(business_type)` 로 `profiles.business_type` → cafe/restaurant/retail/beauty/academy/default 매핑. 인건비 계산은 `_recruit_calc.py` (2026 최저임금 10,320원 + 주휴수당 + 4대보험 의무). `_recruit_knowledge/` 에 직종·플랫폼별 가이드 markdown 이 system 프롬프트에 자동 주입.
- `documents.py` (v0.7.0~) — type 매트릭스(`contract | estimate | proposal | notice | checklist | guide`) + 계약서 subtype 7종(`labor | lease | service | supply | partnership | franchise | nda`) 으로 분기. 서브타입별 스켈레톤/법령·관행 조항은 `_doc_templates.py` 가 주입하고 원본 markdown 은 `_doc_knowledge/<subtype>/{acceptable,risks}.md` 에 위치. 저장 시 `metadata.contract_subtype` + `due_label` 을 동반.
- `documents.py` (v0.8.0~ 공정성 분석) — 최근 60분 이내 업로드된 `uploaded_doc` artifact 를 자동 감지 → 역할 CHOICES(갑/을/미지정) → `[REVIEW_REQUEST]` 마커 출력 → `_doc_review.dispatch_review` 가 analysis artifact + `analyzed_from` 엣지 생성 + gap/eul/risk_clauses 메타 저장 → 응답 끝에 `[[REVIEW_JSON]]` 구조화 페이로드 (프론트 `ReviewResultCard` 렌더용).
- `documents.py` (v0.9.0~ Legal 서브브랜치) — `run()` 최상단에서 `_legal.classify_legal_intent` (gpt-4o-mini) 로 "일반 법률 자문" 질문 여부 판정. 단 (a) 휴리스틱상 서류 작성 의도(`detect_doc_intent`) 없고 (b) 최근 업로드 문서 컨텍스트 없을 때만 분기. legal 이면 `_legal.handle_legal_question` 으로 위임 → `search_legal_knowledge` RPC 로 다분야 법령 조문 recall (topic 필터 1차 → 필터 없이 2차 보강) → GPT-4o 조언 생성 → `type='legal_advice'` artifact 를 **Documents > Legal 서브허브** 아래 저장 + 매 응답 끝에 면책 고지 자동 첨부.
- `_legal.py` — Legal 핸들러. `classify_legal_intent` + `_retrieve_legal_context` + `_generate_advice` + `_save_legal_advice`. RAG: `search_legal_knowledge` RPC (018·019 마이그레이션). 지식베이스는 별도 테이블 `legal_knowledge_chunks` — 소상공인이 마주하는 다분야 법령(노동·임대차·공정거래·개인정보·세법·상법·가맹·전자상거래·식품위생·소상공인 등) 16종을 `backend/scripts/ingest_legal_knowledge.py` 로 법제처 API 기반 수집. `DISCLAIMER` 상수가 면책 문구 통일.
- `_doc_review.py` — `analyze(content, user_role, doc_type, contract_subtype) → ReviewResult` + `dispatch_review(...)` (라우터/에이전트 공용 저장 헬퍼). RAG: `search_{law,pattern,acceptable}_contract_knowledge` RPC 3-way. **분석 artifact 는 업로드 원본 문서와 `analyzed_from` 엣지만 생성 — 서브허브 `contains` 엣지는 의도적으로 만들지 않는다** (v0.8.x 부터).
- `_suggest.py` — 도메인 공용 `suggest_today_for_domain(account_id, domain)` 헬퍼. 마감/시작 임박 artifact + 오늘~내일 예정 schedule 을 섞어 최대 3개 반환.
- `_feedback.py` — 도메인 에이전트 system 프롬프트에 주입되는 과거 down-vote 피드백 컨텍스트.
- 에이전트 간 직접 호출 금지. 반드시 orchestrator를 통해 라우팅
- 하나의 artifact가 여러 도메인에 속할 수 있음 (크로스 도메인) — `domains TEXT[]` 배열로 표현

### Orchestrator 동작 (v0.6.0~)

`classify_intent(message, history)` 는 **라벨 리스트**를 돌려준다. 가능한 라벨:

- `recruitment` / `marketing` / `sales` / `documents` — 도메인 (복수 가능)
- `chitchat` — 인사·호칭 설정·BOSS 사용법·감사 인사
- `refuse` — 4개 도메인과 무관한 요청 (코딩·날씨·일반 상식 QA 등) — 명시적 거절 메시지 1줄
- `planning` — 기간 단위 플랜/정리 요청. 단독으로만 존재.

분기 (`orchestrator.run`):

1. `["refuse"]` → `_refusal_message(account_id)` (BOSS 범위 안내 + 닉네임 있으면 호칭).
2. `["planning"]` → `_handle_planning` — 메시지에서 기간 추출(기본 오늘±2일), `activity_logs` + 기한 artifact + 예정 schedule 수집 → 4개 도메인 `suggest_today` 후보 첨부 → GPT-4o 로 일자별/도메인별 플랜 생성.
3. 도메인 1개:
   - V2 도메인(recruitment/documents/marketing) → `_dispatch_via_tools` 로 OpenAI function-calling 경로. tool_calls 있으면 해당 capability handler 실행, 없으면 LLM 의 자연어 되묻기 반환.
   - 실패·sales 도메인 → legacy `_call_domain_with_shortcut` 으로 폴백 (에이전트 1회 호출 후 `[CHOICES]` 있으면 히스토리/장기기억으로 답 추정 → guess 재호출 → 한 턴에 결과).
4. 도메인 2개 이상:
   - 전부 V2 도메인 → `_dispatch_via_tools` (parallel_tool_calls) 한 번에 다수 capability 호출 후 합성.
   - 그 외 → 각 도메인을 shortcut 경로로 호출 → `[CHOICES]` 가 남아 있으면 섹션별 pass-through, 아니면 `_synthesize_cross_domain` 으로 재합성. ARTIFACT/CHOICES/SET_NICKNAME 마커는 합성 단계에서 반드시 제거.
5. `chitchat` (또는 빈 라벨) → `SYSTEM_PROMPT` + 닉네임/프로필 컨텍스트로 직접 응답.

**CHOICES sticky routing (v0.9)** — classifier 가 짧은 후속 답변(예: "시급 12000", "이걸로 이미지") 을 chitchat/refuse 로 오분류하지 않도록:

- `_last_assistant_unresolved_choices` — 직전 assistant 메시지에 살아있는 `[CHOICES]` 감지 → classifier 에 sticky 힌트 주입 + history window 4→8 확장.
- `_last_assistant_did_domain_action` — "저장되었어요 / 캔버스에 / artifact:" 같은 도메인 액션 흔적 감지.
- `_has_context_reference` — "이걸로 / 방금 거 / 이 공고" 등 맥락 지시어 감지.
- 결과가 `chitchat` + 미해결 CHOICES 이거나, `refuse` + (미해결 CHOICES 또는 최근 도메인 액션 + 맥락 지시어) 이면 `_guess_domain_from_recent` 키워드 매칭으로 도메인 복구. 로그: `[classify] sticky override chitchat→X` / `refuse→X`.
- classifier 프롬프트: 이미지/포스터/썸네일/배너 생성 요청은 refuse 가 아니라 recruitment/marketing 로 분류.

### Nickname + Profile 자동 학습

- 응답에 **인라인 블록** 삽입/해제 규약 (에이전트와 오케스트레이터 공용):
  - `[SET_NICKNAME]닉네임[/SET_NICKNAME]` — 호칭 저장 (`profiles.display_name`).
  - `[SET_PROFILE]` … 한 줄당 `key: value` … `[/SET_PROFILE]` — 사업 프로필 저장.
- Core key 허용: `business_type | business_name | business_stage(창업 준비|오픈 직전|영업 중|확장 중) | employees_count(0|1-3|4-9|10+) | location | channels(offline|online|both) | primary_goal`.
- `sns_channels: 인스타,틱톡` 같은 쉼표 값은 `profile_meta.sns_channels` 리스트로 저장. 그 외 자유 key/value 도 `profile_meta` 에 머지.
- 응답 파이프라인은 **항상** `_extract_and_save_nickname` → `_extract_and_save_profile` 을 거쳐 블록을 뜯어내고 본문에선 제거. 누락 시 UI 에 마커가 노출됨.
- system 프롬프트 주입: `_nickname_context` + `_profile_context` 는 모든 도메인 에이전트 system 컨텍스트 끝에 append (`NICKNAME_RULE`, `PROFILE_RULE` 상수 공유).

### 로그인 브리핑

- 프론트가 로그인 성공 직후 `POST /api/auth/session/touch {account_id}` 호출 (`app/routers/auth.py`).
- 백엔드가 `profiles.last_seen_at` 을 읽어 **이전 접속 시각**을 확보 → `orchestrator.build_briefing(account_id, last_seen_at)` 실행 → 마지막으로 `last_seen_at` 을 now 로 갱신.
- 발사 조건(`_briefing_should_fire`): `last_seen_at` 이 없거나 (now - last_seen_at ≥ 8h) 또는 이전 접속 이후 `task_logs.status='failed'` ≥ 1건.
- 본문 구성: 헤드라인 3줄 + `---` + `### 자리 비운 사이` / `### 최근 이어가기` / `### 오늘 추천` + 마지막에 사용자에게 거는 질문 1개.
- `_aggregate_activity` 가 `activity_logs` + `task_logs` 를 타입/도메인별 카운트로 집계, `_top_domains_last_week` 로 상위 1~2 도메인의 최근 제목을 쿼리로 만들어 `hybrid_search` 1회로 장기기억 recall.
- 프로필 core 필드가 3개 미만이면 **프로필 넛지** 인스트럭션 추가 — 본문 마지막 질문에 비어있는 필드 중 하나만 자연스럽게 물어보도록 강제.
- 응답(`{should_fire, message, meta}`)을 프론트가 받아 `sessionStorage.boss2:pending-briefing` 에 저장 → `/dashboard` 진입 시 `BriefingLoader` 가 꺼내 `openChatWithBriefing(content)` 호출 → 채팅창이 열리면서 첫 assistant 메시지가 브리핑으로 교체.

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

### Scheduler 구조 (`backend/app/scheduler/`)

- `celery_app.py` — Celery app 팩토리. `CELERY_BROKER_URL=rediss://…@upstash:6379/0` 에 `ssl_cert_reqs=CERT_REQUIRED` 를 자동 주입(`_ensure_ssl_cert_reqs`). Beat 기본 스케쥴로 `scheduler-tick` 하나를 `SCHEDULER_TICK_SECONDS`(기본 60s) 간격으로 등록.
- `tasks.tick` — Beat 이 60s 마다 호출하는 스캐너. `scanner.find_due_schedules` → per-item `run_schedule_artifact.delay(id)` fan-out. `scanner.find_date_notifications` → tick 안에서 바로 `activity_logs.schedule_notify` insert (중복은 `(artifact_id, notify_kind, for_date)` 로 방지).
- `tasks.run_schedule_artifact(id)` — 단일 schedule 실행. `artifacts.status = running` 전이 → `orchestrator.run_scheduled(artifact, account_id)` → 결과 반영(`status=active`, `metadata.executed_at`, `metadata.next_run = croniter.get_next`) + `task_logs` 성공/실패 insert + `activity_logs.schedule_run` insert + `log_nodes.create_log_node` 로 `kind='log'` artifact 노드를 캔버스에 추가(`artifact_edges.relation='logged_from'`).
- `scanner.find_due_schedules(now)` — `kind='schedule' AND status='active' AND metadata.next_run <= now`.
- `scanner.find_date_notifications(today)` — 일회성 artifact 의 `start_date`/`due_date`(= `end_date` fallback) 를 **D-7 / D-3 / D-1 / D-0** 오프셋으로 스캔. notify_kind 규약: `start` · `start_d1` · `start_d3` · `due_d0` · `due_d1` · `due_d3` · `due_d7`. 오늘자 `activity_logs.schedule_notify` 로그가 이미 있는 `(artifact_id, notify_kind, for_date)` 는 필터. 알림 메시지는 `metadata.due_label` ("납품기한"/"계약 만료" 등) 을 본문에 주입.
- `log_nodes.create_log_node(sb, schedule_artifact, status, content, executed_at)` — `kind='log'` 노드 insert + `artifact_edges(parent=schedule, child=log, relation='logged_from')`. `schedules` 라우터의 수동 `run_now` 경로도 이 함수를 공유.
- 태스크 실행 결과는 항상 `artifacts`(status/metadata) + `task_logs` + `activity_logs` + `kind='log'` 노드 **4곳에 동시 기록**.

### Realtime

- Supabase Realtime으로 `artifacts` 테이블 변경 구독
- 프론트엔드 캔버스에서 INSERT 이벤트 → 서브노드 자동 추가

## Database Tables (public schema)

```
profiles              — auth.users 확장, display_name (닉네임), last_seen_at (로그인 브리핑 트리거),
                        business_type / business_name / business_stage / employees_count / location /
                        channels / primary_goal (core 7개) + profile_meta(jsonb, sns_channels 등 자유 필드)
artifacts             — account_id(auth.uid), domains text[] (recruitment|marketing|sales|documents),
                        kind(anchor|domain|artifact|schedule|log), type, title, content, status,
                        metadata(jsonb: pinned, position, cron, ...), created_at
artifact_edges        — parent_id, child_id, relation(contains|derives_from|scheduled_by|revises|logged_from|analyzed_from)
evaluations           — artifact_id, account_id, rating(up|down), feedback
embeddings            — account_id, source_type, source_id, embedding(vector 1024), fts, content
                        (source_type 확장: schedule | log | hub | memo — 006/007 마이그레이션 기준)
memory_short          — account_id, messages(jsonb), turn_count
memory_long           — account_id, content, embedding(vector 1024), importance
activity_logs         — account_id, type, domain, title, description, metadata(jsonb: artifact_id 포함)
                        type 허용값: artifact_created | agent_run | schedule_run | schedule_notify
                        (008 마이그레이션으로 schedule_run / schedule_notify 추가)
schedules             — account_id, artifact_id, domain, cron_expr, is_active, last_run, next_run
task_logs             — schedule_id, account_id, status, result, error, executed_at
memos                 — account_id, artifact_id(FK→artifacts), content, created_at, updated_at
                        (artifact별 타임라인 메모. CRUD 시 embeddings 에 source_type='memo' 자동 upsert)
```

- `artifacts`는 캔버스의 모든 노드를 하나의 테이블로 통합한 DAG 구조.
- `kind === "anchor"`는 계정당 1개, 4개 도메인 허브의 부모.
- `kind === "domain"`은 도메인 허브 계층:
  - **메인 허브** — `type` 필드 없음/기본값. 4개 (recruitment/marketing/sales/documents).
  - **서브 허브** — `type = 'category'`. **모든 계정 공통 17개 표준 세트**(`014_standard_sub_hubs` 마이그레이션이 `bootstrap_workspace` 트리거 + backfill 로 보장):
    - Recruitment: `Job_posting` · `Interviews` · `Onboarding` · `Evaluations`
    - Documents: `Contracts` · `Tax&HR` · `Legal` · `Operations`
    - Sales: `Reports` · `Customers` · `Pricing` · `Costs`
    - Marketing: `Social` · `Blog` · `Campaigns` · `Events` · `Reviews`
    - 헬퍼 `public.ensure_standard_sub_hubs(account_id)` 는 idempotent — 동일 (domain, title) 이 있으면 skip.
- `kind === "artifact"` + `type === 'archive'` — 아카이브 폴더 노드. 자식 artifact들을 묶는 컨테이너. 타이틀에 개수 표시 (예: "📦 과거 Ads (3개)").
- 크로스 도메인 artifact는 `domains`에 여러 값 저장 (예: `['recruitment','documents']`). 30 × 2-dom / 10 × 3-dom / 2 × 4-dom 분포로 mock 시드.

### Metadata 규약 (jsonb)

`artifacts.metadata`는 스키마 없는 jsonb지만 다음 키들은 표준으로 합의된 공용 필드다. 새 키를 도입할 땐 여기에 먼저 등록한다.

| key                    | 타입                    | 대상 kind                   | 의미                                                                                                                   |
| ---------------------- | ----------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- | ------- | ------ | ----------- | --------- | ------------------------------ |
| `pinned`               | boolean                 | 전체                        | 캔버스 위치 고정 (사용자 드래그 좌표 유지)                                                                             |
| `position`             | {x,y}                   | 전체                        | pinned=true일 때 저장된 좌표                                                                                           |
| `is_archive`           | boolean                 | artifact                    | 아카이브 폴더 노드 여부 (`type='archive'`와 페어링)                                                                    |
| `count`                | number                  | artifact(archive)           | 아카이브가 포함한 자식 수                                                                                              |
| `cron`                 | string                  | schedule                    | cron 표현식 (5필드)                                                                                                    |
| `next_run`             | ISO dt                  | schedule                    | 다음 실행 예정 (UTC)                                                                                                   |
| `executed_at`          | ISO dt                  | log                         | 실행 완료 시각                                                                                                         |
| **`start_date`**       | ISO date (`YYYY-MM-DD`) | artifact                    | **기간성 artifact의 시작일** (선택)                                                                                    |
| **`end_date`**         | ISO date (`YYYY-MM-DD`) | artifact                    | **기간성 artifact의 종료일** (선택)                                                                                    |
| **`due_date`**         | ISO date (`YYYY-MM-DD`) | artifact                    | **마감일** (`end_date`와 양자택일, 선택)                                                                               |
| **`due_label`**        | string                  | artifact                    | due_date의 의미 라벨 (예: "계약 만료", "납품기한", "견적 유효기간", "공지 게시일"). 스케쥴러 D-N 알림 문구 생성에 사용 |
| **`contract_subtype`** | enum                    | artifact(`type='contract'`) | `labor                                                                                                                 | lease | service | supply | partnership | franchise | nda` — documents 에이전트 전용 |

- 일회성 기간(캠페인/계약/면접/프로모션)은 `start_date`+`end_date` 혹은 `due_date`로 표현. 반복은 `cron`.
- 일정 관리 모달은 `kind='schedule'` ∪ (`metadata`에 `start_date|end_date|due_date` 중 하나 이상 있는 `kind='artifact'`)를 대상으로 한다.
- "종료" 판정: `status ∈ {paused, archived}` 또는 (schedule의 `next_run` < now) 또는 (artifact의 `end_date`/`due_date` < today).

모든 RLS 정책은 `auth.uid()` 기반. Supabase Auth 이메일+비밀번호 사용.

## Dashboard Layout (frontend, v1.0.0~)

> v1.0.0 에서 `/dashboard` 는 React Flow 캔버스가 아닌 **Bento Grid** 로 전환됐고 `/canvas-legacy` route 는 삭제. 아래 섹션은 새 대시보드 구조 + 도메인별 Kanban 페이지 (`/[domain]`) 구조를 다룬다. 캔버스 컴포넌트(`FlowCanvas`, `AnchorNode` 등)는 아직 소스에 남아있지만 현재 라우트에서 렌더되지 않는다.

### Bento Grid (`/dashboard`, `BentoGrid.tsx`)

- **Root**: `flex w-full justify-center gap-4 p-4` — 왼쪽에 `ProfileMemorySidebar` (조건부, `min-[1500px]:flex`), 가운데에 12-컬럼 그리드 (`max-w-[1400px]`), `md:auto-rows-[140px]`.
- **Layout map** (12-col × 6-row):
  - Row 1-4: `ChatCenterCard` (col 1-6) · `DomainCard(recruitment)` + `DomainCard(sales)` (col 7-9, flex 4:6) · `DomainCard(marketing)` + `DomainCard(documents)` (col 10-12, flex 6:4).
  - Row 5-6: `PreviousChatCard` (col 1-3) · `ScheduleCard` (col 4-6) · `ActivityCard` (col 7-12).
- **데이터 소스**: `GET /api/dashboard/summary?account_id=` (`backend/app/routers/dashboard.py`) — 도메인별 `active_count` / `upcoming_count` / `recent_count` + `recent_titles[5]` + `upcoming[8]` + `recent_activity[10]`. `boss:artifacts-changed` CustomEvent 로 재조회.

### Dashboard Cards (공통 디자인 규약)

- 모든 카드는 **`rounded-[5px]`** + `shadow-lg` + `hover:scale-[1.015] hover:shadow-xl` + `role="button" tabIndex={0}` (전체 카드 클릭 시 모달 열기). 우상단 `ArrowUpRight` 는 헬퍼 아이콘 (시각적 표시).
- **세션/Activity/Schedule 아이템** 은 내부 `<button>` 으로 렌더되며 `stopPropagation()` 로 아이템 전용 액션(세션 로드 / 모달 포커스)과 카드 전체 클릭을 분리.
- **빈 상태 문구** 전역 `Nothing here yet` 하나로 통일 (카드/모달/팔레트/칸반/캔버스 모달 전부).
- **글자 규칙** — 제목 `text-base font-semibold`, 본문 `text-[13px]`, 모노스페이스 메타 라벨 `text-[11px] uppercase tracking-wider`.
- **`ChatCenterCard`** — "I'm BOSS" 타이틀 + 우상단 `New Session` 버튼 → `useChat().requestNewSession()`. 본문은 `InlineChat` (설명은 아래).
- **`DomainCard`** — 제목 + 통계(3열 그리드 `Active / Due / Recent` 숫자 pill) + 하단에 최근 artifact 4개 (`flex-col justify-end` 로 바닥에서 위로 쌓임, 최신이 맨 위). 통계 박스와 최근 pill 모두 `rounded-[5px]`.
- **`ScheduleCard`** (`bg-[#ffdd00]` or 유사) — 상위 5개 일정. 아이템 클릭 → `boss:open-schedule-modal`.
- **`ActivityCard`** (`bg-[#e8ffbd]`) — 상위 6개 활동. 아이템 클릭 → `boss:open-activity-modal`. 시간 포맷 영어 (`just now` / `Nm ago` …).
- **`PreviousChatCard`** — `useChat().sessions` 구독. 상위 4개 세션. 아이템 클릭 → `requestLoadSession(id)` → InlineChat 이 로드.
- **`ProfileMemorySidebar`** (`min-[1500px]:flex`) — 세로 3:3:3 스택.
  - `ProfileCard` — `profiles` 쿼리 (display_name/business_name/business_type/business_stage/employees_count/location/channels/primary_goal/profile_meta). 우상단 → `boss:open-profile-modal`.
  - `LongMemoryCard` — `memory_long` importance desc · 상위 3개 preview. 우상단 → `boss:open-longmem-modal`.
  - `MemosCard` — `memos` + artifact title join · 상위 3개. 우상단 → `boss:open-memos-modal`. 아이템 클릭 → `boss:open-memos-modal` (대시보드에 캔버스 없음 → `boss:focus-node` 사용 안 함).

### Domain Page (`/[domain]` — `DomainPage.tsx`)

- 대시보드에서 DomainCard 클릭 시 `/recruitment` / `/marketing` / `/sales` / `/documents` 로 이동. Hero banner (`rounded-[5px]`) + `KanbanBoard` (`bento/KanbanBoard.tsx`).
- KanbanBoard 는 해당 도메인의 서브허브 = 컬럼으로 펼침. 미분류 artifact 는 "미분류" 컬럼에 모임. 드래그 → `PATCH /api/kanban/move` 로 `artifact_edges.relation='contains'` 부모 교체.
- **Kanban 테마 토큰** — `globals.css` 의 `.bento-shell` 스코프 CSS 변수 (`--kb-fg`, `--kb-border`, `--kb-surface`, `--kb-card`, `--kb-dday-urgent`, `--kb-dday-soon`, `--kb-warn-*`, `--kb-fg-on-banner` 등). `html[data-bg="dark"] .bento-shell` 에서 오버라이드 → light/dark 두 테마에서 모두 가독 보장.

### Inline Chat (`components/chat/InlineChat.tsx`)

- `ChatCenterCard` 안에 항상 마운트되는 풀 기능 채팅. v0.9.x 의 풀스크린 `ChatOverlay` 를 대체.
- 파일 업로드(PDF/DOCX/XLSX/이미지), 이미지 OCR, `[CHOICES]` 버튼, 분류 confirm, `[ACTION:OPEN_SALES_TABLE]` / `[ACTION:OPEN_COST_TABLE]` 인라인 테이블 모달, Markdown 렌더, `ReviewResultCard` / `InstagramPostCard` / `ReviewReplyCard` 전부 이식.
- **Empty state** — 메시지 0개일 때 카드 중앙에 `ASK THE CHATBOT.` + 4개 제안 프롬프트 (세로 스택, `w-1/2`). 매 mount / 새 세션 / 빈 세션 로드마다 `pickSuggested()` 가 도메인별 10문항 풀(`SUGGESTED_POOL`, 총 40개) 에서 **도메인당 1개씩 랜덤 샘플링**.
- **로그인 브리핑** 진입 — `BriefingLoader` 가 `sessionStorage.boss2:pending-briefing` 을 꺼내 `useChat.openChatWithBriefing(content)` 호출 → ChatContext 의 `pendingBriefing` 이 세팅 → InlineChat 의 useEffect 가 감지해서 첫 메시지를 브리핑으로 교체.
- **세션 로드** — `useChat.requestLoadSession(id)` 가 `loadSessionTick` 증가 → InlineChat 이 `GET /api/chat/sessions/:id/messages` 로 메시지 하이드레이트.

### Modal System

- **`components/ui/modal.tsx`** — `createPortal(..., document.body)` 로 렌더 (헤더의 `backdrop-filter` containing block 이슈 해결). `variant: "sand" | "dashboard"` prop:
  - `sand` (기본) — `rounded-xl` + sand palette. 캔버스 7개 모달(`NodeDetailModal` 등) 에서 사용.
  - `dashboard` — `rounded-[5px]` + `bg-[#f4f1ed]` + `border-[#030303]/10`. 대시보드 모달 6종에서 사용.
- **대시보드 모달 6종 (720×560 통일, variant=`dashboard`)**:
  - `ChatHistoryModal` — 세션 리스트 + row hover 휴지통 버튼 → confirm → `DELETE /api/chat/sessions/:id` → 현재 세션 삭제 시 `requestNewSession()`.
  - `ScheduleManagerModal` — 리스트/캘린더 뷰 토글. `kind='schedule'` ∪ (metadata 에 `start_date`/`end_date`/`due_date` 하나 이상) 통합 조회. 라벨 영어(`Active/Paused/Ended`, `Upcoming` 등).
  - `ActivityModal` — `activity_logs` 최근 200개. 타입 라벨 영어(`Created/Run/Auto-run/Notify`), notify 배지 `D-N start/due`.
  - `ProfileModal` — `profiles` 전체 필드 + `profile_meta` 추가 섹션.
  - `LongTermMemoryModal` — `memory_long` importance desc 200개.
  - `MemosModal` — 2열 카드 그리드 (artifact 제목 + 본문 + 상대시간).
- **캔버스 모달 7종 (variant=`sand` 기본)** — `NodeDetailModal`, `DateRangeModal`, `ConfirmModal`, `SummaryModal`, `ScheduleModal`, `LogDetailModal`, `HistoryModal`. 소스만 남아있고 현재 `/dashboard` · `/[domain]` 에선 사용되지 않음 (추후 캔버스 복구 시를 대비).

### Header (`components/layout/Header.tsx`)

- 배경: 솔리드 `#ffffff` (v1.0.0 에서 `rgba(.85)+blur(12px)` → 솔리드로, light/dark 고정).
- 좌측: BOSS 로고. 중앙: 검색 버튼 (`⌘K` / `Ctrl+K` 단축키). 우측: 버튼 3개 + 로그아웃.
  - `Schedule` → `boss:open-schedule-modal`
  - `Activity` → `boss:open-activity-modal`
  - `Light/Dark` 토글 → `localStorage.boss2:bg-dark` + `html[data-bg="dark"]` attr.
  - `Logout` → Supabase signOut + `/login` redirect.
- **영어 UI** — 모든 라벨/aria-label/tooltip 영어 (v1.0.0 기준).
- v0.9.x 까지 있던 `정렬 (Layout)` 버튼은 v1.0.0 에서 제거 (FlowCanvas 리스너만 남고 발행자 없음).

### Custom Events (frontend 전역)

| 이벤트                         | 발행 위치                                                                      | 구독 위치      | 페이로드         |
| ------------------------------ | ------------------------------------------------------------------------------ | -------------- | ---------------- |
| `boss:artifacts-changed`       | `InlineChat` (매 응답 후) · `KanbanBoard` (drop 후) · 기타                     | `BentoGrid` 외 | —                |
| `boss:open-schedule-modal`     | `ScheduleCard` / `ScheduleCard` 아이템                                         | `Header`       | —                |
| `boss:open-activity-modal`     | `ActivityCard` / `ActivityCard` 아이템                                         | `Header`       | —                |
| `boss:open-chat-history-modal` | `PreviousChatCard`                                                             | `Header`       | —                |
| `boss:open-profile-modal`      | `ProfileMemorySidebar.ProfileCard`                                             | `Header`       | —                |
| `boss:open-longmem-modal`      | `ProfileMemorySidebar.LongMemoryCard`                                          | `Header`       | —                |
| `boss:open-memos-modal`        | `ProfileMemorySidebar.MemosCard` + MemosCard 아이템                            | `Header`       | —                |
| `boss:focus-node`              | `MemosModal` / `SearchPalette` / (구) `ActivityModal` 등                       | (캔버스 없음)  | `{ id: string }` |
| `boss:reset-layout`            | 더 이상 발행되지 않음 (Header `Layout` 버튼 삭제됨) — FlowCanvas 수신자만 잔존 | `FlowCanvas`   | —                |

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

### Migration File Layout (v0.6.0 기준)

```
supabase/
├── migrations/
│   ├── 001_extensions.sql                       # pgcrypto, uuid-ossp, vector, pg_trgm
│   ├── 002_schema.sql                           # 11개 테이블 (public 스키마)
│   ├── 003_indexes.sql                          # ivfflat + GIN + btree
│   ├── 004_rls.sql                              # Row Level Security
│   ├── 005_functions_triggers.sql               # bootstrap_workspace, hybrid_search, memory_search
│   ├── 006_expand_embeddings_source_type.sql    # schedule/log/hub source_type + upsert_embedding RPC + source_id uniq
│   ├── 007_memos.sql                            # memos 테이블 + RLS + 'memo' source_type + updated_at 트리거
│   ├── 008_expand_activity_log_types.sql        # activity_logs.type CHECK 확장: schedule_run / schedule_notify
│   ├── 009_profile_last_seen.sql                # profiles.last_seen_at (timestamptz) — 로그인 브리핑 트리거
│   ├── 010_profile_expansion.sql                # profiles 7개 core 컬럼 + profile_meta jsonb
│   ├── 011_contract_knowledge.sql               # 계약서 검토 RAG 테이블 3종 (law/pattern/acceptable)
│   ├── 012_contract_knowledge_search.sql        # 3-way RRF RPC 3종
│   ├── 013_artifact_edges_analyzed_from.sql     # analyzed_from relation 추가
│   ├── 014_standard_sub_hubs.sql                # 17종 표준 서브허브 자동 부트스트랩
│   ├── 015_marketing_knowledge.sql              # marketing 지식 테이블
│   ├── 016_marketing_rag.sql                    # marketing 하이브리드 검색 RPC
│   ├── 017_marketing_subhubs.sql                # marketing 서브허브 확장
│   ├── 018_legal_knowledge.sql                  # legal_knowledge_chunks (다분야 법령 통합 테이블)
│   └── 019_legal_knowledge_search.sql           # search_legal_knowledge 3-way RRF RPC
└── seed/
    ├── seed_mock_data.sql           # test@test.com 용 mock 시드
    └── cleanup_mock_data.sql        # '[MOCK]%' 일괄 제거
```

> v0.7.0 (documents 에이전트 + D-7/3/1/0 리마인드) 는 **마이그레이션 불필요** — `due_label` / `contract_subtype` / 확장 `notify_kind` 모두 `metadata` jsonb 안에서 처리.
>
> v0.8.x (공정성 분석) — 011 + 012 마이그레이션:
>
> - `011_contract_knowledge.sql` — `law_contract_knowledge_chunks` / `pattern_contract_knowledge_chunks` / `acceptable_contract_knowledge_chunks` 3종 지식 테이블 + HNSW/trgm/FTS 인덱스 + RLS(SELECT 공개, INSERT 는 service_role).
> - `012_contract_knowledge_search.sql` — 3-way RRF RPC 3종 (`search_law/pattern/acceptable_contract_knowledge`).
> - 인제스트 스크립트: `backend/scripts/ingest_contract_{laws,risks,acceptable}.py`. BAAI/bge-m3 로컬 임베딩.
>
> v0.9.0 (Legal 서브브랜치) — 018 + 019 마이그레이션:
>
> - `018_legal_knowledge.sql` — `legal_knowledge_chunks` (단일 테이블, 2단계 article/paragraph 청킹, domain 필드로 분야 구분).
> - `019_legal_knowledge_search.sql` — `search_legal_knowledge` 3-way RRF RPC (vector / FTS / trgm).
> - 인제스트 스크립트: `backend/scripts/ingest_legal_knowledge.py` — 법제처 Open API 기반, 16종 법령 (노동 5 / 임대 1 / 공정 2 / 전자상거래 1 / 개인정보 1 / 세법 2 / 중소기업 2 / 식품 1 / 상법 1).

### documents 에이전트 자산 (v0.7.0 + v0.8.x)

```
backend/app/agents/
├── _doc_templates.py                # TYPE_SPEC + SKELETONS + build_doc_context + detect_doc_intent
├── _doc_review.py                   # analyze + dispatch_review (RAG 3-way + gpt-4o-mini JSON)
└── _doc_knowledge/                  # 스켈레톤 주입용 markdown (런타임 인라인 로드)
    ├── labor/{acceptable,risks}.md
    ├── lease/{acceptable,risks}.md
    ├── service/{acceptable,risks}.md
    ├── supply/{acceptable,risks}.md
    ├── partnership/{acceptable,risks}.md
    ├── franchise/{acceptable,risks}.md
    └── nda/                         # 분석 단계에서 채움 (아직 비어있음)

backend/app/core/
├── doc_parser.py                    # PDF(PyMuPDF) / DOCX(python-docx) / 이미지(gpt-4o vision OCR)
└── ocr.py                           # extract_text_from_image (OpenAI vision)

backend/app/routers/
├── uploads.py                       # POST /api/uploads/document — Supabase Storage(documents-uploads) + uploaded_doc artifact
└── reviews.py                       # POST /api/reviews — dispatch_review 래퍼
```

업로드/분석 artifact 타입:

- `type='uploaded_doc'` — 업로드 원본. `metadata: {storage_path, bucket, mime_type, size_bytes, original_name, parsed_len}`. 캔버스에서 📎 아이콘.
- `type='analysis'` — 공정성 분석. `metadata: {analyzed_doc_id, gap_ratio, eul_ratio, risk_clauses[], user_role, contract_subtype}`. 캔버스에서 ⚖️ 아이콘 + `갑N:을M` pill. 원본과 `analyzed_from` 엣지로 연결 (시각적으로 대시 스트로크).
- 채팅: Paperclip 버튼으로 PDF/DOCX/이미지 업로드 → `ChatOverlay` 가 자동으로 분석 트리거 메시지 전송 → 에이전트가 역할 CHOICES → 확정 시 `[REVIEW_REQUEST]` 마커 → `[[REVIEW_JSON]]` 페이로드 → `ReviewResultCard` 렌더.

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
