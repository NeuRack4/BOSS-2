# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] — fix/sales-input-error (Sales revenue_entry 서브허브 오분류 수정)

### Fixed — Sales

- **`backend/app/agents/sales.py`** — `_TYPE_TO_SUBHUB` 에서 `revenue_entry` 가 `"Reports"` 로 잘못 매핑되던 버그 수정 → `"Revenue"` 로 정정. 매출 입력 artifact 가 Reports 서브허브가 아닌 Revenue 서브허브에 정상 저장됨.
- **`backend/app/agents/_sales/_revenue.py`** — `dispatch_save_revenue()` 내 서브허브 조회 쿼리에서 `ilike("%Reports%")` → `ilike("%Revenue%")` 로 수정. revenue_entry artifact 생성 시 Revenue 서브허브에 `contains` 엣지가 올바르게 연결됨.

## [1.2.0] — feature-documents (Planner-driven orchestrator + Sales v2 + Node 통합 상세 + 캔버스 제거)

v1.0.0 이후 `feature/sales-analytics` / `feature/sales-ocr` / `feature-documents` 세 브랜치 작업을 하나의 릴리스로 묶음. 오케스트레이터를 **JSON-schema 플래너 주 경로**로 재설계하고, **캔버스(React Flow)를 완전 제거**했으며, Sales 도메인을 서브패키지로 재구성하고 매출/비용 실 데이터 테이블(`sales_records` / `cost_records`) 을 도입했다.

### Added — Orchestrator / Planner

- **`backend/app/agents/_planner.py`** — 신규. `response_format=json_schema` 강제 플래너. 매 턴 `{mode: dispatch|ask|chitchat|refuse|planning, opening, brief, steps[], question, choices, profile_updates}` 구조화 JSON 생성. `PLANNER_PROVIDER=openai|anthropic` 으로 OpenAI(gpt-4o-mini 기본) 또는 Claude 스왑.
- **`orchestrator.run()`** — 2단 구조로 재작성. 1차: `_dispatch_via_planner` — tools catalog + memos 컨텍스트와 함께 planner 호출 → `dispatch` 모드면 `depends_on` 기반 병렬(`asyncio.gather`) 또는 순차 step 실행 + `opening` + `tool_reply` 합성. 2차 (planner 실패·에러 시): legacy `classify_intent` + `_call_domain_with_shortcut` 세이프티넷.
- **`_capability.V2_DOMAINS`** — sales 합류해 `("recruitment", "documents", "marketing", "sales")` **4개 도메인 전부 function-calling 로 통일**. `describe_all(account_id)` 가 도메인별 `describe(account_id) -> list[Capability]` 를 모아 OpenAI tools 스펙 + dispatch map 조립.
- **`backend/app/agents/_speaker_context.py`** — 신규. per-request ContextVar `set/get/clear_speaker`. 오케스트레이터가 경로별로 화자 배열 기록 → chat router 가 `chat_messages.speaker` 저장 + `ChatResponse.data.speaker` 반환.
- **`backend/app/agents/_upload_context.py`** — 신규. per-request ContextVar. chat router 의 `req.upload_payload` 를 documents agent 에 전달. v1.0 이후 업로드는 artifact 를 만들지 않고 payload 만 전달한다.
- **`backend/app/agents/_sales_context.py`** — 신규. per-request ContextVar 2종 (`pending_receipt`, `pending_save`). sales agent 의 영수증 OCR / 인라인 테이블 저장 흐름에 사용.
- **Profile updates 플래너 통합** — Planner 가 `profile_updates` 필드를 매 턴 생성하면 orchestrator 가 즉시 `_save_profile_updates` 로 저장. core(7) 와 meta 분리 + `business_stage`/`channels` enum 검증.

### Added — Sales 도메인 v2

- **`backend/app/agents/_sales/` 서브패키지** — 신규.
  - `_revenue.py` · `dispatch_save_revenue(account_id, items, recorded_date, source)` — 5분 윈도 items_hash idempotent dedup → `sales_records` insert → revenue_entry artifact + Reports 서브허브 `contains` 엣지 + 임베딩 인덱싱 + `activity_logs.artifact_created`.
  - `_costs.py` · 동일 패턴. 카테고리 enum `재료비|인건비|임대료|공과금|마케팅|기타`.
  - `_ocr.py` · `parse_receipt_from_bytes(file_bytes, mime_type) -> {type: "sales"|"cost", items}` — gpt-4o vision. 영수증/명세서를 자동으로 매출/비용 분류.
- **`backend/app/agents/sales.py`** — `describe(account_id)` export. 8종 capability(`sales_revenue_entry`, `sales_cost_entry`, `sales_parse_receipt`, `sales_save_revenue`, `sales_save_costs`, `sales_report`, `sales_price_strategy`, `sales_customer_script`, `sales_promotion`, `sales_checklist`). `[ACTION:OPEN_SALES_TABLE]` / `[ACTION:OPEN_COST_TABLE]` 마커 프로토콜로 프론트 인라인 테이블 트리거.
- **`supabase/migrations/021_sales_records.sql`** — 신규. `sales_records(id, account_id, recorded_date, item_name, category, quantity, unit_price, amount, source, raw_input, metadata)` + RLS + `idx_sales_records_account_date` + `ensure_standard_sub_hubs` 재정의(Sales 에 **Revenue** 서브허브 추가 → 총 18종) + 전 계정 backfill.
- **`supabase/migrations/022_cost_records.sql`** — 신규. `cost_records(id, account_id, recorded_date, item_name, category, amount, memo, source, metadata)` + RLS + `idx_cost_records_account_date`.
- **`backend/app/routers/sales.py` · `costs.py`** — `POST /` (bulk insert, `_sales._revenue/_costs.dispatch_save_*` 델리게이트) · `GET /` · `GET /summary` (day/week/month 집계 + by-item + by-category) · `PATCH /{id}` (ownership + 재임베딩) · `DELETE /{id}` (임베딩 제거). `/api/sales/summary` 쿼리 정렬 `recorded_date` → `created_at DESC` 로 수정.
- **`backend/app/routers/stats.py`** — 통계 API 4종. `GET /api/stats/overview` (당월 + MoM + 일평균) · `/monthly-trend` (N개월 시계열) · `/daily` (월별 일자 시리즈, 누락 0 채움) · `/top-items` (기간 랭킹). `sales_records` + `cost_records` 기반.

### Added — NodeDetailModal 통합 상세 (캔버스 대체)

- **`frontend/components/detail/NodeDetailContext.tsx`** — 신규. `NodeDetailProvider` 가 앱 전역에 `<NodeDetailModal />` 을 한 번만 마운트. `useNodeDetail().openDetail(id)` / `closeDetail()` 훅 + 전역 CustomEvent `boss:open-node-detail {id}` 수신.
- **`frontend/components/detail/NodeDetailModal.tsx`** — 신규. 4개 도메인 통합 상세 모달. `revenue_entry` / `cost_report` 는 해당 날짜 `sales_records`/`cost_records` 리스트 조회 + 인라인 편집(Pencil → PATCH) + 삭제(confirm → DELETE). 분석/SNS/공고 등 도메인별 커스텀 프리뷰 블록 포함.
- **`frontend/app/providers.tsx`** — `NodeDetailProvider` 로 `children` 전체 래핑.
- **`frontend/components/chat/SpeakerBadge.tsx`** — 신규. Props: `speakers: SpeakerKey[] | null`. ChatCenterCard 헤더에 도메인 색상 pill 렌더. 값 없으면 "Ready" placeholder.
- **`frontend/components/chat/ChatContext.tsx`** — `lastSpeaker` / `setLastSpeaker` 추가. InlineChat 이 매 응답마다 `speaker` 배열 업데이트.

### Added — Memory CRUD

- **`backend/app/routers/memory.py`** — 신규. `PATCH /api/memory/long/{id}` (내용 수정 + 재임베딩) · `DELETE /api/memory/long/{id}` · `POST /api/memory/boost` (artifact 요약을 장기 기억에 pin, importance 0.2-1.0).
- **`backend/app/main.py`** — `memory.router` 등록.

### Added — Migrations

- **`supabase/migrations/020_legal_annual_values.sql`** — 신규. `legal_annual_values(category, year, value jsonb, source_*, effective_from, unverified)` 테이블. 매년 갱신되는 법정 수치(최저임금/VAT 간이 기준/소득세 누진/보험료율 등) 을 LLM cutoff 너머까지 제공. `_legal.py` 가 system prompt 에 주입.
- **`supabase/migrations/020_schedule_to_metadata.sql`** — 신규. **`kind='schedule'` 별도 노드 체계 폐기**. 각 `scheduled_by` 엣지에 대해 자식 schedule 의 `metadata(cron/next_run/executed_at/status)` 를 부모 artifact 의 metadata 로 병합 (`schedule_enabled=true` + `schedule_status`). `logged_from` 엣지를 부모로 재포인트(중복 제거 포함). `kind='schedule'` artifact + embeddings 삭제. `artifacts_kind_check` CHECK 에서 `schedule` 제거 — 이후 4개 kind(`anchor|domain|artifact|log`).
- **`supabase/migrations/023_chat_messages_speaker.sql`** — 신규. `chat_messages.speaker text[]` 컬럼 추가. orchestrator/domain agent(들)이 생성한 assistant 메시지의 화자 기록. user/system 메시지는 null.

### Added — Documents / Marketing

- **`backend/app/agents/_legal.py`** — `legal_annual_values` 테이블 조회 통합. 질문의 카테고리+연도 감지 시 확정 수치를 system prompt 주입.
- **`backend/app/agents/_doc_classify.py`** — 업로드 문서 자동 분류(`documents|receipt|invoice|tax|id|other`). 키워드 스코어링 + gpt-4o-mini JSON 폴백.
- **`backend/app/routers/marketing.py`** — Instagram Meta Graph API 자동 게시(`POST /instagram/publish`), DALL·E 3 이미지 생성(`POST /image`), 리뷰 분석(`POST /review/analyze`), 사진 라이브러리(`GET,POST,DELETE /photos`), YouTube OAuth + Shorts 4-step(`/youtube/oauth/*`, `/youtube/shorts/preview-subtitles`, `/youtube/shorts/generate`), Subsidy 검색(`GET /subsidies`).
- **`frontend/components/chat/ShortsWizardCard.tsx`** — 신규. 4-step 위저드 (사진 업로드 → 자막 편집 → 설정 → 생성). YouTube 연결 상태 + 이중 출력(YouTube URL + 클라우드 URL).
- **`frontend/components/chat/PhotoLibraryModal.tsx`** — 신규. `/api/marketing/photos` 구독. 업로드/삭제/최근 자동 선택. InstagramPostCard 에서 사용.

### Added — Scheduler

- **`backend/app/scheduler/scanner.find_due_schedules`** — 쿼리 대상을 `kind='artifact' AND metadata->>schedule_enabled='true' AND metadata.schedule_status in (null,'active')` 로 전환. 더 이상 `kind='schedule'` 을 참조하지 않음.
- **`backend/app/scheduler/log_nodes.create_log_node`** — 부모 artifact 기준으로 `logged_from` 엣지 생성 (구 schedule 노드 부모 경유 사라짐).
- **스케쥴러 알림 문자열** — `metadata.due_label`(계약 만료/납품기한 등) + `metadata.start_date`/`due_date` D-7/D-3/D-1/D-0 오프셋 기반.

### Changed

- **`backend/app/routers/chat.py`** — Planner 경로 통합. `req.upload_payload` / `req.receipt_payload` / `req.save_payload` 를 ContextVar 3종(`_upload_context` / `_sales_context.pending_receipt` / `pending_save`) 에 set → orchestrator.run() → finally 에서 clear. `get_speaker()` 로 화자 회수 → `short_term.append_message(speaker=...)` + 응답 `speaker` 필드. 첫 user 메시지면 `sessions.generate_title` 백그라운드 태스크.
- **`backend/app/memory/short_term.append_message`** — `speaker: list[str] | None = None` 파라미터 추가. assistant 메시지일 때만 저장.
- **`backend/app/memory/sessions.py`** — `get_session_messages` 가 `speaker` 필드를 함께 반환 → 세션 복구 시 프론트가 SpeakerBadge 하이드레이트.
- **`backend/app/routers/uploads.py`** — **v1.0 이후 업로드 artifact 를 만들지 않는다**. `POST /api/uploads/document` 는 multi-file(20MB 각) 을 받아 파싱 + 분류 + ephemeral `upload_payload` 딕셔너리만 응답. 프론트가 그걸 다음 chat 요청 `upload_payload` 에 동봉해 보내면 documents agent 가 `_upload_context.get_pending_upload()` 로 직접 소비. `PATCH /document/{id}/classification` 은 legacy (artifact 없으면 no-op) 로 유지.
- **`backend/app/agents/sales.py`** — `_TYPE_TO_SUBHUB["revenue_entry"]` `Revenue` → `Reports` (기존 Revenue 서브허브는 021 이후 입력 전용 전환, 리포트/카드 UI 는 Reports 아래 유지).
- **`frontend/components/bento/KanbanBoard.tsx`** — `boss:artifacts-changed` CustomEvent 리스너 추가. 카드 클릭 시 `useNodeDetail().openDetail(artifactId)` 로 통합 모달 오픈.
- **`frontend/components/bento/KanbanCard.tsx`** — CSS 변수 (`var(--kb-border)` 등) + 조건부 `cursor-pointer` + `rounded-xl` → `rounded-[5px]`.
- **`frontend/components/chat/InlineChat.tsx`** — Sales 저장 후 `savedArtifactMeta { type, recordedDate, title }` + `savedDomain` 메시지 필드 추가. 구 "캔버스에서 보기" → "📋 상세 보기" → `useNodeDetail().openDetail()`. 영수증 이미지 업로드 시 receipt 분류 자동 감지 → `_sales._ocr.parse_receipt_from_bytes` (capability `sales_parse_receipt`) → 파싱 결과를 salesAction/costAction 마커로 표시.
- **`frontend/components/chat/CostInputTable.tsx` · `SalesInputTable.tsx`** — 편집/삭제 액션 + API 호출 경로 정리.
- **`frontend/components/layout/*Modal.tsx`** — `ActivityModal` / `LongTermMemoryModal` / `MemosModal` / `ScheduleManagerModal` — NodeDetailModal 전환 + 영어 UI 최종 정리.
- **`frontend/components/search/SearchPalette.tsx`** — 결과 클릭 시 `boss:focus-node` → NodeDetailContext 수신해 openDetail 로 전환.

### Removed

- **`frontend/components/canvas/` 전체 삭제** — `FlowCanvas.tsx` · `AnchorNode.tsx` · `DomainNode.tsx` · `ArtifactChipNode.tsx` · `FilterContext.tsx` · `FloatingFilterPanel.tsx` · `HoverInfoPanel.tsx` · `NebulaBackground.tsx` · `NodeContextMenu.tsx` · `floatingPanels.ts` · `layout.ts` + 7개 모달(`NodeDetailModal` · `DateRangeModal` · `ConfirmModal` · `SummaryModal` · `ScheduleModal` · `LogDetailModal` · `HistoryModal`). 캔버스 UI 는 v1.2 에서 Bento + Kanban + 통합 NodeDetailModal 로 완전 대체.
- **`frontend/components/sales/SalesDetailModal.tsx` 삭제** — `components/detail/NodeDetailModal.tsx` 에 흡수.
- **`backend/app/routers/sales_ocr.py` 삭제** — `POST /api/sales/ocr` REST 엔드포인트 대신 `_sales._ocr.parse_receipt_from_bytes` 를 `sales_parse_receipt` capability 로 노출. 채팅 흐름 안에서 영수증 이미지를 그대로 보내면 planner 가 해당 capability 로 라우팅.
- **`kind='schedule'` artifact + `scheduled_by` 관계** — 020 마이그레이션으로 모두 흡수. 이후 신규 insert 없음.
- **DELETE all `[Unreleased]` entries** — v1.0 ~ v1.2 사이 누적된 feature 브랜치들이 전부 이 릴리스로 통합됨.

### Docs

- `docs/OCR_면접준비.md` — OCR 파이프라인 개념 정리.
- `docs/Sales_작업계획_학습가이드.md` — Sales 미구현 항목 분석 및 v1.2 구현 계획.
- `docs/개인학습_멘토질문대비.md` — 개념 정리 + 예상 질문/답변.
- **`CLAUDE.md` 전면 재작성** — Planner 주 경로 / 4개 도메인 function-calling / 18종 서브허브 / schedule 노드 제거 / NodeDetailModal 통합 / speaker 추적 / 020-023 마이그레이션 반영.
- **`README.md` 전면 재작성** — 버전 배지 1.2.0, 아키텍처 다이어그램·Key Features·Project Structure·Backend API 표·migration 목록 모두 현재 상태로 갱신.

---

## [1.0.0] — feature-documents (Bento 대시보드 + Inline Chat + UI 영어화)

### Added — Bento Dashboard (`/dashboard`)

- **`BentoGrid.tsx`** — 12-열 grid 레이아웃. 상단: `ChatCenterCard` (6×4) + DomainCard 4개 (3×4, 2열 × 2컬럼). 하단: `PreviousChatCard` + `ScheduleCard` + `ActivityCard` (3:3:6 비율).
- **`ProfileMemorySidebar.tsx`** — `min-[1500px]:flex` 좌측 세로 사이드바. 3:3:3 비율로 `ProfileCard` / `LongMemoryCard` / `MemosCard` 3장 스택. 각 카드 우상단 `ArrowUpRight` 버튼만 모달을 열고, 빈 공간/아이템 본문 클릭은 별개 stopPropagation 버튼에 할당.
- **`DomainCard.tsx` 통계 블록** — Active / Due / Recent 3-열 그리드 (큰 숫자 + 모노스페이스 uppercase 라벨, 세로 divider). 제목 바로 아래 배치. 최근 항목은 `mt-auto flex flex-col justify-end` 로 카드 하단에서 위로 쌓임(최신이 맨 위), 최대 4개 pill.
- **대시보드 모달 6종 (720×560 통일)** — `ChatHistoryModal` / `ScheduleManagerModal` / `ActivityModal` / `ProfileModal` / `LongTermMemoryModal` / `MemosModal`. 모두 `rounded-[5px]` + `variant="dashboard"` (배경 `#f4f1ed`, 잉크 `#030303`, 테마 고정).
- **`ChatHistoryModal.tsx` 세션 CRUD** — 세션 목록 + 각 row hover 시 🗑 버튼. 클릭 → confirm → `DELETE /api/chat/sessions/:id` → 로컬 상태 + 현재 세션이 삭제된 경우 `requestNewSession()`.
- **`ProfileModal.tsx`** — `profiles` 테이블 core 7필드 + `profile_meta` 추가 필드 섹션.
- **`LongTermMemoryModal.tsx`** — `memory_long` importance desc 200개, 별점 표시.
- **`MemosModal.tsx`** — 2열 그리드 카드. artifact 제목 pill + 본문 + 상대시간.

### Added — Inline Chat (`InlineChat.tsx`)

- 구 `ChatOverlay` (1,641줄, 풀스크린 모달) 의 전체 기능을 `ChatCenterCard` 안으로 인라인 이식: 메시지 히스토리, 파일 업로드 (PDF/DOCX/이미지 + 리뷰 이미지 `gpt-4o vision` OCR), `[CHOICES]`, 분류 confirm, `[ACTION:OPEN_SALES_TABLE]` / `[ACTION:OPEN_COST_TABLE]` 버튼, Markdown, `ReviewResultCard` / `InstagramPostCard` / `ReviewReplyCard`, 세션 로드/새 대화 tick 반응, 로그인 브리핑 흡수.
- **Empty state** — 메시지가 0개일 때 카드 중앙에 `ASK THE CHATBOT.` + 4개 제안 프롬프트 세로 스택 (좌측 50% 폭). 매 mount / 새 세션 / 빈 세션 로드마다 `pickSuggested()` 가 도메인별 10개 풀(40개)에서 도메인당 1개씩 랜덤 샘플링.
- **ChatCenterCard 헤더** — "I'm BOSS" 타이틀 + 우상단 "New Session" 버튼 (`MessageSquarePlus`). 클릭 시 `requestNewSession()`.

### Added — `Modal` Portal + `dashboard` variant (`ui/modal.tsx`)

- `createPortal(..., document.body)` — 헤더의 `backdrop-filter: blur(12px)` 가 `position: fixed` 의 containing block 을 만들어 모달/검색 팔레트가 헤더 안에 갇히던 버그 수정.
- `variant: "sand" | "dashboard"` prop — sand 기본값(기존 캔버스 7개 모달 영향 없음) + dashboard (`rounded-[5px]` / `bg-[#f4f1ed]` / `border-[#030303]/10` / 잉크 글자) 추가.

### Changed — Kanban 테마 토큰 (`globals.css` + `bento/Kanban*.tsx`)

- 하드코딩된 `text-white/…`, `bg-white/[0.0x]`, `border-white/[0.0x]` 를 CSS 변수(`--kb-fg`, `--kb-border`, `--kb-surface`, `--kb-card`, `--kb-dday-urgent/soon`, `--kb-warn-*`, `--kb-fg-on-banner` 등) 로 치환. `html[data-bg="dark"] .bento-shell` 에서 오버라이드하여 light/dark 토글 둘 다 제대로 보이게 수정.
- DomainPage hero banner 곡률 `rounded-3xl` → `rounded-[5px]`, 흰 글자(`#ecdbca` 탠 배경 위 흰 글자 버그) → `var(--kb-fg-on-banner)` 짙은 잉크로 고정.

### Changed — Header (`layout/Header.tsx`)

- **Layout 버튼 제거** (`boss:reset-layout` 이벤트 발행자 소멸, FlowCanvas 수신자만 남음).
- 배경을 `rgba(255,255,255,0.85)` + `backdrop-filter: blur(12px)` → 솔리드 `#ffffff` 로 변경 (light/dark 테마 무관 화이트 고정).
- 모든 라벨/aria-label/tooltip 영어화: `정렬 → Layout`(삭제됨) / `일정 관리 → Schedule` / `활동이력 → Activity` / `배경 밝게/어둡게 → Switch to light/dark` / `로그아웃 → Logout` / 검색창 placeholder `노드·메모 검색… → Search…`.

### Changed — 대시보드 UI 영어화 / 공통 곡률

- 모든 카드 + 모달 + 모달 내 내부 박스 `rounded-lg / rounded-md / rounded-xl` → `rounded-[5px]` 통일.
- 벤토 카드 글자 크기 전반 상향: 제목 `text-sm → text-base`, 본문 `text-xs → text-[13px]`, 모노스페이스 라벨 `text-[10px] → text-[11px]`, DomainCard 통계 숫자 `text-base → text-lg`.
- Empty-state 문구 **하나의 표현 `Nothing here yet` 으로 통일** (bento 카드, 모달, 검색 팔레트, 칸반 컬럼·보드, 캔버스 모달, NodeDetailModal 매출/비용/메모 3곳 등).
- 대시보드 모달 3종(ChatHistory/Schedule/Activity) 전체 한글 UI 영어화 + `FilterContext.DOMAIN_LABEL` 영어화(`채용 → Recruitment`, `마케팅 → Marketing`, `매출 → Sales`, `서류 → Documents`).
- 검색 팔레트 UI/Tooltip 영어화 (`Search nodes, content, memos…` / `↑↓ navigate` / `↵ open` / `Searching…` / `memo match` / `N results`).
- ActivityCard / PreviousChatCard / ChatHistoryModal `formatRelative` 영어화 (`just now` / `Nm ago` / `Nh ago` / `Nd ago` / `en-US` 로케일).

### Changed — Context 및 이벤트

- **`ChatContext.tsx` 단순화** — `isChatOpen` / `openChat` / `closeChat` / `seedText` / `consumeSeed` 제거 (InlineChat 이 항상 마운트되어 있어서 "열기" 개념 불필요). `registerSender` / `send` / `requestLoadSession` / `requestNewSession` / `openChatWithBriefing` 는 유지.
- **CustomEvent 추가** — `boss:open-chat-history-modal`, `boss:open-profile-modal`, `boss:open-longmem-modal`, `boss:open-memos-modal`. Header 에서 모두 수신.
- **ScheduleCard / ActivityCard 아이템 클릭** → 각 모달 열기(`stopPropagation` 으로 카드 자체 이벤트와 분리). **PreviousChatCard 세션 아이템** → `requestLoadSession(id)` 직접 호출 (canvas 가 대시보드에 없으므로 `boss:focus-node` 는 의도적으로 사용 안 함).

### Removed

- **`frontend/app/canvas-legacy/`** 디렉토리 삭제 (route 제거).
- **`components/chat/ChatOverlay.tsx`** 삭제 (1,641줄 → `InlineChat.tsx` 로 이식).
- **`components/bento/AdBanner.tsx`** 사용처 제거 (BentoGrid 에서 `ProfileMemorySidebar` 로 교체).
- **`ChatCenterCard`** — "전체 열기" 버튼 제거 (오버레이 경로 소멸).

### Backend

- **`backend/app/routers/dashboard.py`** — `recent_titles` 상위 3개 → 5개 확대 (큰 도메인 카드에서 여유 표시).

---

## [Unreleased] — feature-marketing (사진 라이브러리 + YouTube Shorts 제작)

### Added

**`supabase/migrations/022_business_photos.sql`**

- `business_photos` 테이블 — `account_id, storage_path, public_url, name, size_bytes`. RLS `auth.uid()` 기반.
- Supabase Storage `business-photos` 버킷 (public, 10MB 제한).

**`supabase/migrations/023_youtube_oauth_tokens.sql`**

- `youtube_oauth_tokens` 테이블 — `account_id, access_token, refresh_token, token_expiry, scope`. 계정당 1행 `UNIQUE(account_id)`. RLS + `set_updated_at` 트리거.
- Supabase Storage `youtube-shorts` 버킷 (public, 500MB 제한).

**`backend/app/services/youtube.py`** (신규)

- Google OAuth 2.0 인가 URL 생성 / 코드 → 토큰 교환 / 만료 5분 전 자동 갱신 / YouTube Data API v3 멀티파트 업로드.

**`backend/app/services/shorts_gen.py`** (신규)

- GPT-4o Vision으로 이미지당 자막 1줄 병렬 생성 (`asyncio.gather`).
- FFmpeg subprocess로 이미지 슬라이드 → 9:16 MP4 합성 (xfade 전환 + drawtext 자막 오버레이 + Malgun Gothic 한글 폰트).
- 완성 영상을 Supabase Storage `youtube-shorts` 버킷에 업로드 후 공개 URL 반환.

**`backend/app/routers/marketing.py`** — 엔드포인트 추가

- `GET  /api/marketing/photos` — 사진 라이브러리 목록.
- `POST /api/marketing/photos/upload` — 사진 업로드.
- `DELETE /api/marketing/photos/{id}` — 사진 삭제.
- `GET  /api/marketing/youtube/oauth/start` — YouTube OAuth 인가 URL 반환.
- `GET  /api/marketing/youtube/oauth/callback` — OAuth 콜백 (팝업 → postMessage).
- `GET  /api/marketing/youtube/oauth/status` — 연결 상태 조회.
- `DELETE /api/marketing/youtube/oauth/disconnect` — 연결 해제.
- `POST /api/marketing/youtube/shorts/preview-subtitles` — AI 자막 미리보기 (FFmpeg 없이).
- `POST /api/marketing/youtube/shorts/generate` — 영상 생성 + YouTube Shorts 업로드.

**`backend/app/core/config.py`**

- `youtube_client_id`, `youtube_client_secret`, `youtube_redirect_uri` 환경변수 추가.

**`backend/app/agents/marketing.py`**

- `VALID_TYPES`에 `shorts_video` 추가.
- `run_shorts_wizard` capability handler — `[[SHORTS_WIZARD]]` 마커 반환.
- `describe()`에 `mkt_shorts_video` capability 등록.

**`frontend/components/chat/PhotoLibraryModal.tsx`** (신규)

- 사진 라이브러리 모달 — 2열 그리드, AI 생성 이미지 + 업로드 사진 통합 표시.
- 선택 시 파란색 ring + 체크 뱃지, "+" 버튼으로 추가 업로드, 삭제 기능.

**`frontend/components/chat/ShortsWizardCard.tsx`** (신규)

- 4단계 마법사 UI: ① 사진 업로드 → ② 자막 편집 → ③ 영상 설정 → ④ YouTube 게시.
- YouTube OAuth 팝업 연결 (`window.open` + `postMessage`), 공개 범위·슬라이드 시간 설정.

### Changed

**`frontend/components/chat/InstagramPostCard.tsx`**

- "인스타그램에 게시" 버튼 클릭 시 `PhotoLibraryModal` 오픈 → AI 이미지 또는 라이브러리 사진 선택 후 게시.
- 문장 종결 부호·이모지 뒤 자동 줄바꿈 처리 (`_extract_sns_content` 정규식 개선).

**`frontend/components/chat/ChatOverlay.tsx`**

- `[[SHORTS_WIZARD]]` 마커 파싱 + `ShortsWizardCard` 렌더 연결.

### Changed (v1.0.1 패치)

**`frontend/components/chat/ShortsWizardCard.tsx`**

- **드래그 앤 드롭 순서 변경** — 사진 업로드 탭에서 슬라이드 항목을 드래그로 순서 재배치. 드래그 중 항목 반투명(opacity-40) + 드롭 대상 빨간 ring 표시.
- **스텝 탭 클릭 이동** — 상단 ① ② ③ ④ 탭을 클릭해 방문한 스텝 간 자유 이동 가능. 미방문 스텝은 회색(disabled). `goToStep()`으로 방문 기록(`unlockedSteps`) 관리.
- **즉시 트리거** — "유튜브 쇼츠 만들고 싶어" 입력 시 파라미터 질문 없이 마법사 카드 바로 표시. `mkt_shorts_video` capability `required: []` + description에 즉시 호출 지시 추가.

**`backend/app/services/shorts_gen.py`**

- **이미지 풀스크린** — `scale+pad`(검은 여백) → `scale+crop`(화면 꽉 채우기)으로 변경.
- **자막 트렌디 스타일** — 박스 배경 제거, 폰트 54px → 68px, 흰 글자 + 검은 외곽선(5px) + 그림자로 틱톡/쇼츠 스타일 적용. 위치 `y=h-150` → `y=h*0.80`.

**`frontend/components/chat/InstagramPostCard.tsx`**

- "다시 시도" 버튼 `handlePublish` (미정의 참조 오류) → `setShowLibrary(true)` 수정.

**`backend/app/agents/marketing.py`**

- `run_shorts_wizard` `topic` 파라미터 optional(`str = ""`)로 변경, 기본값 `"YouTube Shorts"` 설정.

---

## [Unreleased] — feature/sales-analytics (비용 입력 + 매출 UX 개선)

### Added

**`supabase/migrations/022_cost_records.sql`**

- `cost_records` 테이블 — `account_id, item_name, category, amount, memo, recorded_date, source`. RLS `auth.uid()` 기반.
- VALID_CATEGORIES: 재료비 · 인건비 · 임대료 · 공과금 · 마케팅 · 기타 (CHECK 제약).
- 인덱스: `idx_cost_records_account_date (account_id, recorded_date desc)`.

**`backend/app/routers/costs.py`** (신규)

- `POST /api/costs` (201) — 비용 다건 저장 + 임베딩 + `cost_report` artifact 자동 생성 + Costs 서브허브 `artifact_edges` 연결.
- `GET /api/costs` — 기간별 비용 조회 (기본 최근 30일).
- `GET /api/costs/summary` — 일/주/월 집계 (카테고리별 · 항목별 소계).
- `DELETE /api/costs/{id}` — 단건 삭제 + 임베딩 제거.

**`frontend/components/chat/CostInputTable.tsx`** (신규)

- 항목명 · 카테고리(드롭다운) · 금액 · 메모 편집 가능한 비용 입력 모달.
- 행 추가/삭제, 합계 실시간 계산, `POST /api/costs` 직접 호출.
- `onSaved(message, artifactId?)` 콜백 — 저장 후 "캔버스에서 보기" 버튼 연동.

### Changed

**`backend/app/agents/sales.py`**

- `_VAGUE_COST_RE` — "비용 입력" 류 의도 감지 정규식.
- `vague_cost` 얼리 리턴 — GPT 우회, `cost_records` DB 조회 → 최근 기록 테이블 + `[ACTION:OPEN_COST_TABLE:{json}]` 마커 반환.
- `vague_entry` 로직 개선 — 최근 매출 기록 있으면 3-버튼 UX 반환 (동일저장 / 표로 수정 / 글로 새로 입력), 없으면 빈 표 오픈.
- `[CHOICES]` 예시 제거 + "vague 입력 시 CHOICES 금지" 명시 → 불필요한 선택버튼 5개 등장 버그 수정.
- RAG/장기기억 컨텍스트를 vague_entry 경로에서 차단 → 구 데이터 재표시 버그 수정.

**`frontend/components/chat/ChatOverlay.tsx`**

- `parseCostAction()` — `[ACTION:OPEN_COST_TABLE:{json}]` 마커 파싱 (중괄호 깊이 카운팅).
- `costAction` Message 필드 추가 + `CostInputTable` 모달 렌더링.
- 비용 버튼 분기: `items===0` → "📋 표로 입력하기"; `items>0` → "💾 저장" + "📋 표로 수정입력하기" + "✏️ 새로 입력".
- 매출 저장 후 `artifact_id` 추출 → "📍 캔버스에서 보기" 버튼 노출 + `boss:focus-node` 이벤트 발행.
- `SalesInputTable.onSaved` 시그니처 `(message, artifactId?)` 로 확장.

**`frontend/components/chat/SalesInputTable.tsx`**

- `onSaved(message, artifactId?)` — 저장 응답에서 `artifact_id` 추출 후 콜백으로 전달.

**`backend/app/main.py`** — `costs` 라우터 등록.

---

## [Unreleased] — feature-marketing (Instagram 카드 렌더링 수정 + 오케스트레이터 라우팅 보강)

### Fixed

**Instagram 카드 미표시 문제 (`backend/app/routers/chat.py`)**

- `reply.split("[ARTIFACT]")[0]` 방식이 `[ARTIFACT]` 이후 `[[INSTAGRAM_POST]]` 마커까지 잘라내던 버그 수정
- `_ARTIFACT_BLOCK_RE` 정규식으로 `[ARTIFACT]...[/ARTIFACT]` 블록만 제거 → 뒤따르는 `[[마커]]` 유지

**Instagram 카드 생성 로직 강화 (`backend/app/agents/marketing.py`)**

- `_maybe_instagram_preview` 해시태그 감지 완화 — 단일 줄 5개 이상 강제에서 reply 전체 해시태그 5개 이상으로 변경
- `_extract_sns_content` — "해시태그: #..." 라벨 붙은 줄 파싱 지원, 여러 줄 분산 해시태그 누적 + 중복 제거
- `run_sns_post` capability — `[[INSTAGRAM_POST]]` 마커 누락 시 강제 생성 (DALL-E 이미지 포함)
- `sns_post` 타입 artifact가 있으면 캡션/해시태그 추출 실패해도 카드 생성 보장
- SYSTEM_PROMPT에 "인스타 피드 즉시 생성 규칙" 추가 — 캡션/해시태그 제공 시 CHOICES 재질문 없이 바로 출력

**오케스트레이터 sticky routing 보강 (`backend/app/agents/orchestrator.py`)**

- `_CONTEXT_REFERENCE_KEYWORDS` 확장 — `예시처럼`, `업로드까지`, `카드로`, `이런 식으로` 등 추가
- `_DOMAIN_ACTION_SIGNALS` 확장 — `[[instagram_post]]`, `인스타그램 피드`, `게시물을 저장` 등 추가 → Instagram 피드 생성 후 후속 요청이 refuse로 분류되는 오류 수정

---

## [Unreleased] — feature/sales-agent

### Added — Sales 도메인 MVP: 텍스트 입력 → 파싱 → 저장 → 캔버스 반영

**`supabase/migrations/021_sales_records.sql`** _(원래 018 이었으나 legal_knowledge 와 번호 충돌로 rename)_

- `sales_records` 테이블 — `account_id, item_name, category, quantity, unit_price, amount, recorded_date, source, raw_input, metadata`. RLS `auth.uid()` 기반.
- `ensure_standard_sub_hubs` 함수에 `Revenue` 서브허브 추가 (Sales 허브 하위).

**`backend/app/routers/sales.py`** (신규)

- `POST /api/sales` — 매출 다건 저장 + 임베딩 + `revenue_entry` artifact 자동 생성 + Revenue 서브허브 `artifact_edges` 연결.
- `GET /api/sales` — 기간별 매출 조회.
- `GET /api/sales/summary` — 일/주/월 집계 (항목별·카테고리별 소계 + 총합계).
- `DELETE /api/sales/{id}` — 단건 삭제 + 임베딩 제거.

**`backend/app/agents/sales.py`**

- `[ACTION:OPEN_SALES_TABLE:{json}]` 마커 — GPT 응답에 삽입되어 프론트 SalesInputTable 트리거.
- `_parse_sales_from_message` — 자연어 텍스트에서 품목·수량·단가 파싱 (GPT-4o-mini).
- `_VAGUE_ENTRY_RE` / `_TABLE_INPUT_RE` / `_EXPLICIT_TEXT_RE` — 입력 의도 분류 정규식.
- `_SAVE_INTENT_RE` + `_find_last_action_marker` — "저장해줘" 감지 시 history에서 마지막 ACTION 마커 재삽입 (GPT 없이 즉시 반환으로 "저장됐습니다" 오답 방지).
- `_strip_action_marker` — 파이썬 쪽 중괄호 깊이 파서 (regex 대신).
- `_build_markdown_table` / `_build_action_marker` 헬퍼.

**`frontend/components/chat/SalesInputTable.tsx`** (신규)

- 품목·카테고리·수량·단가 편집 가능한 모달 테이블.
- 행 추가/삭제, 합계 실시간 계산, `POST /api/sales` 직접 호출.

**`frontend/components/chat/ChatOverlay.tsx`**

- `parseSalesAction()` — 중괄호 깊이 카운팅 파서 (JSON 배열 안 `]` 오파싱 방지).
- salesAction 버튼 분기:
  - `items.length === 0` → "✏️ 글로 입력하기" + "📋 표로 추가입력하기"
  - `items.length > 0` → "💾 저장" (모달 없이 직접 POST) + "📋 표로 추가입력하기"

**`frontend/components/canvas/modals/NodeDetailModal.tsx`**

- `revenue_entry` artifact 클릭 시 Sales Records 섹션 표시 — 날짜 picker + 새로고침 + 항목별 삭제.
- `metadata.recorded_date` 우선 사용 (created_at 폴백).

**`frontend/components/canvas/FlowCanvas.tsx`**

- hover 엣지 강조 BFS 확장 — 직계 1hop에서 **전체 subtree(양방향)** 로 개선. `setEdges` setter 내부에서 BFS 수행해 circular dependency 방지.

### Changed

- `backend/app/main.py` — `sales` 라우터 등록.

### Added — Sales Capability 합류 (function-calling V2 경로)

- `backend/app/agents/sales.py` 에 `describe()` + 6종 capability handler 추가:
  - `sales_revenue_entry` — 자연어 매출 텍스트 파싱 → SalesInputTable 오픈 마커
  - `sales_report` / `sales_price_strategy` / `sales_customer_script` / `sales_promotion` / `sales_checklist`
- `backend/app/agents/_capability.py` — `V2_DOMAINS` 에 `sales` 포함 (4개 도메인 전부 function-calling)
- 이제 총 **21개 capability** 가 orchestrator tools 스펙에 등록됨

---

## [0.9.0] — feature-documents (Recruitment 대확장 + Capability 라우팅 + Legal 서브브랜치)

### Added

**Recruitment 에이전트 확장 (`recruitment.py`, `_recruit_*`)**

- **3종 플랫폼 공고 동시 작성** — 당근알바 / 알바천국 / 사람인 · `[JOB_POSTINGS]` 마커 1회로 부모 `job_posting_set` + 자식 `job_posting × 3` (metadata.platform) + `contains` 엣지
- **채용공고 HTML 포스터 생성 (`core/poster_gen.py`)** — GPT-4o 로 standalone HTML 1장 · Supabase Storage `recruitment-posters` 업로드 + `artifacts.content` 이중 저장 · `type='job_posting_poster'` · 기존 DALL-E 기반 `job_posting_image` 경로 대체 (한국어 텍스트 렌더링 품질)
- **업종별 CHOICES 분기** — `profiles.business_type` → `cafe / restaurant / retail / beauty / academy / default` 매핑. 업종·플랫폼별 가이드 markdown (`_recruit_knowledge/`)
- **`_recruit_calc.py`** — 2026 최저임금 10,320원 · 주휴수당 · 월 인건비 · 4대보험 의무 여부
- **`hiring_drive` 기간 artifact** — `start_date+end_date` + `due_label='채용 마감'` 주입 → 기존 스케쥴러 D-7/3/1/0 리마인드 경로 자동 연결 (별도 마이그레이션 불필요)

**Function-calling Capability 라우팅 (`_capability.py`)**

- OpenAI tools API 로 도메인 에이전트의 기능을 capability 단위로 노출. 각 도메인이 `describe(account_id) -> list[Capability]` 를 export 하면 `describe_all()` 이 tool 스펙 + handler dispatch map 을 조립
- `V2_DOMAINS = (recruitment, documents, marketing)` — sales 는 팀원 기능 구현 완료 후 별도 PR 에서 합류 예정
- `orchestrator._dispatch_via_tools(...)` — single/multi domain 분기에서 V2 도메인만 섞인 경우 tools 경로 우선 시도 · 실패 시 legacy `_call_domain_with_shortcut` 자동 폴백
- `parallel_tool_calls=True` — 크로스 도메인 요청(예: "공고+인스타 동시") 한 응답에 병렬 호출 후 `_synthesize_cross_domain` 합성
- **등록된 capability 총 15개**: recruitment 4~5개(이미지 조건부) + documents 6~7개(review 조건부) + marketing 5개

**Documents Legal 서브브랜치 (`_legal.py`, v0.9.0)**

- `classify_legal_intent` (gpt-4o-mini) — 서류 작성 의도 아니면서 법률 자문 의도인 메시지 판별
- `search_legal_knowledge` RPC → RAG 컨텍스트 주입 → GPT-4o 답변 + 면책 고지 자동 첨부
- `type='legal_advice'` artifact 를 Documents > Legal 서브허브 아래 저장. `legal_annual_values` 테이블에서 최저임금/부가세율/소상공인 기준 등 연도별 법정 수치 주입

**Marketing Capability (`marketing.py`)**

- 기존 팀원 작업(`[NAVER_UPLOAD]` / `[[INSTAGRAM_POST]]` / `[[REVIEW_REPLY]]`) 위에 capability 5종 오버레이
- `mkt_sns_post` / `mkt_blog_post` / `mkt_review_reply` / `mkt_ad_copy` / `mkt_campaign_plan`
- 내부는 wrapper 스타일 — 파라미터를 자연어로 합성해 기존 `run()` 재사용

**Frontend 포스터 iframe 미리보기 (`NodeDetailModal.tsx`)**

- `type='job_posting_poster'` 노드 클릭 시 `<iframe srcDoc={content} sandbox="allow-same-origin">` 로 샌드박스 렌더 (560px)
- `HTML 다운로드` (blob URL) + `새 탭에서 열기` (Supabase public URL) 버튼

### Fixed — Orchestrator 분류 안정화

**CHOICES sticky routing (`orchestrator.py`)**

- 직전 어시스턴트 메시지에 unresolved `[CHOICES]` 가 있으면 classifier 에 sticky 힌트 주입 + 짧은 단답이 `chitchat` 으로 분류되어도 최근 대화 키워드로 도메인 복구
- `_last_assistant_did_domain_action` — "저장되었어요 / 캔버스에 / artifact" 같은 도메인 액션 흔적 감지
- `_has_context_reference` — "이걸로 / 방금 거 / 이 공고" 같은 맥락 지시어 감지
- 두 조건 만족 시 `refuse` 결과도 sticky override 로 도메인 복구 (예: "이걸로 이미지 만들어줘" → recruitment 유지)
- classifier 프롬프트 업데이트 — 이미지/포스터/썸네일/배너 생성 요청은 refuse 가 아닌 해당 도메인(recruitment · marketing) 으로 분류하도록 명시
- history window 4 → 8 확장

### Migrations (새 3종)

- `018_legal_knowledge.sql` — `legal_knowledge_chunks` 테이블 + HNSW/trgm/FTS 인덱스 + RLS
- `019_legal_knowledge_search.sql` — `search_legal_knowledge` RPC (벡터+BM25 RRF)
- `020_legal_annual_values.sql` — 연도별 법정 수치(최저임금/부가세율/소상공인 기준 등) 테이블 + seed

### API

- `POST /api/recruitment/poster` — `job_posting_set` → HTML 포스터 생성 (DALL-E `/image` 엔드포인트 제거)
- `POST /api/recruitment/wage-simulation` — 시급·주근무시간 → 월 총 인건비 시뮬레이션

## [Unreleased] — feature-marketing

### Added — 인스타그램 Meta Graph API 자동 게시

**`backend/app/services/instagram.py`** (신규)

- Meta Graph API v19.0 클라이언트
- DALL-E 이미지(1시간 만료) → Supabase Storage `instagram-images` 버킷에 영구 저장 → 공개 URL 확보
- 2단계 게시: 미디어 컨테이너 생성 → `media_publish`
- `publish_post(account_id, image_url, caption, hashtags)` — 게시된 포스트 URL 반환

**`POST /api/marketing/instagram/publish`**

- `META_ACCESS_TOKEN` / `INSTAGRAM_USER_ID` 환경변수 없으면 503 반환
- 성공 시 `{ success: true, post_url }` 반환

**`InstagramPostCard.tsx` — "인스타그램에 게시" 버튼 추가**

- 인스타그램 그라디언트 버튼 (업로드 중 스피너, 완료 시 포스트 링크, 오류 시 재시도)
- Supabase Auth로 `account_id` 자동 주입

**Supabase Storage 버킷 `instagram-images`**

- 공개 버킷, 5MB 제한, jpeg/png/webp 허용
- RLS: 공개 읽기 + 인증/서비스롤 쓰기

**`backend/app/core/config.py`**

- `meta_access_token`, `instagram_user_id` 설정 추가 (선택)

---

### Added — 채팅 마케팅 UI 카드 + 리뷰 이미지 분석 + 파일 스테이징

**인스타그램 피드 미리보기 카드 (`InstagramPostCard.tsx`)**

- `[[INSTAGRAM_POST]]{json}[[/INSTAGRAM_POST]]` 마커 패턴으로 채팅 내 렌더
- DALL-E 3으로 SNS 이미지 자동 생성 (업종·캡션 컨텍스트 반영)
- 실제 인스타그램 UI 모사: 프로필 헤더, 이미지, 좋아요/댓글/공유/저장 버튼
- 캡션 `react-markdown` + `remark-gfm` + `remark-breaks` 렌더링
- "더 보기" 접기/펼치기, liked/saved 토글 상태

**리뷰 답글 카드 (`ReviewReplyCard.tsx`)**

- `[[REVIEW_REPLY]]{json}[[/REVIEW_REPLY]]` 마커 패턴
- 별점 표시(1~5점), 글자 수 바(`CharBar`, 150자 기준 색상 변화)
- 클립보드 복사 버튼 (2초 피드백)

**리뷰 이미지 자동 분석 (`POST /api/marketing/review/analyze`)**

- GPT-4o Vision으로 리뷰 캡처 이미지 분석 — 플랫폼(네이버/카카오/구글) + 별점 + 리뷰 본문 추출
- 분석 결과로 답글 자동 생성 메시지 채팅에 전송

**스테이징 파일 업로드 UX (`ChatOverlay.tsx`)**

- 파일 선택 즉시 전송 대신 입력창 상단에 칩으로 미리보기 후 메시지와 함께 전송
- Ctrl+V 클립보드 스크린샷 붙여넣기 → 자동 staged 처리
- 리뷰 이미지 감지: 파일이 이미지이고 대화 맥락에 "리뷰"가 있으면 Vision 분석 경로로 분기

### Fixed

**Artifact 캔버스 미표시 버그 (`_artifact.py`)**

- `sub_domain` 없거나 매칭 실패 시 `contains` 엣지가 생성되지 않아 노드가 `(0,0)`(앵커 위)에 쌓이던 문제 수정
- 서브허브 → 메인 허브 순으로 폴백해 **모든 artifact에 항상 `contains` 엣지 생성**

**오케스트레이터 라우팅 오류**

- "리뷰 답글 작성" 의도가 `refuse`로 분류되던 버그 수정 → `marketing` 라벨로 정상 분류

**SNS 포스트 에이전트 대화 문구 혼입**

- `_PREAMBLE_RE`로 "알겠습니다", "작성해보겠습니다" 등 정중한 문장 마무리로 끝나는 줄 자동 제거
- `_SNS_POST_FORMAT` 프롬프트에 잘못된 예시 명시 및 줄바꿈 규칙 추가

**`ChatOverlay` 순환 `useCallback` 의존성 (`ReferenceError: TDZ`)**

- `send` ↔ `analyzeReviewImage` ↔ `uploadFiles` 간 순환 의존 제거
- `sendRef = useRef(null)` 도입 + `useEffect(() => { sendRef.current = send }, [send])`로 해결

**`next-themes` 스크립트 태그 콘솔 경고**

- `forcedTheme="light"` 고정이었던 `ThemeProvider` 제거 → `Providers`를 단순 fragment로 교체

### Changed

**마케팅 서브허브 자동 매핑 (`marketing.py`)**

- 타입별 `sub_domain` 가이드 프롬프트 추가
  - `sns_post` / `product_post` → `Social`
  - `blog_post` → `Blog`
  - `review_reply` → `Reviews`
  - `event_plan` → `Events`
  - `ad_copy` / `campaign` → `Campaigns`

**`next.config.ts`**

- DALL-E 3 이미지 도메인(`oaidalleapiprodscus.blob.core.windows.net`) `remotePatterns` 허용 추가

**패키지**

- `react-markdown`, `remark-gfm`, `remark-breaks` 추가

---

### Added — Marketing 에이전트 전면 확장

- **콘텐츠 타입 9종** — `sns_post | blog_post | ad_copy | marketing_plan | event_plan | campaign | review_reply | notice | product_post`. 에이전트를 카페 특화에서 **업종 불문(소상공인 전반)**으로 재작성. 각 타입별 출력 형식 가이드 내장(SNS 해시태그 20~30개·최적 게시 시간, 블로그 마크다운 구조, 공지 5단계, 리뷰 별점별 톤, 상품 소개 4단계).
- **BGE-M3 RAG 지식베이스** (`backend/app/agents/_marketing_knowledge.py`) — `embed_text` (동기) 를 `asyncio.to_thread` 로 오프로드. `search_marketing_knowledge` RPC 호출 → `subsidy_programs` (정부 지원사업) + `marketing_knowledge_chunks` (소상공인보호법·개인정보보호법) 두 테이블을 **벡터 + FTS RRF 병합 검색**. `source_table` 필드로 지원사업/법령 섹션 분리 후 system 프롬프트에 주입.
- **`015_marketing_knowledge.sql`** — `subsidy_programs` (107 rows) + `marketing_knowledge_chunks` (1014 rows, BGE-M3 1024dim 임베딩) 테이블. RLS SELECT 공개.
- **`016_marketing_rag.sql`** — `subsidy_programs` 에 `embedding vector(1024)` + `fts tsvector` 추가. `search_marketing_knowledge(query_embedding, query_text, match_count)` RPC — LANGUAGE sql (plpgsql 컬럼명 모호성 회피), `kc_vec + kc_fts + sp_vec + sp_fts` 4-way CTE RRF. DROP-then-CREATE 로 반환 타입 변경 안전 적용.
- **`017_marketing_subhubs.sql`** — `bootstrap_workspace` 트리거 업데이트: 신규 가입자에게 Marketing 서브허브 5개 자동 생성. 기존 계정 백필 DO 블록 포함.
- **Marketing 서브허브 5종 확정** — `Social` (sns_post, product_post) / `Blog` (blog_post) / `Campaigns` (ad_copy, campaign) / `Events` (event_plan, notice, marketing_plan) / `Reviews` (review_reply). `kind='domain'`, `type='category'`.
- **`backend/app/routers/marketing.py`** — `POST /api/marketing/image` (DALL-E 3 이미지 생성, 프로필 업종·가게명 자동 주입) / `POST /api/marketing/blog/upload` (네이버 블로그 Playwright 업로드) / `GET /api/marketing/subsidies` (지원사업 검색).
- **`backend/app/services/naver_blog.py`** — `asyncio.to_thread` 래퍼. Windows asyncio 이슈 우회를 위해 `naver_blog_runner.py` 를 subprocess 로 분리 실행.
- **`backend/app/services/naver_blog_runner.py`** — Playwright 기반 네이버 SE One 에디터 자동화. `parse_content()` 로 markdown blog_post → 제목/단락/태그 파싱. Base64 UTF-16LE 클립보드 방식으로 한글 붙여넣기.
- **`backend/app/services/naver_login_setup.py`** — 최초 1회 쿠키 설정 스크립트 (`python -m app.services.naver_login_setup`).
- **`scripts/import_marketing_knowledge.py`** — BOSS(원본 프로젝트) DB에서 `subsidy_programs` 107 rows + `marketing_knowledge_chunks` 1014 rows 를 BOSS2 로 이전. BGE-M3 임베딩 배치 생성 포함. `--subsidy-only` / `--knowledge-only` / `--force` 플래그.
- **`backend/app/core/config.py`** — `naver_blog_id` / `naver_blog_pw` 선택 설정 추가.
- **NodeDetailModal — Marketing Actions 패널** — `node.domains?.includes("marketing") && node.kind === "artifact"` 조건 시 "이미지 생성" 버튼 노출. `node.type === "blog_post"` 시 "네이버 블로그 업로드" 버튼 추가 노출. 생성된 이미지 인라인 프리뷰.

### Changed

- **`backend/app/agents/marketing.py`** 전면 재작성 — 업종 불문 프롬프트, 9종 콘텐츠 타입 형식 가이드, 필수 필드 매트릭스, 업종별 플랫폼 가이드, 마케팅 전략 추천 가이드, 계절 컨텍스트, `marketing_knowledge_context` 비동기 주입.
- **`backend/app/main.py`** — `marketing` 라우터 등록.
- **Migration 번호 재정렬** — v0.8.0 이 011~014 를 사용함에 따라 marketing 마이그레이션을 015~017 로 재번호.

---

## [0.8.0] - 2026-04-20

### Added — 공정성 분석 파이프라인 (Documents 에이전트 확장)

- **지식 베이스 1,349 청크** — 법령(법제처 Open API 7개 법령 × 조문·항 2단계 청킹, ~1,171), 위험 조항 패턴(6 subtype × risks.md, 100), 관행 허용 조항(6 subtype × acceptable.md, 78). `011_contract_knowledge.sql` 로 3개 테이블 + HNSW(m=16, ef=64) + trigram GIN + FTS GIN 인덱스 + RLS(SELECT 공개). `012_contract_knowledge_search.sql` 로 3-way RRF RPC 3개(`search_{law,pattern,acceptable}_contract_knowledge`) — PostgREST 직렬화 우회를 위해 임베딩을 text 로 받아 내부 ::vector 캐스팅.
- **`backend/app/agents/_doc_review.py`** — `analyze(content, user_role, doc_type, contract_subtype) → ReviewResult` : 문서 앞 2000자로 임베딩 1회 + 3 RPC 호출로 RAG 컨텍스트 구성 → `gpt-4o-mini` JSON 모드 로 갑/을 유불리 비율(합=100) + 위험 조항(clause/reason/severity/suggestion_from→to) 추출. `dispatch_review(...)` 는 라우터/에이전트 공용 저장 헬퍼로 analysis artifact + `analyzed_from` 엣지 + activity_logs + embedding 을 **한 번에** 처리.
- **파일 업로드** — `POST /api/uploads/document` (`backend/app/routers/uploads.py`) 가 multipart 로 PDF/DOCX/이미지(JPG/PNG/WEBP/BMP/TIFF/GIF) 를 수신. Supabase Storage 버킷 `documents-uploads` 에 `{account_id}/{uuid}.{ext}` (ASCII-only 키) 로 업로드 → `doc_parser.parse_file` (async) 가 PDF(PyMuPDF)·DOCX(python-docx)·이미지(OpenAI `gpt-4o` vision OCR) 분기 → `uploaded_doc` artifact 생성(metadata: storage_path/mime/size/original_name/parsed_len) + 임베딩 인덱싱.
- **분석 실행** — `POST /api/reviews` (`backend/app/routers/reviews.py`) 가 `dispatch_review` 래퍼. 채팅 플로우: 사용자 업로드 → `documents.py` 에이전트가 최근 60분 이내 `uploaded_doc` 을 system 컨텍스트로 주입 → 역할 CHOICES(갑/을/미지정) → `[REVIEW_REQUEST]` 마커 출력 → `_maybe_dispatch_review` 가 실행 → 응답 끝에 `[[REVIEW_JSON]]` 구조화 페이로드 append.
- **프론트엔드 분석 카드** — `frontend/components/chat/ReviewResultCard.tsx` 가 `[[REVIEW_JSON]]` 마커를 파싱해 **갑/을 이중 바** + 위험 조항 테이블(severity 색상 · 수정 before→after) 렌더. `stripMarkers` 유틸이 `[CHOICES]`/`[ARTIFACT]`/`[SET_NICKNAME]`/`[SET_PROFILE]`/`[REVIEW_REQUEST]` 잔여 블록을 추가 방어.
- **채팅 마크다운 렌더** — `frontend/components/chat/MarkdownMessage.tsx` (`react-markdown` + `remark-gfm`) 로 assistant 응답의 `**bold**` / `### header` / `---` / 리스트 / 테이블 / 인라인 코드를 Sand/Paper 테마로 렌더. 사용자 메시지는 plain 유지.
- **채팅 파일 첨부** — `ChatOverlay` 의 Paperclip 버튼에 hidden `<input type=file>` 배선. 업로드 중/완료/실패 말풍선 tone 구분, 성공 직후 "방금 업로드한 ... 공정성 분석해주세요" 자동 전송.
- **캔버스 통합** — `ArtifactChipNode` 가 `type='uploaded_doc'` 은 📎 Paperclip / `type='analysis'` 는 ⚖️ Scale 아이콘 + `갑N:을M` 모노 pill (분석 metadata 기반). `FlowCanvas` 의 `Relation` 타입에 `analyzed_from` 추가 + mauve 대시 스트로크 스타일. `boss:artifacts-changed` CustomEvent 로 업로드/분석 직후 자동 재조회.

### Added — 표준 서브허브 + 캔버스 안정화

- **`014_standard_sub_hubs.sql`** — `public.ensure_standard_sub_hubs(account_id)` idempotent 헬퍼 + `bootstrap_workspace` 트리거 확장 + 전체 profile backfill. 모든 계정에 17 서브허브 표준 세트(Recruitment 4 + Documents 4 + Sales 4 + Marketing 5) 보장.
- **`013_artifact_edges_analyzed_from.sql`** — `artifact_edges.relation` CHECK 제약에 `'analyzed_from'` 추가.
- **`backend/app/agents/_artifact.py`** — `pick_sub_hub_id` / `pick_main_hub_id` / `pick_documents_parent` 헬퍼. 우선순위: 서브허브(키워드 매칭 → 첫 번째) → 메인허브. `save_artifact_from_reply` 는 `extra_meta_keys` + `subtype_whitelist` 파라미터 지원 (documents 에이전트가 `due_label` / `contract_subtype` 추출·검증에 사용).

### Fixed

- **`artifact_edges.account_id` NOT NULL 누락 — silently fail 대란**: 5개 경로(uploads / \_doc_review / \_artifact / log_nodes / schedules / artifacts 라우터)의 INSERT 가 `account_id` 를 빠뜨려 try/except 로 조용히 실패해왔던 버그 전부 수정. 이로 인해 스케쥴 실행 로그 노드의 `logged_from` 엣지도 실제로는 DB 에 들어가지 않았었음.
- **Supabase Storage 한글 키 InvalidKey 에러** — `{account_id}/{uuid}-{원본파일명}.pdf` 경로가 한글 때문에 400 반환. `_storage_key_for` 가 UUID + 확장자만으로 경로 구성, 원본명은 `metadata.original_name` 에만 보관.
- **`[CHOICES]` 블록 본문 노출** — 프론트 `extractReviewPayload` 가 이제 `stripMarkers` 로 CHOICES/ARTIFACT/SET_NICKNAME/SET_PROFILE/REVIEW_REQUEST 잔여 블록을 본문에서 제거. 백엔드 스트립에 구멍이 있어도 UI 에 원문 마커가 뜨지 않도록 방어.

### Changed

- **`documents.py` 에이전트 system 프롬프트 재작성** — 신규 작성 플로우(type/subtype 결정 → 필수 필드 매트릭스 → ARTIFACT 블록) 와 공정성 분석 플로우(역할 CHOICES → REVIEW_REQUEST 마커) 를 한 파일에서 분기. `detect_doc_intent` 휴리스틱으로 최근 user 턴까지 훑어 subtype 조기 추론.
- **README / CLAUDE.md / metadata 규약** — `due_label` (계약 만료 / 납품기한 / 공지 게시일 등), `contract_subtype` (7종 enum), `uploaded_doc` / `analysis` artifact type, `analyzed_from` edge relation, notify_kind 확장(`start_d1/start_d3/due_d3/due_d7`) 전부 문서화.

---

## [0.7.0] - 2026-04-20

### Added — Documents 에이전트 신설 (템플릿 + D-N 리마인드)

- **type 매트릭스 + 계약서 subtype 7종** — `documents.py` 의 `VALID_TYPES = (contract | estimate | proposal | notice | checklist | guide)`. 계약서는 `metadata.contract_subtype ∈ {labor | lease | service | supply | partnership | franchise | nda}` 로 세분. `_doc_templates.py` 가 type × subtype 별 markdown 스켈레톤 + 한국 법령·관행 조항(`_doc_knowledge/<subtype>/{acceptable,risks}.md`) 을 system 프롬프트에 주입. 필수필드 매트릭스(계약: 당사자/조건/기간, 견적: 품목·수량·유효기간, 공지: 게시일·대상 ...)
- **`_doc_knowledge/` 12개 md** — BOSS 원본 `docs/contract_{risks,acceptable}/*.md` 에서 복사한 노동/임대/용역/납품/파트너십/프랜차이즈 6종 × {위험패턴, 허용조항}. v1.1 공정성 분석의 RAG 인제스트 소스로 재활용.
- **스케쥴러 D-7 / D-3 / D-1 / D-0 알림** — `scanner.find_date_notifications` 가 기존 `start/due_d0/due_d1` 3종에서 `start/start_d1/start_d3/due_d0/due_d1/due_d3/due_d7` **7종** 으로 확장. `tasks._notify_kind_to_text` 가 `metadata.due_label` (예: "납품기한", "계약 만료") 을 본문에 삽입해 `"일주일 뒤 계약 만료 입니다."` 식으로 문장 완성.
- **`ActivityModal` D-N 뱃지** — `metadata.notify_kind` 를 감지해 D-7/D-3/D-1/D-0 색상 뱃지 + `due_label` 을 우측에 덧붙여 표시 (severity 차등 색상).
- **`_artifact.py` 공용 저장 확장** — `extra_meta_keys` + `subtype_whitelist` 파라미터로 도메인별 자유 메타 (`due_label`, `contract_subtype` 등) 저장/검증. ARTIFACT_RULE 블록 스키마에 문서화.

### Changed

- **metadata 규약 테이블**(`CLAUDE.md`) 에 `due_label`, `contract_subtype` 공식 등재. `due_date + due_label` 조합으로 납품기한/제출기한/게시일 등 특수 마감을 별도 키 신설 없이 통일.

---

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
