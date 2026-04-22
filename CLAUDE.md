# CLAUDE.md — BOSS-2

## Project Overview

소상공인 자율 운영 AI 플랫폼. **Planner 기반 오케스트레이터**가 채용·마케팅·매출·서류 도메인 에이전트를 **function-calling 방식** 으로 라우팅하고, Celery Beat 스케쥴러가 artifact metadata 에 내장된 일정을 자동 실행한다.

## Git / Branch Policy

- **default branch: `dev`** — 모든 feature 브랜치는 반드시 `dev` 를 base 로 PR 한다. `main` 은 릴리스 스냅샷 전용.
- 버전 bump PR 타이틀은 `chore: vX.Y.Z — …`, 기능은 `feat: …`, 수정은 `fix: …` 관례.

## Tech Stack

- **Frontend**: Next.js 16 App Router, Tailwind CSS, Shadcn/ui (React Flow 는 v1.1 에서 제거됨 — Bento + Kanban 으로 대체)
- **Backend**: FastAPI (Python 3.12) — async 전역
- **DB**: Supabase (PostgreSQL + pgvector + Realtime) — public 스키마 사용
- **Scheduler**: Celery + Upstash Redis (Celery Beat)
- **AI**: OpenAI API (GPT-4o chat, GPT-4o-mini planner/compress), BAAI/bge-m3 (로컬 임베딩, 1024dim). Planner 는 Anthropic Claude 로 스왑 가능 (`PLANNER_PROVIDER=anthropic`).
- **Auth**: Supabase Auth (이메일 + 비밀번호)

## Architecture Rules

### Orchestrator 동작 (v1.2 — Planner 주 경로)

`orchestrator.run()` 은 **Planner 주 경로 → Legacy 세이프티넷** 2단 구조다.

1. **Planner 주 경로** (`_dispatch_via_planner`):
   - `_capability.describe_all(account_id)` 로 4개 도메인(recruitment/documents/marketing/sales) 의 capability 카탈로그를 OpenAI tools 스펙 + dispatch map 으로 조립.
   - `_planner.plan(...)` 가 `response_format=json_schema` 강제로 아래 중 한 `mode` 의 구조화 JSON 을 반환:
     - `dispatch` — 1개 이상 capability 를 `steps[]` 로 실행
     - `ask` — 도메인/파라미터 명확화 필요 — `question` + `choices[]`
     - `chitchat` — 인사·호칭·BOSS 사용법 — `opening` 이 곧 최종 응답
     - `refuse` — 4개 도메인과 무관 — `opening` 또는 `_refusal_message`
     - `planning` — 기간 플랜 요청 → `_handle_planning` 위임
   - 매 턴 `profile_updates` 를 즉시 저장 (`_save_profile_updates`) — 사용자의 직접 발화에서 추출된 core/meta 값만.
   - `dispatch` 의 `steps` 가 `depends_on=null` 로만 구성되면 `asyncio.gather` 로 **병렬 실행**, 아니면 순차 실행 + `_preceding_reply` 주입.
   - `opening` 이 있으면 결과 앞에 오케스트레이터 목소리로 합성해서 노출. `brief` 는 내부 지시문 (UX 노출 X, `_orchestrator_brief` 로 handler 에 주입).
   - Planner 가 `error` 를 돌려주거나 capability 가 dispatch 맵에 없으면 `None` 반환 → 상위 `run()` 이 legacy 폴백.

2. **Legacy 세이프티넷** (`classify_intent` + `_call_domain_with_shortcut`):
   - Planner 실패 시에만 발동. `classify_intent` 가 기존처럼 라벨 리스트(`recruitment|marketing|sales|documents|chitchat|refuse|planning`) 반환.
   - 단일 도메인은 `_call_domain_with_shortcut` 로 shortcut(에이전트 1회 호출 → `[CHOICES]` 있으면 히스토리로 추정 재호출) 실행.
   - 복수 도메인은 per-domain 호출 후 `[CHOICES]` 미해결 시 `_synthesize_cross_domain` 으로 합성.
   - CHOICES sticky override (`_last_assistant_unresolved_choices` / `_has_context_reference` / `_guess_domain_from_recent`) 는 legacy 에서만 유효.

**Speaker 추적** (v1.2 신규):

- `_speaker_context.set_speaker(list[str])` — orchestrator 가 경로마다 화자 배열을 저장. chitchat/refuse/planning/ask → `['orchestrator']`, dispatch → `[domain, ...]` (중복 제거).
- chat router 가 `get_speaker()` 로 회수해서 `chat_messages.speaker` (text[]) 에 저장 + `ChatResponse.data.speaker` 로 프론트에 노출.
- 프론트 `SpeakerBadge` 가 이 값을 도메인 색상 pill 로 렌더.

### Agent 구조

- `orchestrator.py` — Planner 주 경로 + legacy 세이프티넷 + **로그인 브리핑** + **닉네임/프로필 추출**. 비즈니스 로직 없음.
- `_planner.py` (v1.1+) — JSON-schema 강제 플래너. `planner_completion` 통해 OpenAI(gpt-4o-mini 기본) 또는 Anthropic Claude 호출.
- `_capability.py` — capability 레지스트리. `V2_DOMAINS = ("recruitment", "documents", "marketing", "sales")` — **4개 도메인 모두 function-calling 으로 통합**. sales 도 v1.2 에서 합류.
- `recruitment.py` — type 매트릭스(`job_posting | job_posting_set | job_posting_poster | interview_questions | checklist | guide | hiring_drive`). 당근알바/알바천국/사람인 3종 플랫폼 공고 동시 작성 (`[JOB_POSTINGS]` 마커 → 부모 `job_posting_set` + 자식 `job_posting × 3` + `metadata.platform`). HTML 포스터는 `core.poster_gen.generate_job_posting_poster` 가 GPT-4o standalone HTML 을 만들어 Supabase Storage `recruitment-posters` 버킷 + `artifacts.content` 이중 저장 (플랫폼별 1:1 / 4:5 / 3:2 비율). 업종별 CHOICES 분기는 `_recruit_templates.detect_category(business_type)` (cafe/restaurant/retail/beauty/academy/default). 인건비는 `_recruit_calc.py` (연도별 최저임금 + 주휴수당 + 4대보험).
- `documents.py` — type 매트릭스(v1.3 Step 3 에서 11종으로 확장): 기본 6종(`contract | estimate | proposal | notice | checklist | guide`) + Operations 신규 2종(`subsidy_application | admin_application`) + Tax&HR 신규 3종(`hr_evaluation | payroll_doc | tax_calendar`). 계약서 subtype 7종(`labor | lease | service | supply | partnership | franchise | nda` — NDA knowledge 폴더도 Step 3-D 에서 추가됨). 서브타입별 스켈레톤/법령·관행 조항은 `_doc_templates.build_doc_context` 가 주입하고, 원본 markdown 은 `_doc_knowledge/<subtype>/{acceptable,risks}.md`. 저장 시 `metadata.contract_subtype` + `due_label` 을 동반. **서브허브 매핑**(v1.3, `_TYPE_TO_SUBHUB`): `contract`·`proposal` → **Review**, `estimate`·`notice` → **Operations**, `checklist`·`guide` → **Tax&HR**, `legal_advice` → **Legal**. 내부 식별자(`contract_subtype`, `*_contract_knowledge_chunks`, `search_*_contract_knowledge` RPC)는 "contract" 이름을 유지 — 사용자 노출 라벨만 Review. 각 capability 의 `describe()` description 에 `[카테고리: …]` 힌트를 달아 Planner 가 4카테고리 축으로 라우팅하도록 유도. **LangGraph 라우터 2단 구조**(v1.3, legacy 세이프티넷·직접 run() 호출 경로): `_classify_node` → `{_legal_node, _review_node, _write_review_node, _write_tax_hr_node, _write_operations_node, _ask_category_node}` 6노드. `detect_doc_intent` 로 type 감지 후 `TYPE_TO_CATEGORY` 매핑이 있으면 `write_<category>` 로, type 없으면 `classify_legal_intent` → legal, `detect_doc_category` 키워드 감지 → `write_<category>`, 모두 실패 시 `ask_category` 가 `CATEGORY_LABELS` 기반 4-choice CHOICES 를 **LLM 호출 없이** 즉시 반환. `_run_write(state, category)` 공통 헬퍼가 카테고리별 `_CATEGORY_GUIDANCE` 블록만 system 에 스왑. **공정성 분석**: `_upload_context.get_pending_upload()` 로 이번 턴에 업로드된 파일 payload 를 받아 역할 CHOICES(갑/을/미지정) → `[REVIEW_REQUEST]` 마커 → `_doc_review.dispatch_review` → `type='analysis'` artifact + `analyzed_from` 엣지 + 응답 끝 `[[REVIEW_JSON]]` (프론트 `ReviewResultCard` 렌더). analysis artifact 는 Review 서브허브 아래로 연결 (`pick_sub_hub_id(prefer_keywords=("Review","contract"))`). **Legal 서브브랜치**: `_legal.classify_legal_intent` 로 일반 법률 자문 질문을 감지 (휴리스틱상 서류 작성 의도 없고 업로드 컨텍스트 없을 때만) → `search_legal_knowledge` RPC + `legal_annual_values` 테이블 조회(연도별 최저임금·세율 등) → GPT-4o 조언 + 면책 고지 + `type='legal_advice'` artifact 를 Documents > Legal 서브허브 아래 저장.
- `marketing.py` — type 매트릭스(`sns_post | blog_post | ad_copy | marketing_plan | event_plan | campaign | review_reply | notice | product_post | shorts_video`). 인스타그램 Meta Graph API 자동 게시(`/api/marketing/instagram/publish`), 네이버 블로그 자동 업로드(Playwright, `/api/marketing/blog/upload`), YouTube Shorts 생성 (`/api/marketing/youtube/shorts/generate` 4-step 위저드), DALL·E 3 이미지 생성, 리뷰 답글 톤 분기 등. Subsidy(지원사업) 검색 RPC 포함.
- `sales.py` — type 매트릭스(`revenue_entry | cost_report | price_strategy | customer_script | customer_analysis | sales_report | promotion | checklist`). v1.2 에서 capability describe 를 export 하며 `_sales/` 서브패키지로 비즈니스 로직 분할. 서브허브 매핑: Reports(revenue_entry / sales_report / promotion / checklist), Costs(cost_report), Pricing(price_strategy), Customers(customer_script / customer_analysis). 매출/비용 입력은 `[ACTION:OPEN_SALES_TABLE]` / `[ACTION:OPEN_COST_TABLE]` 마커로 프론트 인라인 테이블을 여는 흐름.
- `_sales/` (v1.2 신규 서브패키지):
  - `_revenue.py` — `dispatch_save_revenue(account_id, items, recorded_date, source)` — 5분 윈도 items_hash 기반 idempotent insert, revenue_entry artifact 생성 + Reports 서브허브 연결 + 임베딩 인덱싱 + activity_log.
  - `_costs.py` — 동일 패턴. 카테고리 enum: `재료비 | 인건비 | 임대료 | 공과금 | 마케팅 | 기타`.
  - `_ocr.py` — `parse_receipt_from_bytes(file_bytes, mime_type)` → `{type: 'sales'|'cost', items: [...]}`. GPT-4o vision. v1.0 의 `sales_ocr.py` 라우터는 제거되고 이 모듈이 capability(`sales_parse_receipt`) 로 승격.
- `_sales_context.py` — per-request ContextVar 로 `pending_receipt` + `pending_save` payload 공유 (chat router → sales agent).
- `_upload_context.py` — per-request ContextVar 로 업로드 payload 공유 (chat router → documents agent). v1.0 이후 업로드 자체는 artifact 를 만들지 않고 payload 만 전달.
- `_doc_review.py` — `analyze(content, user_role, doc_type, contract_subtype) → ReviewResult` + `dispatch_review(...)`. RAG: `search_{law,pattern,acceptable}_contract_knowledge` 3-way RRF RPC. 분석 artifact 는 원본과 `analyzed_from` 엣지만 생성 (서브허브 `contains` 엣지는 의도적으로 만들지 않음).
- `_doc_classify.py` — 업로드 문서 분류 헬퍼 (`documents | receipt | invoice | tax | id | other`). 키워드 스코어링 + GPT-4o-mini JSON 폴백.
- `_doc_templates.py` — `TYPE_SPEC` / `SKELETONS` / `build_doc_context` / `detect_doc_intent` + v1.3 의 `TYPE_TO_CATEGORY` / `CATEGORY_LABELS` / `CATEGORY_TO_SUBHUB` / `detect_doc_category` (키워드 기반 4카테고리 축 라우팅).
- `_legal.py` — `classify_legal_intent` + `_retrieve_legal_context` + `_generate_advice` + `_save_legal_advice`. `search_legal_knowledge` RPC (018·019 마이그레이션) + `legal_annual_values` 테이블(020 마이그레이션) 연동. `DISCLAIMER` 상수가 면책 문구 통일.
- `_marketing_knowledge.py` — 마케팅 지식 RAG + 지원사업(subsidy) 검색 헬퍼.
- `_recruit_templates.py` / `_recruit_calc.py` / `_recruit_knowledge/` — 채용 보조.
- `_suggest.py` — 도메인 공용 `suggest_today_for_domain(account_id, domain)` (마감 임박 artifact + 오늘~내일 예정 최대 3개).
- `_feedback.py` — 도메인 에이전트 system 프롬프트에 주입되는 과거 up/down-vote 피드백 컨텍스트.
- `_artifact.py` — `[ARTIFACT]` 블록 파서 + `save_artifact_from_reply` + `list_sub_hub_titles` + `pick_sub_hub_id` + `record_artifact_for_focus` (ContextVar 로 첫 저장 artifact id 를 chat router 가 회수해서 응답 focus 로 반환).
- 에이전트 간 직접 호출 금지. 반드시 orchestrator 또는 capability 경로를 통해 라우팅.
- 하나의 artifact 가 여러 도메인에 속할 수 있음 (크로스 도메인) — `domains TEXT[]` 배열.

### Nickname + Profile 자동 학습

- 응답에 **인라인 블록** 삽입/해제 규약 (에이전트와 오케스트레이터 공용):
  - `[SET_NICKNAME]닉네임[/SET_NICKNAME]` — 호칭 저장 (`profiles.display_name`).
  - `[SET_PROFILE]` … 한 줄당 `key: value` … `[/SET_PROFILE]` — 사업 프로필 저장.
- Core key 허용: `business_type | business_name | business_stage(창업 준비|오픈 직전|영업 중|확장 중) | employees_count(0|1-3|4-9|10+) | location | channels(offline|online|both) | primary_goal`.
- `sns_channels: 인스타,틱톡` 같은 쉼표 값은 `profile_meta.sns_channels` 리스트로 저장. 그 외 자유 key/value 는 `profile_meta` 에 머지.
- **v1.1+** — Planner 가 매 턴 `profile_updates` 필드로 직접 추출 + 저장하는 경로가 추가됐다. legacy 블록 추출 (`_extract_and_save_nickname` / `_extract_and_save_profile`) 도 유지.
- system 프롬프트 주입: `_nickname_context` + `_profile_context` + `_profile_nudge_context` 는 모든 도메인 에이전트 system 컨텍스트 끝에 append (`NICKNAME_RULE`, `PROFILE_RULE` 상수 공유).

### 로그인 브리핑

- 프론트가 로그인 성공 직후 `POST /api/auth/session/touch {account_id}` 호출.
- 백엔드가 `profiles.last_seen_at` 을 읽어 **이전 접속 시각** 확보 → `orchestrator.build_briefing(account_id, last_seen_at)` 실행 → `last_seen_at` 을 now 로 갱신.
- 발사 조건(`_briefing_should_fire`): `last_seen_at` 없거나 (now - last_seen_at ≥ 8h) 또는 이전 접속 이후 `task_logs.status='failed'` ≥ 1건.
- 본문 구성: 헤드라인 3줄 + `---` + `### 자리 비운 사이` / `### 최근 이어가기` / `### 오늘 추천` + 마지막 질문 1개.
- `_aggregate_activity` 가 `activity_logs` + `task_logs` 를 타입/도메인별 집계, `_top_domains_last_week` 로 상위 1~2 도메인 최근 제목 → `hybrid_search` 1회로 장기기억 recall.
- 프로필 core 필드가 3개 미만이면 **프로필 넛지** 인스트럭션 추가.
- 응답(`{should_fire, message, meta}`) 을 프론트가 `sessionStorage.boss2:pending-briefing` 에 저장 → `/dashboard` 진입 시 `BriefingLoader` 가 꺼내 `openChatWithBriefing(content)` 호출 → 채팅창 첫 assistant 메시지가 브리핑으로 교체.

### Memory 구조

- 계정 = Supabase Auth `auth.uid()` (이메일 + 비밀번호).
- `memory_short` (Upstash Redis) + `memory_long` (Supabase pgvector) — 계정별 독립.
- 대화 턴 20 초과 시 자동 context 압축 (GPT-4o-mini 요약, `memory/compressor.py`) → 요약은 `memory_long` 에 도메인 null 상태로 저장.
- **Long-term memory 저장 (v1.3, 025 마이그레이션)**:
  - **도메인 × 일자(KST) digest 단위** — 한 계정의 같은 도메인·같은 날짜 이벤트는 하나의 row 에 누적. `(account_id, domain, digest_date)` partial unique index.
  - `log_artifact_to_memory(account_id, domain, artifact_type, title, content, metadata)` — artifact 생성 시 호출. `gpt-4o-mini` 로 2~3문장 요약 → 기존 digest 에 `- [HH:MM] {type} '{title}' — {요약}` 한 줄 append → 전체 재임베딩 후 `upsert_memory_long` RPC.
  - 시각은 모두 **KST (`ZoneInfo("Asia/Seoul")`)** 로 표기 (DB `created_at` 는 UTC 유지).
  - `importance` 기본값: artifact digest 2.0 · compressor 요약 1.5 · 사용자 Boost 0.2~1.0 · 피드백 0.6/0.85.
- **Long-term memory recall (v1.3)**:
  - `memory_search(p_account_id, p_embedding, p_query_text, p_limit)` — vector RRF + FTS RRF 합산에 `importance` 곱셈.
  - **7일 recency 필터** — `where created_at > now() - interval '7 days'` 내장.
  - 최대 N건(`chat.py:78` 은 `limit=3`) 을 `long_term_context` 로 각 도메인 에이전트 system prompt 에 주입.
- **Retention** — Celery Beat 매일 00:00 KST `app.scheduler.tasks.cleanup_old_memories` 실행 → 7일 이전 row DELETE.
- **Chat sessions** — `chat_sessions` + `chat_messages` 에 세션/메시지 저장. `chat_messages.speaker` (text[], 023 마이그레이션) 로 assistant 메시지의 화자 기록. 첫 user 메시지가 들어오면 `sessions.generate_title` 이 백그라운드로 제목 생성.

### RAG / 하이브리드 서치

- 벡터 검색: pgvector (BAAI/bge-m3, 1024dim) — `app/core/embedder.py`.
- 키워드 검색: PostgreSQL Full-Text Search (BM25 근사).
- 최종 결과: RRF 병합 — DB 함수 `public.hybrid_search`.
- 임베딩 대상: artifacts(kind=artifact/log/domain-hub), memos, 장기 기억, 업로드 문서 (v1.2: kind=schedule 은 제거).
- 공용 upsert: `public.upsert_embedding(account_id, source_type, source_id, content, embedding)` — runtime `index_artifact` / 메모 CRUD / `scripts/backfill_embeddings.py` 모두 이 RPC 사용. `source_id` 유니크 인덱스로 upsert 안전.
- `source_type` 허용값: `recruitment | marketing | sales | documents | memory | document | schedule | log | hub | memo`.

### Scheduler 구조 (`backend/app/scheduler/`)

- **v1.2 변경**: `kind='schedule'` 별도 노드 체계를 폐기. 일정은 부모 artifact 의 `metadata.schedule_enabled` + `metadata.schedule_status` + `metadata.cron` + `metadata.next_run` 으로 인라인 저장. (020_schedule_to_metadata.sql 이 기존 schedule 노드들을 부모 metadata 로 흡수하고 `artifacts_kind_check` 에서 `schedule` 을 제거.)
- `celery_app.py` — Celery app 팩토리. `CELERY_BROKER_URL=rediss://…@upstash:6379/0` 에 `ssl_cert_reqs=CERT_REQUIRED` 자동 주입. Beat 기본 스케쥴로 `scheduler-tick` 하나를 `SCHEDULER_TICK_SECONDS`(기본 60s) 간격으로 등록.
- `tasks.tick` — Beat 이 60s 마다 호출하는 스캐너. `scanner.find_due_schedules` → per-item `run_schedule_artifact.delay(id)` fan-out. `scanner.find_date_notifications` → tick 안에서 바로 `activity_logs.schedule_notify` insert (중복은 `(artifact_id, notify_kind, for_date)` 로 방지).
- `tasks.run_schedule_artifact(id)` — 단일 artifact 실행. `status=running` 전이 → `orchestrator.run_scheduled(artifact, account_id)` → 결과 반영(`status=active`, `metadata.executed_at`, `metadata.next_run = croniter.get_next`) + `task_logs` 성공/실패 insert + `activity_logs.schedule_run` insert + `log_nodes.create_log_node` 로 `kind='log'` artifact 노드 + `artifact_edges.relation='logged_from'` 추가.
- `scanner.find_due_schedules(now)` — `kind='artifact' AND metadata.schedule_enabled='true' AND metadata.schedule_status in (null|'active') AND metadata.next_run <= now`.
- `scanner.find_date_notifications(today)` — `kind='artifact'` 의 `metadata.start_date` / `metadata.due_date` / `metadata.end_date` 를 **D-7 / D-3 / D-1 / D-0** 오프셋으로 스캔. notify_kind 규약: `start` · `start_d1` · `start_d3` · `due_d0` · `due_d1` · `due_d3` · `due_d7`. 오늘자 `activity_logs.schedule_notify` 가 이미 있는 `(artifact_id, notify_kind, for_date)` 는 필터. 알림 문구는 `metadata.due_label` ("납품기한"/"계약 만료" 등) 주입.
- `log_nodes.create_log_node(sb, parent_artifact, status, content, executed_at)` — `kind='log'` 노드 insert + `artifact_edges(parent=원본 artifact, child=log, relation='logged_from')`.
- 태스크 실행 결과는 항상 `artifacts`(status/metadata) + `task_logs` + `activity_logs` + `kind='log'` 노드 **4곳에 동시 기록**.

### Realtime

- Supabase Realtime 으로 `artifacts` 테이블 변경 구독 가능 (현재 Bento/Kanban 은 `boss:artifacts-changed` CustomEvent 수동 발행 방식 위주).

## Database Tables (public schema)

```
profiles              — auth.users 확장, display_name (닉네임), last_seen_at (로그인 브리핑),
                        business_type / business_name / business_stage / employees_count / location /
                        channels / primary_goal (core 7개) + profile_meta(jsonb)
artifacts             — account_id(auth.uid), domains text[] (recruitment|marketing|sales|documents),
                        kind(anchor|domain|artifact|log),  -- 'schedule' 제거됨 (020 마이그레이션)
                        type, title, content, status,
                        metadata(jsonb: pinned, position, schedule_enabled, schedule_status, cron,
                                 next_run, executed_at, start_date, end_date, due_date, due_label,
                                 contract_subtype, analyzed_doc_id, gap_ratio, ...),
                        created_at
artifact_edges        — parent_id, child_id, relation(contains|derives_from|revises|logged_from|
                                                      analyzed_from)
                        -- 'scheduled_by' 는 020 이후 새로 만들지 않음 (기존 데이터는 drop)
evaluations           — artifact_id, account_id, rating(up|down), feedback
embeddings            — account_id, source_type, source_id, embedding(vector 1024), fts, content
memory_short          — account_id, session_id, messages(jsonb), turn_count
memory_long           — account_id, content, embedding(vector 1024), importance,
                        domain (recruitment|marketing|sales|documents|null),
                        digest_date (KST date, nullable), fts(tsvector)
                        (025: 도메인×일자 digest + RRF + 7일 TTL)
activity_logs         — account_id, type, domain, title, description, metadata(jsonb)
                        type 허용값: artifact_created | agent_run | schedule_run | schedule_notify
schedules             — (DEPRECATED — 020 마이그레이션 이후 신규 인서트 없음, 기존 행만 남음 가능)
task_logs             — artifact_id(구 schedule_id 연결), account_id, status, result, error, executed_at
memos                 — account_id, artifact_id, content, created_at, updated_at
chat_sessions         — id, account_id, title, created_at, updated_at
chat_messages         — id, session_id, role(user|assistant|system), content, choices(jsonb),
                        attachment(jsonb), speaker(text[]), created_at
                        (023: speaker 추가 — assistant 메시지의 화자 배열, user/system 은 null)
sales_records         — id, account_id, recorded_date, item_name, category, quantity, unit_price,
                        amount, source(chat|ocr|csv|excel), raw_input, metadata(jsonb), created_at
                        (021 마이그레이션)
cost_records          — id, account_id, recorded_date, item_name, category(재료비|인건비|임대료|
                        공과금|마케팅|기타), amount, memo, source(chat|ocr|manual), metadata, created_at
                        (022 마이그레이션)
legal_knowledge_chunks — 다분야 법령 RAG (018) + search_legal_knowledge RPC (019)
legal_annual_values   — category (minimum_wage 등) + year + value(jsonb) — LLM cutoff 이후 법정 수치
                        (020_legal_annual_values.sql)
law_contract_knowledge_chunks / pattern_contract_knowledge_chunks / acceptable_contract_knowledge_chunks
                      — 계약서 공정성 분석 RAG 3종 (011) + search_{law,pattern,acceptable}_contract_knowledge RPC (012)
marketing_knowledge_chunks — 마케팅 지식 RAG (015) + hybrid RPC (016)
```

- `artifacts`는 대시보드/칸반의 모든 노드를 하나의 테이블로 통합한 DAG 구조.
- `kind === "anchor"` — 계정당 1개, 4개 도메인 허브의 부모.
- `kind === "domain"`:
  - **메인 허브** — `type` 필드 없음/기본값. 4개 (recruitment/marketing/sales/documents).
  - **서브 허브** — `type = 'category'`. **모든 계정 공통 18개 표준 세트** (`021_sales_records.sql` 이 `ensure_standard_sub_hubs` 를 재정의하며 Sales 에 **Revenue** 를 추가해 17 → 18 세트. `024_rename_contracts_to_review.sql` 이 Documents 쪽 `Contracts` → `Review` 로 재명명):
    - Recruitment: `Job_posting` · `Interviews` · `Onboarding` · `Evaluations`
    - Documents: `Review` · `Tax&HR` · `Legal` · `Operations`
    - Sales: `Revenue` · `Costs` · `Pricing` · `Customers` · `Reports`
    - Marketing: `Social` · `Blog` · `Campaigns` · `Events` · `Reviews`

**Documents 서브허브 역할** (v1.3 재정의, Step 3 에서 capability 5종 추가 완료):

| 서브허브       | 역할 | 담당 타입 |
| -------------- | ---- | --------- |
| **Review**     | 공정 중립이 필요한 서류의 **작성·검토**. 계약서·제안서 초안 생성 + 업로드된 기존 서류의 공정성 분석 (갑/을 비율 + 위험 조항). 견적서·제안서 등 비계약 서류도 Step 3-C 에서 분석 가능 (contract_subtype 없이 일반 관행 기반). | `contract` · `proposal` · `analysis` |
| **Tax&HR**     | 인사평가 관리 + 세무 관련 문서 (채용 제외). Step 3-A 에서 3종 capability 추가 — `doc_hr_evaluation` (인사평가서 5점 척도) · `doc_payroll_doc` (급여명세서·원천징수영수증·4대보험) · `doc_tax_calendar` (부가세·종소세·법인세·원천세·4대보험 연간 캘린더). | `checklist` · `guide` · `hr_evaluation` · `payroll_doc` · `tax_calendar` |
| **Legal**      | 법률 자문. 법령 RAG + `legal_annual_values` (연도별 최저임금·세율) 기반 조언 + 면책 고지. | `legal_advice` |
| **Operations** | 서류 초안 작성·행정 업무. 견적서·공지문. Step 3-B 에서 2종 capability 추가 — `doc_subsidy_application` (국가 지원사업 신청서, `search_subsidy_programs` RAG 후보 → CHOICES) · `doc_admin_application` (사업자등록·영업허가·식품영업신고·인허가 갱신 등 행정 신청서). | `estimate` · `notice` · `subsidy_application` · `admin_application` |

역할 구분 축은 **Planner 가 capability description 의 `[카테고리: …]` 힌트를 읽고 판정** 한다. Agent 내부의 2단 라우터(`detect_doc_intent` + `classify_legal_intent`)는 legacy 세이프티넷에서만 활성화.

- `kind === "artifact"` + `type === 'archive'` — 아카이브 폴더.
- 크로스 도메인 artifact 는 `domains` 에 여러 값 저장.

### Metadata 규약 (jsonb)

`artifacts.metadata` 공용 필드:

| key                | 타입     | 대상 kind          | 의미                                             |
| ------------------ | -------- | ------------------ | ------------------------------------------------ | --------------------- | ---------------------------- | ------ | ----------- | --------- | ---- |
| `pinned`           | boolean  | 전체               | 드래그 좌표 고정                                 |
| `position`         | {x,y}    | 전체               | pinned=true 일 때 좌표                           |
| `is_archive`       | boolean  | artifact           | 아카이브 폴더 여부                               |
| `count`            | number   | artifact(archive)  | 아카이브 자식 수                                 |
| `schedule_enabled` | boolean  | artifact           | 스케쥴 on/off (v1.2+ — 구 schedule 노드 대체)    |
| `schedule_status`  | `active  | paused`            | artifact                                         | 스케쥴 상태           |
| `cron`             | string   | artifact           | cron 표현식 (5필드)                              |
| `next_run`         | ISO dt   | artifact           | 다음 실행 예정 (UTC)                             |
| `executed_at`      | ISO dt   | artifact / log     | 실행 완료 시각                                   |
| `start_date`       | ISO date | artifact           | 기간성 시작일                                    |
| `end_date`         | ISO date | artifact           | 기간성 종료일                                    |
| `due_date`         | ISO date | artifact           | 마감일 (`end_date` 와 양자택일)                  |
| `due_label`        | string   | artifact           | due_date 의미 라벨 (스케쥴러 D-N 알림 문구 생성) |
| `contract_subtype` | enum     | artifact(contract) | `labor                                           | lease                 | service                      | supply | partnership | franchise | nda` |
| `analyzed_doc_id`  | uuid     | artifact(analysis) | 공정성 분석의 원본 문서 id                       |
| `gap_ratio`        | number   | artifact(analysis) | 갑/을 유불리 비율                                |
| `eul_ratio`        | number   | artifact(analysis) | 을 유불리 비율                                   |
| `risk_clauses`     | array    | artifact(analysis) | 위험 조항 리스트 + 수정 제안                     |
| `user_role`        | `갑      | 을                 | 미지정`                                          | artifact(analysis)    | 분석 시 사용자가 지정한 역할 |
| `platform`         | `karrot  | albamon            | saramin`                                         | artifact(job_posting) | 3종 플랫폼 공고 구분         |

- 반복 일정 = `schedule_enabled + cron + next_run`. 일회성 기간 = `start_date`/`end_date`/`due_date`.
- 일정 관리 모달은 (`metadata.schedule_enabled = true`) ∪ (`metadata.start_date|end_date|due_date` 하나 이상 있는 `kind='artifact'`) 를 통합 대상으로 한다.

모든 RLS 정책은 `auth.uid()` 기반. Supabase Auth 이메일 + 비밀번호 사용.

## Dashboard Layout (frontend, v1.0.0~)

> **캔버스는 v1.2 에서 완전히 삭제**됐다. `components/canvas/` 디렉토리 자체가 제거 (FlowCanvas, AnchorNode, DomainNode, ArtifactChipNode, 7개 모달 전부). `/dashboard` 는 Bento Grid, `/[domain]` 은 Kanban Board 를 기본 레이아웃으로 한다. `/canvas-legacy` route 도 제거.

### Bento Grid (`/dashboard`, `components/bento/BentoGrid.tsx`)

- **Root**: `flex w-full justify-center gap-4 p-4` — 왼쪽에 `ProfileMemorySidebar` (조건부, `min-[1500px]:flex`), 가운데 12-컬럼 그리드 (`max-w-[1400px]`), `md:auto-rows-[140px]`.
- **Layout map**: `ChatCenterCard` (col 1-6, row 1-4) · `DomainCard(recruitment)+DomainCard(sales)` (col 7-9) · `DomainCard(marketing)+DomainCard(documents)` (col 10-12) · `PreviousChatCard` (col 1-3, row 5-6) · `ScheduleCard` (col 4-6) · `ActivityCard` (col 7-12).
- **데이터 소스**: `GET /api/dashboard/summary?account_id=` — 도메인별 active/upcoming/recent 카운트 + 최근 제목 + upcoming 8 + recent_activity 10. `boss:artifacts-changed` CustomEvent 로 재조회.

### Dashboard Cards (공통 디자인 규약)

- 모든 카드 **`rounded-[5px]`** + `shadow-lg` + `hover:scale-[1.015] hover:shadow-xl` + `role="button"` (카드 전체 클릭 시 모달 열기).
- 내부 아이템은 `<button stopPropagation>` 으로 별도 액션.
- **빈 상태 문구** — 전역 `Nothing here yet` 하나로 통일.
- **글자 규칙** — 제목 `text-base font-semibold`, 본문 `text-[13px]`, 모노스페이스 메타 라벨 `text-[11px] uppercase`.
- **`ChatCenterCard`** — "I'm BOSS" 타이틀 + **SpeakerBadge** (v1.2+ 마지막 응답의 화자 표시) + `New Session` 버튼. 본문은 `InlineChat`.
- **`DomainCard`** — 제목 + `Active / Due / Recent` 3-열 통계 pill + 하단 최근 artifact 4개. 클릭 → `/[domain]` 라우트. 최근 아이템 클릭 → `useNodeDetail().openDetail(artifact_id)` (v1.2+).
- **`ScheduleCard`** — 상위 5개. 아이템 클릭 → `boss:open-schedule-modal`.
- **`ActivityCard`** — 상위 6개. 아이템 클릭 → `boss:open-activity-modal`.
- **`PreviousChatCard`** — 상위 4개 세션. 아이템 클릭 → `requestLoadSession(id)`.
- **`ProfileMemorySidebar`** — 세로 3:3:3 스택 (`ProfileCard` / `LongMemoryCard` / `MemosCard`). 각 카드 우상단 → 해당 모달 오픈 이벤트.

### Domain Page (`/[domain]` — `DomainPage.tsx`)

- DomainCard 클릭 시 `/recruitment` / `/marketing` / `/sales` / `/documents` 로 이동. Hero banner + `KanbanBoard`.
- `KanbanBoard` 는 해당 도메인의 서브허브를 컬럼으로 펼침. 미분류 artifact 는 "미분류" 컬럼. 드래그 → `PATCH /api/kanban/move` 로 `artifact_edges.relation='contains'` 부모 교체.
- **카드 클릭** → `useNodeDetail().openDetail(artifactId)` → 전역 `NodeDetailModal` 이 열림 (모든 도메인 공용).
- `boss:artifacts-changed` 리스너로 매출/비용 저장 후 자동 새로고침.
- **Kanban 테마 토큰** — `globals.css` 의 `.bento-shell` 스코프 CSS 변수 (`--kb-fg`, `--kb-border`, `--kb-surface`, `--kb-card`, `--kb-dday-urgent`, `--kb-dday-soon`, `--kb-warn-*`, `--kb-fg-on-banner` 등). `html[data-bg="dark"] .bento-shell` 에서 오버라이드.

### NodeDetailModal (v1.2+ 통합 상세 모달)

- `components/detail/NodeDetailContext.tsx` — `NodeDetailProvider` 가 앱 전체를 감싸고 `<NodeDetailModal />` 을 한 번만 마운트. `useNodeDetail()` 훅으로 어디서든 `openDetail(id)` / `closeDetail()` 호출 가능. 전역 CustomEvent `boss:open-node-detail {id}` 도 수신 (React 트리 외부에서도 트리거 가능).
- 지원 도메인/타입: 4개 도메인 모두. 특히:
  - `revenue_entry` / `cost_report` — 해당 날짜의 `sales_records` / `cost_records` 리스트 조회 + 인라인 편집(Pencil → PATCH) + 삭제(confirm → DELETE). v1.1 까지 있었던 별도 `SalesDetailModal` 은 삭제됨 — 이 통합 모달이 흡수.
  - 문서 분석(`analysis`) / SNS 포스트(`sns_post`) / 공고(`job_posting_set`) 등 도메인별 커스텀 프리뷰 블록.
- `app/providers.tsx` 에서 `<NodeDetailProvider>` 로 `children` 전체를 래핑.

### Inline Chat (`components/chat/InlineChat.tsx`)

- `ChatCenterCard` 안에 항상 마운트되는 풀 기능 채팅.
- 파일 업로드 (PDF/DOCX/XLSX/CSV/이미지, 20MB 제한), 이미지 OCR(`gpt-4o vision`), `[CHOICES]` 버튼, 분류 confirm, `[ACTION:OPEN_SALES_TABLE]` / `[ACTION:OPEN_COST_TABLE]` 인라인 테이블, Markdown 렌더, `ReviewResultCard` / `InstagramPostCard` / `ReviewReplyCard` / `ShortsWizardCard` / `PhotoLibraryModal` 전부 이식.
- **Empty state** — 메시지 0개일 때 `ASK THE CHATBOT.` + 4개 제안 프롬프트. 도메인당 10문항 풀에서 매 mount/새 세션/빈 세션 로드마다 랜덤 1개씩 샘플링.
- **로그인 브리핑 진입** — `BriefingLoader` 가 `sessionStorage.boss2:pending-briefing` → `useChat.openChatWithBriefing(content)` 호출.
- **세션 로드** — `useChat.requestLoadSession(id)` → `GET /api/chat/sessions/:id/messages` 로 하이드레이트. 응답의 `speaker` 배열도 메시지별로 복원돼 `SpeakerBadge` 가 리렌더.
- **"📋 상세 보기" 버튼** — Sales 저장 완료 메시지에서 `SalesInputTable` 결과 바로 아래에 표시. `useNodeDetail().openDetail()` 호출 (구 "캔버스에서 보기" 대체).

### SpeakerBadge (v1.2+, `components/chat/SpeakerBadge.tsx`)

- Props: `speakers: ("orchestrator"|"recruitment"|"marketing"|"sales"|"documents")[] | null`.
- `ChatCenterCard` 헤더에 렌더. 도메인별 색상 pill (bento `DOMAIN_META` 재활용). 오케스트레이터는 neutral gray. 값 없으면 "Ready" 플레이스홀더.

### ChatContext (`components/chat/ChatContext.tsx`)

- `useChat()` 훅 반환:
  - `registerSender(fn)` / `send(text)` — InlineChat 의 sender 등록/호출.
  - `currentSessionId` / `sessions` / `requestNewSession()` / `requestLoadSession(id)` — 세션 CRUD.
  - `newSessionTick` / `loadSessionTick` / `pendingLoadSessionId` — 이벤트 tick.
  - `pendingBriefing` / `openChatWithBriefing(content)` / `consumeBriefing()` — 브리핑 주입.
  - **`lastSpeaker` / `setLastSpeaker`** (v1.2+) — `SpeakerBadge` 구독용.

### Modal System

- `components/ui/modal.tsx` — `createPortal(..., document.body)`. `variant: "sand" | "dashboard"`.
  - `sand` (기본, `rounded-xl`) — 보존돼 있지만 현재 사용처 없음 (캔버스 모달 전부 삭제됨).
  - `dashboard` (`rounded-[5px] bg-[#f4f1ed]`) — 대시보드 모달 6종 + NodeDetailModal 에서 사용.
- **대시보드 모달 6종 (720×560 통일)** — `ChatHistoryModal` · `ScheduleManagerModal` · `ActivityModal` · `ProfileModal` · `LongTermMemoryModal` · `MemosModal`.
- **NodeDetailModal** (v1.2+) — 상기 도메인 통합 상세 모달.

### Header (`components/layout/Header.tsx`)

- 배경 솔리드 `#ffffff`. 좌측 BOSS 로고, 중앙 검색 버튼 (`⌘K`), 우측 `Schedule` / `Activity` / Light-Dark 토글 / `Logout`.
- **영어 UI** — 라벨/aria-label/tooltip 전부 영어.
- v0.9 까지 있던 `정렬(Layout)` 버튼은 v1.0 에서 제거.

### Custom Events (frontend 전역)

| 이벤트                         | 발행 위치                                                      | 구독 위치                | 페이로드         |
| ------------------------------ | -------------------------------------------------------------- | ------------------------ | ---------------- |
| `boss:artifacts-changed`       | `InlineChat` · `KanbanBoard` · 매출/비용 라우터 응답 후        | `BentoGrid` 등           | —                |
| `boss:open-schedule-modal`     | `ScheduleCard`                                                 | `Header`                 | —                |
| `boss:open-activity-modal`     | `ActivityCard`                                                 | `Header`                 | —                |
| `boss:open-chat-history-modal` | `PreviousChatCard`                                             | `Header`                 | —                |
| `boss:open-profile-modal`      | `ProfileMemorySidebar.ProfileCard`                             | `Header`                 | —                |
| `boss:open-longmem-modal`      | `ProfileMemorySidebar.LongMemoryCard`                          | `Header`                 | —                |
| `boss:open-memos-modal`        | `ProfileMemorySidebar.MemosCard` · `MemosCard` 아이템          | `Header`                 | —                |
| `boss:open-node-detail`        | 외부 트리거 (React 트리 밖)                                    | `NodeDetailContext`      | `{ id: string }` |
| `boss:focus-node`              | `SearchPalette` 등 (레거시 — 캔버스 삭제 후 no-op 경로도 있음) | `NodeDetailContext` 대체 | `{ id: string }` |

## Backend API 요약

Router mount 순서 (`backend/app/main.py`):
`auth → chat → activity → evaluations → schedules → artifacts → summary → dashboard → kanban → marketing → memory → memos → recruitment → search → uploads → reviews → costs → sales → stats`.

| prefix             | 주요 엔드포인트                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`        | `POST /session/touch` (로그인 브리핑)                                                                                                                                                                                                                                                       |
| `/api/chat`        | `POST /` / `GET,POST /sessions` / `GET /sessions/{id}/messages` / `PATCH,DELETE /sessions/{id}`                                                                                                                                                                                             |
| `/api/activity`    | `GET /` (활동 로그 페이지네이션)                                                                                                                                                                                                                                                            |
| `/api/evaluations` | `POST /` (up/down 평가 + 메모리 반영)                                                                                                                                                                                                                                                       |
| `/api/schedules`   | `POST /` (metadata.schedule_enabled 토글) · `PATCH /{id}` (cron+next_run) · `POST /{id}/run-now` · `GET /{id}/history` · `PATCH /{id}/status`                                                                                                                                               |
| `/api/artifacts`   | `DELETE /{id}` (DAG 재배선) · `PATCH /{id}` · `PATCH /{id}/pin` · `GET /{id}/detail`                                                                                                                                                                                                        |
| `/api/summary`     | `POST /` (30일 활동 요약)                                                                                                                                                                                                                                                                   |
| `/api/dashboard`   | `GET /summary?account_id=` (Bento 데이터 소스)                                                                                                                                                                                                                                              |
| `/api/kanban`      | `GET /{domain}?account_id=` · `PATCH /move` (서브허브 간 카드 이동)                                                                                                                                                                                                                         |
| `/api/marketing`   | `POST /image` (DALL·E 3) · `POST /blog/upload` (네이버 블로그 Playwright) · `POST /review/analyze` · `POST /instagram/publish` · `GET,POST,DELETE /photos` · YouTube OAuth(`/youtube/oauth/*`) + Shorts(`/youtube/shorts/preview-subtitles`, `/youtube/shorts/generate`) · `GET /subsidies` |
| `/api/memory`      | `PATCH /long/{id}` · `DELETE /long/{id}` · `POST /boost` (v1.2+ 신규)                                                                                                                                                                                                                       |
| `/api/memos`       | `GET,POST /` · `PATCH,DELETE /{id}`                                                                                                                                                                                                                                                         |
| `/api/recruitment` | `POST /poster` · `POST /wage-simulation`                                                                                                                                                                                                                                                    |
| `/api/search`      | `GET /?q=` (하이브리드)                                                                                                                                                                                                                                                                     |
| `/api/uploads`     | `POST /document` (multi-file, 20MB) · `PATCH /document/{id}/classification` (legacy no-op)                                                                                                                                                                                                  |
| `/api/reviews`     | `POST /` (계약서 공정성 분석 트리거)                                                                                                                                                                                                                                                        |
| `/api/costs`       | `POST /` · `GET /` · `GET /summary` · `PATCH,DELETE /{id}`                                                                                                                                                                                                                                  |
| `/api/sales`       | `POST /` · `GET /` · `GET /summary` · `PATCH,DELETE /{id}` (v1.0 `/api/sales/ocr` 은 제거 — OCR 은 agent capability 로 이전)                                                                                                                                                                |
| `/api/stats`       | `GET /overview` (당월 매출·비용·순이익 + MoM) · `GET /monthly-trend` · `GET /daily` · `GET /top-items`                                                                                                                                                                                      |

## Mock Data

- `test@test.com` 계정에 [MOCK] 프리픽스 시드. 스크립트는 `supabase/seed/seed_mock_data.sql` / `cleanup_mock_data.sql`.
- 020 마이그레이션 이후 기존 `kind='schedule'` 노드는 모두 사라지고 부모 artifact 의 metadata 로 흡수됐다. 새 시드 스크립트 작성 시 schedule 노드를 만들지 말 것.

## Code Conventions

- Frontend: 모든 함수는 arrow function. React 는 function component.
- Backend: `async def` 기본, Pydantic v2 (`BaseModel`, `field_validator`).
- API 응답은 `{ data, error, meta }` 구조.
- 에러는 FastAPI `HTTPException`.
- 환경변수는 `backend/app/core/config.py` 의 `Settings`.
- 임베딩은 반드시 `app/core/embedder.py` 를 통해서만.
- OpenAI API 호출은 `app/core/llm.py` 를 통해서만 (`chat_completion` + `planner_completion`). Planner 는 `PLANNER_PROVIDER=anthropic` 일 때 Anthropic 으로 스왑.
- ContextVar 기반 per-request state 3종 (`_speaker_context`, `_upload_context`, `_sales_context`) 은 chat router 가 `clear_*` 호출로 반드시 정리해야 함.

## Dev Workflow

1. DB 스키마 변경 → `supabase/migrations/` 에 SQL 파일 추가 → Supabase MCP 로 실행
2. Mock 데이터는 `supabase/seed/` 에서 관리
3. Backend 먼저 개발 → Frontend 연동
4. 새 capability 추가 시 → 도메인 에이전트의 `describe(account_id)` 에 항목 추가 → `run_*` 핸들러 구현

### Migration File Layout (v1.2.0 기준)

```
supabase/migrations/
  001_extensions.sql                  # pgcrypto, uuid-ossp, vector, pg_trgm
  002_schema.sql                      # 기본 테이블 (profiles/artifacts/embeddings/memory_*/
                                      # activity_logs/schedules/task_logs/evaluations/
                                      # chat_sessions/chat_messages)
  003_indexes.sql                     # ivfflat + GIN + btree
  004_rls.sql                         # Row Level Security
  005_functions_triggers.sql          # bootstrap_workspace, hybrid_search, memory_search
  006_expand_embeddings_source_type.sql  # schedule/log/hub 확장 + upsert_embedding RPC
  007_memos.sql                       # memos 테이블 + RLS + memo source_type
  008_expand_activity_log_types.sql   # schedule_run / schedule_notify 추가
  009_profile_last_seen.sql           # profiles.last_seen_at
  010_profile_expansion.sql           # profiles core 7 필드 + profile_meta
  011_contract_knowledge.sql          # 계약서 RAG 테이블 3종
  012_contract_knowledge_search.sql   # 3-way RRF RPC 3종
  013_artifact_edges_analyzed_from.sql  # analyzed_from relation
  014_standard_sub_hubs.sql           # 17종 표준 서브허브 (이후 021 에서 Revenue 추가로 18종)
  015_marketing_knowledge.sql         # marketing 지식 테이블
  016_marketing_rag.sql               # marketing 하이브리드 검색 RPC
  017_marketing_subhubs.sql           # marketing 서브허브 확장
  018_legal_knowledge.sql             # legal_knowledge_chunks
  019_legal_knowledge_search.sql      # search_legal_knowledge RPC
  020_legal_annual_values.sql         # 연도별 법정 수치 테이블
  020_schedule_to_metadata.sql        # schedule 노드 → metadata 인라인 통합, kind CHECK 갱신
  021_sales_records.sql               # sales_records 테이블 + Revenue 서브허브 추가
  022_cost_records.sql                # cost_records 테이블
  023_chat_messages_speaker.sql       # chat_messages.speaker text[]
  024_rename_contracts_to_review.sql  # Documents 서브허브 Contracts → Review 재명명
                                      # + ensure_standard_sub_hubs 재정의
  025_memory_long_rrf_digest.sql      # memory_long 도메인×일자 digest + RRF + FTS + 7일 TTL
                                      # upsert_memory_long / memory_search(query_text) 재작성
```

> 두 파일이 같은 020 프리픽스를 갖지만 Supabase MCP 는 파일명 알파벳 순서로 실행한다 (`020_legal_annual_values.sql` → `020_schedule_to_metadata.sql`). 운영상 충돌 없음.

### documents 에이전트 자산

```
backend/app/agents/
├── _doc_templates.py         # TYPE_SPEC + SKELETONS + build_doc_context + detect_doc_intent
├── _doc_review.py            # analyze + dispatch_review (RAG 3-way + gpt-4o-mini JSON)
├── _doc_classify.py          # 업로드 문서 분류 (keyword + gpt-4o-mini 폴백)
├── _legal.py                 # classify_legal_intent + handle_legal_question (RPC + legal_annual_values)
└── _doc_knowledge/
    ├── labor/{acceptable,risks}.md
    ├── lease/{acceptable,risks}.md
    ├── service/{acceptable,risks}.md
    ├── supply/{acceptable,risks}.md
    ├── partnership/{acceptable,risks}.md
    ├── franchise/{acceptable,risks}.md
    └── nda/{acceptable,risks}.md     # v1.3 Step 3-D 에서 보강

backend/app/core/
├── doc_parser.py             # PDF / DOCX / TXT / RTF / XLSX·CSV → 텍스트 추출
├── ocr.py                    # gpt-4o vision 이미지 OCR
└── poster_gen.py             # 채용 공고 HTML 포스터 생성 (플랫폼별 비율)

backend/app/routers/
├── uploads.py                # POST /api/uploads/document (multi-file, 20MB) — artifact 를 만들지 않고 ephemeral payload 반환
└── reviews.py                # POST /api/reviews — dispatch_review 래퍼
```

업로드/분석/입력 artifact 타입:

- `type='uploaded_doc'` — (v1.0 이후 신규 생성 없음, 기존 데이터 호환용) 예전 업로드 원본.
- `type='analysis'` — 공정성 분석. `metadata: {analyzed_doc_id, gap_ratio, eul_ratio, risk_clauses[], user_role, contract_subtype}`. 원본과 `analyzed_from` 엣지.
- `type='legal_advice'` — Legal 서브허브 아래 저장. 법령 근거 + 면책 고지.
- `type='revenue_entry'` / `type='cost_report'` — 매출/비용 기록. 실제 레코드는 `sales_records` / `cost_records` 테이블, artifact 는 캔버스/칸반에서 보이는 "카드" 역할. NodeDetailModal 에서 날짜별 레코드 리스트 조회.
- `type='job_posting_set'` / `type='job_posting'` / `type='job_posting_poster'` — 채용 3종 플랫폼 공고 + HTML 포스터.

### 임베딩 백필

```
cd backend
python scripts/backfill_embeddings.py                  # 미인덱싱 행만
python scripts/backfill_embeddings.py --force          # 전체 재인덱싱
python scripts/backfill_embeddings.py --account-id <UUID>
```

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

- 인증은 Supabase Auth 만 사용 — 커스텀 auth 로직 추가 금지.
- Supabase 쿼리는 public 스키마 직접 사용 — `.schema()` 호출 금지.
- Supabase RLS 반드시 활성화 — 모든 쿼리는 `auth.uid()` 기반.
- `kind='schedule'` 노드는 더 이상 만들지 않는다. 스케쥴은 부모 artifact 의 metadata 로 표현.
- 도메인 에이전트 간 직접 호출 금지. 오케스트레이터 또는 capability 경로만 사용.
