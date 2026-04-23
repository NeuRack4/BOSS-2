# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] — feature-rec (채용 UX 개선 · 채팅 아바타 · 전역 채팅 상태 리프팅)

### Added — 채팅 아바타 시스템 (`frontend/components/chat/ChatAvatars.tsx`)

- **`BossAvatar`** — AI 답변 아이콘. 회색 가르마·안경·정장·넥타이를 갖춘 부장님 캐릭터 SVG.
- **`EmployeeAvatar`** — 사용자 메시지 기본 아이콘. 짧은 머리·미소·캐주얼 셔츠 직원 캐릭터 SVG.
- InlineChat: AI 메시지 왼쪽 `Bot` 아이콘 → `BossAvatar`, 사용자 메시지 오른쪽에 `EmployeeAvatar` 신규 추가. 커스텀 사진 업로드 시 `avatarUrl` 이미지로 자동 대체.
- 로딩 버블(타이핑 인디케이터)도 `BossAvatar` 로 통일.

### Added — 프로필 사진 업로드 (`frontend/components/layout/ProfileModal.tsx`)

- `ProfileModal` 상단에 **Chat Icon** 섹션 추가 — 현재 아바타 미리보기(56px 원형) + "Upload photo" 버튼 + "Remove" 링크.
- 이미지 선택 시 Supabase Storage `avatars/{userId}/avatar.{ext}` 에 `upsert` 업로드 후 `profiles.avatar_url` 저장, `ChatContext.avatarUrl` 전역 상태 즉시 반영.
- 파일 크기 2MB 제한, 형식 JPG/PNG/WebP.

### Added — Supabase Storage `avatars` 버킷 RLS (`supabase/migrations/032_avatars_storage_rls.sql`)

- `avatars` 버킷 생성(public) + 4개 RLS 정책: 본인 폴더 업로드·수정·삭제, 전체 공개 읽기.

### Added — `profiles.avatar_url` 컬럼 (`supabase/migrations/031_profile_avatar.sql`)

- `profiles` 테이블에 `avatar_url text` 컬럼 추가.

### Added — 근무시간 확인 테이블 + 직원 상세 모달 (`frontend/components/chat/WorkTableCard.tsx`)

- `WorkTableCard` — 채팅 안에서 직원별 근무 기록을 직접 편집하는 인터랙티브 테이블 카드.
  - 날짜·기본·연장·야간·휴일·메모 열 + 행 추가/삭제 + 합계 자동 계산.
  - "Save & Calculate Pay" 클릭 시 `__WORK_TABLE_CONFIRMED__:{JSON}` 마커로 `records` 배열 포함 전송.
  - UI 전체 영문화 (Date / Regular / Overtime / Night / Holiday / Memo / Total / Add Row / Cancel / Save & Calculate Pay).

### Changed — 채팅 전역 상태 리프팅 (`frontend/components/chat/ChatContext.tsx`)

- `messages` / `loading` / `userId` / `avatarUrl` 를 `ChatProvider` 전역으로 이동 — 페이지 이동 후에도 채팅 중단 없음.
- `fetchSessions` / `setAvatarUrl` 도 컨텍스트로 노출.
- `providers.tsx` 에서 `ChatProvider` 최상위 마운트, `dashboard/page.tsx` + `DomainPage.tsx` 로컬 `ChatProvider` 제거.

### Changed — 급여 명세서 2-턴 플로우 (`backend/app/agents/recruitment.py`)

- `run_payroll_preview` : 직원 선택 → 월 선택 순서로 2턴 분리. 직원 미지정 시 CHOICES 목록, 월 미지정 시 최근 3개월 CHOICES.
- `__WORK_TABLE_CONFIRMED__` 페이로드에서 `records` 배열 직접 파싱 → 기본급 "—" 버그 수정.
- capability schema `required: []` (pay_month 선택 옵션화).

### Fixed

- **채팅 네비게이션 중단** — `messages`/`loading` 전역 리프팅으로 페이지 이동 시 채팅 상태 유지.
- **세션 FK 500 오류** (`backend/app/routers/chat.py`) — 삭제된 `session_id` 감지 후 신규 세션 자동 생성.
- **Storage 한글 파일명 InvalidKey** (`backend/app/agents/documents.py`) — 스토리지 경로를 ASCII-only 로 sanitize.
- **플래너 "송진우 사장님" 호칭 버그** (`backend/app/agents/_planner.py`) — 대화 내 직원·고객 이름을 호칭으로 쓰지 않도록 프롬프트 수정.
- **artifact 삭제 후 Recent Activity 미갱신** — `artifacts.py` 삭제 시 관련 `activity_logs` 동시 삭제 + `ActivityModal` `boss:artifacts-changed` 이벤트 구독.
- **세션 재로드 시 액션 카드 복원 누락** — `WorkTableCard` / `SalesInputTable` / `CostInputTable` 복원 로직 수정.

---

## [2.1.1] — feature-marketing (네이버 블로그 자동 업로드 버그 수정)

### Fixed — 네이버 블로그 자동 업로드 (`backend/app/services/naver_blog_runner.py`)

- **이미지 중앙정렬** — 파일 업로드 완료 후 SE One 이미지 툴바의 가운데 정렬 버튼을 자동 클릭.
- **본문 잘림 방지** — `paste_text()` 클립보드 대기 시간 `0.3s → 0.6s`, 붙여넣기 후 대기 `0.4s → 0.6s`. 이미지 업로드 완료 대기 `2.5s → 4.0s`. 세그먼트 간 대기 `120ms → 300ms`. `focus_body_area()` 헬퍼 추가로 이미지 삽입 후 텍스트 커서 복귀 안정화.

### Fixed — 업로드 URL 클릭 불가 (`backend/app/agents/marketing.py`)

- **업로드 결과 분리** — `run_blog_post`에서 `run()` 반환값에 포함된 업로드 결과 텍스트("✅ 네이버 블로그에 업로드했어요!")를 블로그 본문과 분리한 뒤 `[[NAVER_BLOG_POST]]` 카드 마커 생성, 그 후 업로드 결과를 카드 뒤에 붙임. 기존에는 업로드 URL이 `BlogBody`(plain text 렌더) 안에 포함되어 클릭 불가였던 문제 해결.
- **업로드 URL 마크다운 링크화** — `🔗 {url}` → `[🔗 블로그에서 확인하기]({url})` 형식으로 변경. `MarkdownMessage`가 클릭 가능한 `<a target="_blank">` 링크로 렌더.

---

## [2.1.0] — feature-marketing (마케팅 UX 개선 — 인스타그램 피드·네이버 블로그 미리보기·자동 업로드 이미지 삽입)

### Added — 네이버 블로그 미리보기 카드 (`frontend/components/chat/NaverBlogPostCard.tsx`)

- **`NaverBlogPostCard`** — 채팅창에 실제 네이버 블로그처럼 보이는 미리보기 카드 렌더. 구성:
  - 상단 녹색 NAVER Blog 헤더 바 (N 로고 + "AI 미리보기" 배지)
  - 블로거 프로필 행 (아바타·날짜·조회수)
  - 16:9 커버 이미지 슬라이더 (복수 이미지 시 이전/다음 버튼 + 인덱스 표시)
  - 제목 + `BlogBody` 컴포넌트 (`##`/`###` 소제목 볼드 렌더)
  - 10줄 초과 시 "▼ 더 보기 / ▲ 접기" 토글
  - 녹색 태그 배지, 공감·댓글·공유·저장 액션 바, "네이버 블로그에 게시하기" CTA 버튼
- **`extractNaverBlogPayload()`** — `[[NAVER_BLOG_POST]]` 마커 파싱 후 제거. `InlineChat` 추출 체인에 통합.

### Added — SNS·블로그 폼 카드 브랜드 컬러 (`frontend/components/chat/`)

- **`SnsPostFormCard.tsx`** — Instagram 브랜드 컬러 적용: 테두리 `#f0d0e8`, 헤더 그라디언트(`#fff5f0→#fdf0f8`), 선택 pill `#c13584`, 제출 버튼 오렌지→핑크 그라디언트. 헤더에 Instagram 카메라 SVG 로고 추가.
- **`BlogPostFormCard.tsx`** — Naver 브랜드 컬러 적용: 테두리 `#c8f0d8`, 헤더 `#f0fff6`, 선택 pill·버튼 `#03C75A`. 헤더 Naver N 로고 추가. 토글 버튼 오버플로 수정 (`overflow-hidden` + `translate-x-[18px]`). 이미지 첨부 기능 추가 (최대 10장, `/api/marketing/photos/upload` 업로드, 썸네일 그리드 + 삭제 버튼).

### Changed — 인스타그램 피드 카드 UX (`frontend/components/chat/InstagramPostCard.tsx`)

- 카드 너비 `260px → 300px`, 이미지 비율 `aspect-[4/5] → aspect-square` (한 화면에 다 보임).
- 캡션 기본 접힘(60자 초과 시 "더 보기") + "접기" 토글.
- **`normalizeCaption()`** — 이모티콘만 있는 줄을 바로 앞 줄 끝에 붙여 단독 줄 차지 방지.
- InlineChat 래퍼: `ml-8 → flex justify-center w-full py-1` (가운데 정렬).

### Changed — 인스타그램 이미지 업로드 (`backend/app/services/instagram.py`)

- **`_crop_to_portrait()`** 추가 — DALL-E 1024×1024 이미지를 4:5(1080×1350)로 센터 크롭 후 Supabase Storage에 저장. 피드 업로드 시 블랙 바(필러박스) 제거.

### Changed — 네이버 블로그 자동 업로드 이미지 삽입 (`backend/app/services/naver_blog_runner.py`)

- **`insert_image_by_file()`** — 기존 URL 입력 방식(`insert_image_by_url`) 대체. Supabase URL에서 이미지를 임시 파일로 다운로드 → Playwright `expect_file_chooser()`로 OS 파일 다이얼로그 인터셉트 → 실제 파일을 Naver 서버에 업로드. 업로드 후 임시 파일 자동 삭제.

### Fixed — 네이버 블로그 업로드 제어 (`backend/app/agents/marketing.py`)

- **`allow_naver_upload` 플래그** — 폼의 자동 업로드 토글 OFF 시 `[[NAVER_UPLOAD]]` 마커를 처리하지 않아 미리보기만 표시하고 실제 업로드는 건너뜀.
- **`run_blog_post()` 파라미터 수정** — Planner가 전달하는 `tone` 및 기타 미지정 파라미터를 `**_kwargs`로 흡수해 `TypeError` 방지.
- **`_maybe_naver_blog_preview()`** — `[ARTIFACT]` 블록의 `type=blog_post` 조건 제거. `run_blog_post` 호출 시 항상 `[[NAVER_BLOG_POST]]` 미리보기 마커 생성.
- **사용자 이미지 우선** — 폼에서 첨부한 이미지 URL을 직접 사용 (기존 DALL-E AI 이미지 생성 제거).

---

## [2.0.0] — feature/sales-ai-insights (AI 매출 인사이트 4섹션 + MenuAnalysisCard UI 개선)

### Added — Backend

- **`backend/app/agents/_sales/_insights.py`** — 실데이터 기반 AI 인사이트 4섹션 생성 엔진. `_parse_period` (이번달/지난달/최근N일/YYYY-MM/분기 파싱) · DB 집계(sales_records + cost_records) · 전기 대비 변화율 · GPT-4o `response_format=json_object` 구조화 분석(핵심요약/good_factors/bad_factors/actions/marketing) · `[[SALES_INSIGHT:{...}]]` 마커 + clean_content 동시 반환.
- **`backend/app/agents/sales.py`** — `run_sales_report` 전면 교체. 기존 LLM 텍스트 위임 → `generate_sales_insight` 직접 호출. `save_artifact_from_reply`로 Reports 서브허브에 노드 저장 + `metadata.sales_insight` 패치(NodeDetailModal 시각화용).

### Added — Frontend

- **`frontend/components/chat/SalesInsightCard.tsx`** — 4탭 시각화 카드. 📊 요약(매출·비용·순이익 3카드 + 상위품목 수평바차트) · 🔍 원인분석(잘된/아쉬운 요인 색상 배지) · ✅ 추천액션(번호 리스트) · 📣 마케팅(제안 카드). `extractInsightPayload` 마커 파서 포함. 모서리 `5px` 통일.

### Changed — Frontend

- **`frontend/components/chat/InlineChat.tsx`** — `SalesInsightCard` import + `extractInsightPayload` 처리 체인 추가. `Message` 타입에 `salesInsight` 필드 추가.
- **`frontend/components/detail/NodeDetailModal.tsx`** — `artifact.type === "sales_report"` + `metadata.sales_insight` 조건 시 `SalesInsightCard` 렌더 (채팅과 동일 시각화).
- **`frontend/components/chat/MenuAnalysisCard.tsx`**
  - 탭2 범례: `ml-auto` 제거 → 카테고리명·%·금액 인접 배치 + 전체너비 바차트
  - 탭3 인사이트: 헤더(가격 인상 또는 메뉴 재검토) → 메뉴명 목록(볼드) → 설명 구조로 재편. 글자 `9px→12~13px`, 실수치+평균값 포함 구체적 설명. 효자/재검토 그룹 카드로 통합.

## [1.9.0] — feature/sales-camera-receipt (모바일 카메라 영수증 촬영 기능)

### Added — Frontend

- **`frontend/components/chat/InlineChat.tsx`**
  - `Camera` 아이콘 import 추가 (lucide-react)
  - `cameraInputRef` 신규: `<input type="file" accept="image/*" capture="environment" />` — 모바일에서 후면 카메라 직접 실행, 데스크톱에서 파일 선택 폴백
  - 카메라 버튼(📷) 추가 — 기존 paperclip 버튼 옆에 배치, 클릭 시 `cameraInputRef` 트리거
  - 촬영된 이미지는 기존 `handleFileSelect` → `uploadFiles` → 영수증 OCR 흐름 그대로 처리

## [1.8.1] — feature/sales-menu-ocr (메뉴 이미지 분류 구조 개선 + InlineChat 메뉴 라우팅)

### Added — Backend

- **`backend/app/agents/_doc_classify.py`** — `menu` 독립 category 신설. `Category` 타입·`CATEGORY_LABELS`·`USER_DECLARED_TYPES`·`_HEURISTICS`에 `"menu"` 추가. 키워드: `메뉴판`, `menu board`, `오늘의 메뉴`, `today's menu`, `menu`, `메뉴`, `매뉴` 등. 영수증과 분리된 독립 라우팅 경로 확보.

### Changed — Backend

- **`backend/app/agents/sales.py`** — `describe()` 내 `_is_menu_image` 파일명 기반 필터 추가. 파일명에 `menu/메뉴` 포함 시 `sales_parse_receipt` 제외 → `sales_menu_ocr`만 광고.

### Changed — Frontend

- **`frontend/components/chat/InlineChat.tsx`**
  - `UploadCategory` 타입에 `"menu"` 추가
  - `CATEGORY_LABEL`, `UPLOAD_TYPES` 드롭다운에 `"메뉴"` 항목 추가
  - `menuItems` 필터 신규: `final_category === "menu"` 이미지 → `setPendingReceipt` + `"메뉴로 등록해줘"` 자동 전송
  - `otherNonDocs`에서 `menu` 제외
  - `nonDocs` 필터 수정: ephemeral 업로드(`artifact_id === null`)는 `needs_confirmation` 무관하게 즉시 처리 (기존 버그 수정)

## [1.8.0] — feature/sales-menu-ocr (메뉴판 이미지 OCR + 이미지 라우팅 구조 개선)

### Added — Backend

- **`backend/app/agents/_sales/_ocr.py`** — `_MENU_PROMPT` + `parse_menu_from_bytes()` 신규 추가. GPT-4o Vision으로 메뉴판 이미지에서 `[{name, category, price}]` 추출.
- **`backend/app/agents/sales.py`** — `run_menu_ocr` 핸들러 + `sales_menu_ocr` capability 추가. `_sales_context.pending_receipt` + `_upload_context.pending_upload` 두 경로 모두 지원. 이미지 있을 때만 조건부 광고(`[즉시 호출 가능]` + 파일명 포함). 메뉴 일괄 upsert 후 `menu_list` artifact 자동 갱신.

### Changed — Backend

- **`backend/app/agents/_doc_classify.py`** — 이미지 확장자(`.jpg .jpeg .png .gif .webp .bmp .heic`) 파일은 `receipt`로 라우팅. 이미지 컨텐츠 판단(영수증/메뉴판 등)은 sales 에이전트(플래너)가 담당하도록 책임 분리. 공유 분류기에 도메인 지식 추가 없이 라우팅 역할만 수행.

## [1.7.0] — feature-marketing (마케팅 도메인 확장 — 이벤트 기획·성과 리포트·자동화 스케줄·인스타그램 피드 인라인 렌더)

### Added — 마케팅 Capability 확장 (`backend/app/agents/marketing.py`)

- **`run_event_form()`** — 이벤트 세부 정보 없이 "이벤트 기획해줘" 요청 시 즉시 `[[EVENT_PLAN_FORM]]` 마커를 반환해 채팅창 내 이벤트 기획 폼 UI를 오픈.
- **`run_event_plan()`** — `title / event_type / start_date / end_date / due_date / benefit` 파라미터를 받아 `event_plan` artifact 등록 + D-리마인드 알림 자동 설정. `depends_on: mkt_event_plan` 플로우에서 `_preceding_reply` 를 주입받아 `run_sns_post()` / `run_blog_post()` 로 순차 연결 가능.
- **`run_notice()`** — `notice_type / content / date` 파라미터. `publish_sns=true` 옵션 시 인스타그램 자동 게시 (`_publish_to_instagram`) 포함.
- **`run_marketing_report()`** — Instagram Insights + YouTube Analytics 데이터를 `[[MARKETING_REPORT]]` 마커로 반환 → 채팅창 내 `MarketingReportCard` 렌더.
- **`run_schedule_post()`** — `task` (자동 실행 지시문) + `cron` (5-field)을 받아 `schedule_post` artifact 생성 후 `metadata.schedule_enabled=true / cron / next_run` 으로 Celery Beat에 자동 등록.
- **`run_sns_post()` / `run_blog_post()`** — `_preceding_reply: str | None` 파라미터 추가. Planner `depends_on` 체인에서 앞 단계(이벤트 기획안) 결과를 1,200자 이내로 system 프롬프트에 주입해 맥락 연속성 보장.
- **`schedule_post`** — `VALID_TYPES` 및 `SYSTEM_PROMPT` 에 신규 type 추가.

### Added — 마케팅 성과 리포트 API (`backend/app/routers/marketing.py`)

- **`GET /api/marketing/report/instagram`** — `account_id / days(7–90)` 쿼리. `instagram_insights.collect_report_data()` 를 호출해 계정·게시물·Reels 성과 데이터를 반환.
- **`GET /api/marketing/report/youtube`** — `account_id / days(7–90)` 쿼리. `youtube_analytics.collect_report_data()` 를 호출해 채널·영상 조회수·구독자 지표를 반환.

### Added — 서비스 레이어 (`backend/app/services/`)

- **`instagram_insights.py`** — Meta Graph API(`/me/media`, `/insights`) 를 통해 계정 프로필·게시물 목록·Reels·스토리 성과 데이터를 수집. `collect_report_data(days)` 반환 구조: `{account, posts, reels, summary}`.
- **`youtube_analytics.py`** — YouTube Data API v3 + YouTube Analytics API 를 통해 채널 통계·영상별 성과(`views / likes / comments / watch_time`)를 수집. `collect_report_data(account_id, days)` 반환 구조: `{channel, videos, summary}`.

### Added — 프론트엔드 카드 컴포넌트 (`frontend/components/chat/`)

- **`EventPlanFormCard.tsx`** — `[[EVENT_PLAN_FORM]]` 마커 감지 시 채팅창에 렌더되는 이벤트 기획 인라인 폼. 이벤트명·종류·기간·혜택 입력 → 제출 시 `mkt_event_plan` capability로 자동 전송.
- **`MarketingReportCard.tsx`** — `[[MARKETING_REPORT]]` 마커 감지 시 렌더. Instagram(팔로워·도달·좋아요·저장·댓글) + YouTube(구독자·조회수·시청 시간) 성과 지표를 탭 UI로 시각화.

### Changed — InlineChat 마커 추출 체인 (`frontend/components/chat/InlineChat.tsx`)

- **`send()` 추출 체인** — `afterMenu` 이후 `extractMarketingReportPayload` → `extractInstagramPayload` → `extractEventPlanForm` 순서로 추출 체인 확장. `marketingReport / instagram / eventPlanForm` 세 필드가 `Message` 객체에 저장됨.
- **세션 로드** — 히스토리 로드 시에도 `extractMarketingReportPayload` → `extractInstagramPayload` 를 순차 적용해 `marketingReport / instagram` 페이로드 복원. 세션 재로드 후에도 카드가 사라지지 않음.
- **`Message` 타입** — `instagram?: InstagramPayload / marketingReport?: MarketingReportPayload / eventPlanForm?: boolean` 필드 추가.
- **`InstagramPostCard` 인라인 렌더** — 이전까지 렌더 시점에만 재추출하던 방식에서 `send()` 체인 정식 포함으로 변경. Instagram SNS 포스트 생성 시 채팅창에 즉시 피드 미리보기 카드가 렌더됨 (캔버스뿐 아니라 채팅창에서도).

### Changed — Planner 시스템 프롬프트 (`backend/app/agents/_planner.py`)

- **마케팅 도메인 설명** — "Instagram·YouTube 마케팅 성과 분석 리포트 + 마케팅 정기 자동화 스케줄 등록" 추가.
- **Capability 가이드** — `mkt_event_form / mkt_event_plan / mkt_notice / mkt_marketing_report / mkt_schedule_post` 5종 신규 등록. `mkt_event_plan` 의 `depends_on` 체인 규칙(Instagram/네이버 블로그 연동 조건) 명시.
- **`opening` 엄격화** — "opening 에는 질문을 절대 담지 마세요 — question 과 동일하거나 유사한 내용 엄격히 금지" 지시문으로 강화 (중복 노출 방지).

### Removed

- **`frontend/README.md`** — 불필요 제거.

---

## [1.6.0] — 2026-04-23

### Added — Dashboard

- **위젯 레이아웃 커스터마이징** — 헤더 `Layout` 버튼으로 편집 모드 진입. 채팅창 제외 전 셀(메인 그리드 9개 + 사이드바 3개)을 12종 위젯 중 자유롭게 교체 가능. `Save / Reset / Cancel` 버튼으로 저장·초기화·취소. 레이아웃은 `dashboard_layouts` 테이블에 계정별 영구 저장.
- **`widgetRegistry.tsx`** — 위젯 정의 레지스트리.
- **`LayoutContext.tsx`** — 편집 상태·레이아웃 저장·불러오기 전담 Context.
- **`WidgetSlot.tsx`** — 편집 모드 오버레이 래퍼 컴포넌트.
- **`supabase/migrations/030_dashboard_layouts.sql`** — `dashboard_layouts` 테이블 신설.

### Added — Recruitment

- **직원 관리 기능** — 직원 등록·수정·삭제 CRUD + EmployeeForm UI.
- **급여명세서 크로스도메인 플로우** — Recruitment ↔ Documents 연계 재설계.

### Added — Documents

- **Operations 행정 신청서 3종** · **Tax&HR 핸들러** — 급여명세서 Excel 자동 생성, 세무 캘린더, 체크리스트.

---

## [1.5.0] — feature/sales-menu-pricing (Sales 메뉴 마스터 + 벤치마킹 + 목표 달성률)

### Added

- **`supabase/migrations/029_menus.sql`** · **`030_sales_timeslot.sql`** — `menus` 테이블 + `sales_records.time_slot` 컬럼.
- **`/api/menus`** CRUD · **`/api/stats/personal-benchmark`** · **`/api/stats/goal`** API.
- **`_sales/_menu_manager.py`** — 메뉴 upsert/delete/list + Pricing 서브허브 artifact.
- **`MenuListPanel.tsx`** — 마진율 게이지 + 원가 인라인 입력 패널.

---

## [1.4.2] — feature-signinup — feature-signinup (Sign up 페이지 신설 + Sign in·헤더·대시보드 UI 전면 리프레시)

### Added — Auth 페이지

- **`frontend/app/(auth)/signup/page.tsx`** — 신규. 이메일+비밀번호 Supabase Auth (`supabase.auth.signUp`) 회원가입 페이지. Sign in 과 동일 쉘(`max-w-1440`, 12-col bento, 5×6 `t-form`) + 비밀번호 강도 미터(10자+/대문자+소문자/숫자+특수문자 기준 4단계) + `STRENGTH_LABELS`. 우측 hero/stats/agents 3개 타일만 유지(preview/integrations/security/proof 제거).
- **`frontend/proxy.ts`** — `PUBLIC_PATHS = new Set(["/login", "/signup"])` 로 비로그인 허용 + 로그인 상태 진입 시 `/dashboard` 리다이렉트 대상에 signup 포함.

### Changed — Sign in 페이지

- **`frontend/app/(auth)/login/page.tsx`** — 레이아웃을 Sign up 과 동일 쉘로 정렬 (`max-w-1200 → 1440`, `grid-auto-rows 108 → 116`, `t-form span 6/5 → 5/6`, padding 30 → 32). 상단 `page-head` (“Sign in to BOSS” + 날짜) 제거, 하단 `t-tip` 타일 제거. 브랜드 텍스트 마크 → `/boss-logo.png` 이미지 (`h-8 w-auto`). 타일 모서리 `--radius: 20px → 5px`.

### Removed — Auth 다크 모드

- **`frontend/app/(auth)/login/page.tsx`** · **`.../signup/page.tsx`** — `Theme` 타입 + `theme` 상태 + `setTheme` + `data-theme={theme}` 속성 + 우하단 Light/Dark 토글 버튼 + `.boss-signin[data-theme="dark"]` / `.boss-signup[data-theme="dark"]` 전체 CSS 블록 + `.theme-toggle` 스타일 전부 제거. Light 테마 단일 운용.

### Changed — Header 재구조화

- **`frontend/components/layout/Header.tsx`** — `sidebar?: boolean` prop 추가. `true` (dashboard) 이면 ≥1500px 에서 `ProfileMemorySidebar` 와 동일 치수(`min-w-[220px] max-w-[320px] flex-1 basis-0`) 의 로고 슬롯을 좌측에 렌더해 그리드 오프셋을 흉내냄. 그리드 칼럼의 예비 로고는 `invisible` 로 공간 유지 → Logout 이 1400 박스 오른쪽 모서리에 고정. `false` (DomainPage 기본) 이면 사이드바 없이 중앙 `max-w-[1400px]`.
- **외곽 패딩 `px-4 md:px-6`** + inner wrapper `mx-auto w-full max-w-[1400px]` — 아래 그리드 컨테이너 (`p-4 md:p-6` / `max-w-[1400px]`) 와 정확히 동일한 박스 폭.
- **검색바 헤더 루트 기준 중앙** — `relative` 헤더에 `absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2` 로 뷰포트 정중앙 배치.
- **아이콘·경계선·배경 제거** — CalendarClock/History/MessageSquare/Send/LogOut/Search 아이콘 전부 삭제. 하단 `border-b border-[#ddd0b4]` 및 `bg-[#fbf6eb]` 제거 → 완전 투명 + 글자만.
- **`frontend/app/globals.css`** — `.bento-shell header { background: transparent; border: none }` 로 글로벌 정의 업데이트.
- **`frontend/app/dashboard/page.tsx`** — `<Header sidebar />` 로 사이드바 매칭 활성화.

### Removed — Dashboard 다크 모드

- **`frontend/components/layout/Header.tsx`** — `darkBg` 상태 + `toggleBg` + `localStorage.boss2:bg-dark` 로드/저장 + Sun/Moon 토글 버튼 + 관련 `lucide-react` import 전부 제거.
- **`frontend/app/globals.css`** — `html[data-bg="dark"] .bento-shell` 블록 2개 (shell 배경 + Kanban 테마 토큰 오버라이드) 삭제, 주석도 정리. 단일 light 팔레트만 유지.

### Changed — 대시보드 색상 팔레트

- **`frontend/app/globals.css`** — `.bento-shell { background: #f4f1ed → #f5f1ea }`.
- **`frontend/components/bento/ChatCenterCard.tsx`** — `bg-[#fefefe] → bg-[#ffffff]`.
- **`frontend/components/bento/types.ts`** — `DOMAIN_META` 배경 재정렬: recruitment `#f7e6da → #f1d9c7` · marketing `#f0d7df → #f4dbd9` · sales `#c4dbd9 → #cfd9cc` · documents `#c8c7d6 → #d9d4e6`.
- **`frontend/components/bento/ScheduleCard.tsx`** — `#cae0e4 → #eee3c4`.
- **`frontend/components/bento/ActivityCard.tsx`** — `#e3e9dd → #c6dad1`.
- **`frontend/components/bento/PreviousChatCard.tsx`** — `#d4e5e3 → #d9d4e6`.
- **`frontend/components/bento/CommentQueueCard.tsx`** — `#f0eaf8 → #f4dbd9`.
- **`frontend/components/bento/SubsidyMatchCard.tsx`** — `#e8f0e4 → #cfd9cc`.
- **`frontend/components/bento/ProfileMemorySidebar.tsx`** — ProfileCard `#f9e0e2 → #f1d9c7` · LongMemoryCard `#f8eaec → #eee3c4` · MemosCard `#f7ddd9 → #c6dad1`.

---

## [1.4.1] — feature/sales-stats-chart (Revenue 상세 모달 통계 패널 + 데이터 부족 UX 안내)

### Added — Sales 통계 패널

- **`frontend/components/sales/RevenueStatsPanel.tsx`** — 신규. `revenue_entry` artifact 상세 모달에 마운트되는 당월 통계 패널. `/api/stats/overview` + `/api/stats/daily` 2개 API 병렬 호출. 매출·비용·순이익 3카드(전월 대비 변화율 pill) + 일별 바 차트(ResizeObserver 기반 반응형 SVG, 오늘 날짜 강조). 데이터 없음 상태(빈 계정)는 챗봇 입력 가이드 문구 노출. 데이터 5일 미만 시 "데이터가 쌓일수록 분석이 정확해져요" 배너 표시.
- **`frontend/components/detail/NodeDetailModal.tsx`** — `revenue_entry` 타입 artifact 상세 모달 상단에 `RevenueStatsPanel` 조건부 렌더 추가 (`artifact.type === "revenue_entry" && accountId`).

## [1.4.0] — feature-documents (정부 지원사업 시스템 + 프로필 UI 개선 + 오케스트레이터 CHOICES 라우팅 강화)

### Added — 정부 지원사업 시스템

- **`supabase/migrations/026_subsidy_forms.sql`** — `subsidy_programs` 테이블: id·title·organization·region·program_kind·sub_kind·target·start_date·end_date·period_raw·is_ongoing·description·detail_url·external_url·form_files(jsonb)·hashtags(text[]). RLS + 인덱스.
- **`supabase/migrations/027_search_subsidy_programs.sql`** — `search_subsidy_programs(query_embedding, query_text, match_count)` RPC — pgvector 코사인 유사도 + FTS BM25 RRF 하이브리드 검색.
- **`supabase/migrations/028_subsidy_cache.sql`** — `subsidy_cache(account_id PK, results jsonb, computed_at, is_computing)` — 계정별 맞춤 추천 24h 캐시 테이블.
- **`backend/app/crawlers/`** — 지원사업 크롤러 패키지. 공공 API/웹 크롤링 → `subsidy_programs` 저장.
- **`backend/scripts/crawl_subsidies.py`** — 크롤러 CLI 실행 스크립트.
- **`backend/app/agents/_subsidy_cache.py`** — 신규. `get_cache(account_id)` · `maybe_refresh(account_id)` (24h TTL + 10분 stuck 타임아웃) · `invalidate_and_recompute(account_id)` · `_compute(account_id)` (프로필 + 장기기억 + RRF 검색 → `subsidy_cache` upsert).
- **`backend/app/routers/subsidies.py`** — `GET /api/subsidies/search` (전체 검색 + 필터) · `GET /api/subsidies/cache` (캐시 결과 + `is_computing` 플래그) · `POST /api/subsidies/cache/invalidate` (캐시 무효화 + 재계산 트리거).
- **`backend/app/routers/auth.py`** — 로그인 세션 touch 시 `await maybe_refresh(account_id)` 호출 — 캐시 만료 시 백그라운드 재계산.
- **`frontend/components/bento/SubsidyMatchCard.tsx`** — 신규 Bento 카드. `/api/subsidies/cache` 폴링(3초) — `is_computing` 동안 스피너. 항목 클릭 시 카드 안에서 상세 뷰 전환(설명·지역·대상·해시태그·다운로드/신청 버튼). 전체 모달은 `boss:open-subsidy-modal` 이벤트.
- **`frontend/components/layout/SubsidyModal.tsx`** — 신규 모달. 검색 + 카테고리 필터 + 아코디언 확장(D-Day 배지·대상·설명·해시태그·서식 파일 다운로드·Apply 버튼). `boss:open-subsidy-modal` 이벤트로 열림.
- **`frontend/components/layout/Header.tsx`** — `SubsidyModal` + `DMCampaignModal` 동시 마운트, `boss:open-subsidy-modal` 이벤트 수신 추가.
- **`frontend/components/bento/BentoGrid.tsx`** — `SubsidyMatchCard` 추가.

### Added — 프로필 UI 개선

- **`frontend/components/bento/ProfileMemorySidebar.tsx`** — 7개 core 필드 항상 표시(비어있으면 "—"), 전부 영문 라벨. Nickname 별도 섹션. `boss:artifacts-changed` 이벤트로 실시간 갱신.
- **`frontend/components/layout/ProfileModal.tsx`** — 전면 재작성. 전체 필드 편집 폼: Nickname·Business Name·Industry·Location·Stage·Staff·Channel·Goal 전부 영문. 저장 시 `boss:artifacts-changed` + subsidy 캐시 invalidate.
- **`frontend/components/chat/OnboardingFormCard.tsx`** — 신규. `[[ONBOARDING_FORM]]` 마커로 렌더. 업종·지역 필수 + 호칭·목표 선택 입력 → `profiles` 저장 + subsidy 캐시 invalidate.

### Added — InlineChat 빈 상태 도메인 capability grid

- **`frontend/components/chat/InlineChat.tsx`** — 빈 상태 UI 전면 교체. 하드코딩 랜덤 질문 대신 Sales·Recruitment·Marketing·Documents 4개 도메인별 capability 목록을 세로 섹션으로 나열. 항목 클릭 시 해당 프롬프트 자동 전송.

### Fixed — 오케스트레이터 CHOICES 오라우팅

- **`backend/app/agents/_planner.py`** — `plan()` 에 `choices_context: str | None = None` 파라미터 추가. 값이 있으면 `[직전 CHOICES 컨텍스트 — 최우선 라우팅 힌트]` 블록을 시스템 프롬프트에 주입 — 사용자 단답이 직전 CHOICES 선택지임을 플래너가 인식하도록 강제.
- **`backend/app/agents/orchestrator.py`** — `_dispatch_via_planner` 에서 `_last_assistant_unresolved_choices(history)` 감지 → `plan()` 에 전달. 직전 CHOICES 가 있는 상태에서 "마감 일정 추가" 같은 단답이 `mkt_campaign_plan` 으로 오라우팅되는 버그 수정.
- **`backend/app/agents/documents.py`** — `run_subsidy_recommend` 에 `confirm_deadline: bool = False` 파라미터 추가. 추천 성공 시 `due_date` 자동 저장 대신 `candidate_deadline` 임시 저장 + CHOICES(`마감 일정 추가 / 아니요`) 표시. 사용자 확인 후 `confirm_deadline=True` 재호출 시 `due_date` 로 승격. 결과 없을 때 이유 설명 + 개선 안내 추가.

---

## [1.3.4] — feature/sales-menu-analysis (Sales 메뉴별 수익성 분석 + 차트 시각화)

### Added — 메뉴별 수익성 분석 기능

- **`backend/app/agents/_sales/_menu_analysis.py`** — 신규. `analyze_menu(account_id, period, category, top_n)` — `sales_records` 기간별 집계 → 메뉴별 매출·판매량·매출비중·판매량비중 순위 반환. `_resolve_days()` 기간 키워드(오늘/이번주/이번달/3개월/전체 등) → 조회 일수 매핑. `format_analysis_text()` — 마크다운 순위표 + 핵심 인사이트 3줄.
- **`backend/app/agents/sales.py`** — `run_menu_analysis` 핸들러 추가. `period` / `category` / `top_n` 파라미터 지원. 분석 결과에 `[[MENU_CHART]]{JSON}[[/MENU_CHART]]` 마커 삽입 (프론트 차트 카드 연동). `[ARTIFACT]` 블록으로 Reports 서브허브에 자동 저장. `describe()` 에 `sales_menu_analysis` capability 등록.
- **`frontend/components/chat/MenuAnalysisCard.tsx`** — 신규. `[[MENU_CHART]]` 마커 파싱 (`extractMenuChartPayload`). 3탭 차트 카드: 가로 바 차트(매출 순위) · SVG 도넛 차트(카테고리별 비중) · SVG 산점도(가격 vs 판매량 4사분면). `ResizeObserver` 기반 반응형 너비. 외부 라이브러리 없이 순수 CSS/SVG 구현.
- **`frontend/components/chat/InlineChat.tsx`** — `MenuAnalysisCard` import + `menuChart` 필드를 `Message` 타입에 추가. 응답 수신·히스토리 로드 시 `extractMenuChartPayload` 파싱 → `MenuAnalysisCard` 조건부 표시.
- **`frontend/components/detail/NodeDetailModal.tsx`** — `sales_report` 타입 + `metadata.menu_chart` 보유 시 `MenuAnalysisCard` 렌더 조건 추가.

---

## [1.3.3] — feature-marketing (Instagram DM 자동 발송 캠페인)

### Added — Instagram DM Campaign

- **`supabase/migrations/026_instagram_dm_campaigns.sql`** — 신규. `instagram_dm_campaigns(id, account_id, post_id, post_url, post_thumbnail, trigger_keyword, dm_template, is_active, sent_count)` + `instagram_dm_sent(id, campaign_id, commenter_ig_id, commenter_name, sent_at)`. UNIQUE `(campaign_id, commenter_ig_id)` 중복 방지. RLS + 인덱스 + `updated_at` 트리거.
- **`backend/app/services/instagram_dm.py`** — 신규. 댓글 트리거 기반 자동 DM 서비스. `_fetch_comments(media_id, fb_token)` — `graph.facebook.com/v19.0` 댓글 폴링 (페이지네이션 포함). `_send_dm(ig_user_id, recipient_ig_id, message, ig_token)` — `graph.instagram.com/v25.0/me/messages` Bearer 헤더 DM 발송. `scan_and_send(account_id)` — 활성 캠페인 스캔 → 트리거 키워드 감지 → 중복 방지 → 병렬 발송.
- **`backend/app/routers/dm_campaigns.py`** — 신규. `GET/POST /api/dm-campaigns/` (목록·생성) · `PATCH/DELETE /api/dm-campaigns/{id}` (수정·삭제) · `POST /api/dm-campaigns/scan` (수동 스캔) · `GET /api/dm-campaigns/{id}/sent` (발송 이력).
- **`frontend/components/layout/DMCampaignModal.tsx`** — 신규. 720×560 대시보드 모달. 캠페인 생성 폼(게시물 ID·URL·트리거 키워드·DM 내용) + 활성화 토글 + 발송 이력 펼치기 + 수동 스캔 버튼.
- **`backend/app/main.py`** — `dm_campaigns` 라우터 마운트.
- **`frontend/components/layout/Header.tsx`** — "DM" 버튼 + `DMCampaignModal` 연결. `boss:open-dm-campaign-modal` 이벤트 수신.
- **`backend/app/core/config.py`** — `meta_ig_access_token: str = ""` 추가 (IGAA 토큰 — `graph.instagram.com` DM 발송용). 기존 `meta_access_token`은 EAA 토큰(댓글 조회)으로 역할 분리.

### Notes

- 댓글 조회: `graph.facebook.com/v19.0` + EAA 토큰 (`META_ACCESS_TOKEN`)
- DM 발송: `graph.instagram.com/v25.0/me/messages` + IGAA 토큰 (`META_IG_ACCESS_TOKEN`)
- 실제 DM 발송은 `instagram_manage_messages` Meta App Review 통과 후 Live 모드에서 동작

## [1.3.2] — feature/sales-csv-import (Sales CSV/Excel 매출 일괄 업로드)

### Added — Sales CSV/Excel 파일 파싱

- **`backend/app/agents/_sales/_csv_parser.py`** — 신규. CSV(`csv` 내장 + `utf-8-sig`/`cp949` 인코딩 자동 감지) / Excel(`.xlsx`, `openpyxl`) 파싱. GPT-4o-mini 로 컬럼명 자동 매핑(날짜·메뉴명·수량·단가·금액·카테고리). xlsx 파싱 실패 시 CSV 폴백 처리(이름만 `.xlsx`로 바꾼 파일 대응). `parse_sales_file(storage_path, bucket, mime_type, original_name)` 단일 진입점.
- **`backend/app/agents/sales.py`** — `run_parse_csv` 핸들러 추가(`@_traceable` 포함). `describe()` 조건부 capability 분기 개선: `pending_receipt` 의 `mime_type` / `original_name` 확장자로 CSV·Excel 여부 판별 → `sales_parse_csv` 또는 `sales_parse_receipt` 중 하나만 advertise. 날짜 컬럼 미인식 시 오늘 날짜 일괄 처리 + 안내 메시지 포함.

## [1.3.1] — feature/sales-langsmith (Sales 에이전트 LangSmith 트레이싱 + 터미널 로그)

### Added — Sales LangSmith 트레이싱

- **`backend/app/agents/sales.py`** — `langsmith.traceable` import (`try/except ImportError` fallback 포함). `LANGSMITH_API_KEY` 환경변수 존재 시 `os.environ.setdefault`로 `LANGSMITH_TRACING` / `LANGSMITH_PROJECT` 자동 주입. 핸들러 10개(`run_revenue_entry` · `run_sales_report` · `run_price_strategy` · `run_customer_script` · `run_promotion` · `run_sales_checklist` · `run_cost_entry` · `run_parse_receipt` · `run_save_revenue` · `run_save_costs`) + `run` 함수에 `@_traceable` 데코레이터 적용. 각 핸들러 진입 시 `log.info("[SALES] ...")` 터미널 로그 추가.
- **`backend/app/agents/_sales/_revenue.py`** — `@_traceable(name="sales._revenue.dispatch_save_revenue")` 적용.
- **`backend/app/agents/_sales/_costs.py`** — `@_traceable(name="sales._costs.dispatch_save_costs")` 적용.
- **`backend/app/agents/_sales/_ocr.py`** — `@_traceable(name="sales._ocr.parse_receipt_from_bytes")` 적용.
- **`backend/.env`** (gitignore) — `LANGSMITH_TRACING` / `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` 추가 (신규 키 이름 `LANGSMITH_*` 사용, 구버전 `LANGCHAIN_*` deprecated).

### Fixed

- **`backend/app/agents/sales.py`** — dev 머지 충돌 해결: 팀장 추가분 `@traceable` → `@_traceable` 로 통일 (fallback import 별칭과 일치).

## [1.3.0] — feature-marketing (YouTube Shorts AI 자동화 + Instagram Reels 업로드 + 댓글 자동 관리)

### Added — YouTube Shorts AI 자동화

- **`backend/app/services/shorts_gen.py`** — `generate_video_metadata(context, subtitles)` 신규 추가. GPT-4o가 쇼츠 영상 제목(60자·이모지), 설명(150자·해시태그), 태그(5-8개)를 자동 생성. `response_format=json_object` 강제.
- **`backend/app/routers/marketing.py`** — `preview-subtitles` 엔드포인트가 자막과 함께 `title / description / tags` 반환. `ShortsGenerateResponse`에 `reels_url / reels_error` 필드 추가. `upload_to_reels: bool = Form(False)` 파라미터로 Reels 동시 업로드 지원.
- **`frontend/components/chat/ShortsWizardCard.tsx`** — Step 1 버튼 "AI 자막·제목 생성"으로 변경. Step 3 각 필드에 "AI 추천" 배지 + 자동 채움 배너 표시. Step 4 "Instagram Reels에도 업로드" 토글 추가. 완료 시 Reels URL 링크 표시.

### Added — Instagram Reels 동시 업로드

- **`backend/app/services/instagram.py`** — `_create_reels_container()` + `publish_reels(video_url, caption, hashtags, share_to_feed)` 신규 추가. `media_type=REELS` Meta Graph API v19.0 사용. 컨테이너 준비 대기 `max_retries=20, interval=5.0`(최대 100초).
- **`backend/app/services/youtube.py`** — `_SCOPES`에 `youtube.force-ssl`(댓글 작성) + `youtube.readonly`(채널/영상 조회) 추가.

### Added — 댓글 자동 관리

- **`backend/app/services/comment_manager.py`** — 신규. YouTube/Instagram 댓글 수집 + AI 답글 초안 생성(GPT-4o) + 플랫폼 게시. YouTube는 채널 최근 10개 영상 × 20댓글, Instagram은 최근 10개 미디어 × 20댓글. `comment_id` 기반 중복 방지.
- **`backend/app/routers/comments.py`** — 신규. `GET /api/comments/` (status 필터) · `POST /scan` · `POST /{id}/post` · `POST /{id}/ignore` · `PATCH /{id}/reply`.
- **`backend/app/scheduler/tasks.py`** — `scan_comments` Celery 태스크 추가. `youtube_oauth_tokens` 보유 계정 전체 자동 스캔.
- **`backend/app/scheduler/celery_app.py`** — `comment-scan` beat 스케줄 3600s 간격 등록.
- **`supabase/migrations/024_comment_queue.sql`** — 신규. `comment_queue(id, account_id, platform, media_id, media_title, comment_id, commenter_name, comment_text, ai_reply, status, created_at, posted_at)` + RLS + `UNIQUE(account_id, platform, comment_id)` + 인덱스.
- **`frontend/components/bento/CommentQueueCard.tsx`** — 신규. 대기 댓글 수 배지 + 플랫폼 배지 + 작성자/댓글 미리보기. 클릭 시 CommentManagerModal 오픈. `boss:comments-changed` 리스너.
- **`frontend/components/layout/CommentManagerModal.tsx`** — 신규. 720×560 대시보드 모달. 상태 필터(대기 중/게시됨/무시됨/전체) + 댓글별 AI 답글 초안 인라인 편집 + 게시/수정/무시 액션.
- **`frontend/components/layout/Header.tsx`** — "Comments" 버튼 + `boss:open-comment-modal` 이벤트 리스너 + `<CommentManagerModal>` 마운트 추가.

### Changed — Bento Grid 레이아웃

- **`frontend/components/bento/BentoGrid.tsx`** — 하단 영역을 3×2 그리드(col 1-4 / 5-8 / 9-12, rows 5-8)로 재편. Chat History(4행), Upcoming Schedule·Comment Queue(각 2행), Recent Activity·Placeholder(각 2행). `CommentQueueCard` 추가.
- **`frontend/components/bento/ProfileMemorySidebar.tsx`** — Memos 카드 높이 `flex-1` → `flex-[0.75]` 소폭 축소.

## [1.2.2] — fix/kanban-column-scroll (Kanban 컬럼 고정 너비 제거 + 가로 스크롤 해소)

### Fixed — Frontend

- **`frontend/components/bento/KanbanColumn.tsx`** — 컬럼 너비를 고정 `w-[280px] shrink-0` 에서 유동 `flex-1 min-w-[200px]` 으로 변경. 5개 서브허브를 가진 Sales·Marketing 도메인에서 발생하던 가로 스크롤 제거. 4개 서브허브 도메인(Recruitment·Documents)은 컬럼이 화면 너비에 맞게 더 넓게 표시됨.

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
