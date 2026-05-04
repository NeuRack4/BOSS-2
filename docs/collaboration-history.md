# BOSS 협업 이력

**문서 번호:** BOSS-COLLAB-001  
**버전:** 1.0  
**작성일:** 2026-05-04  
**기준 버전:** v4.2.2 (총 492 커밋 · 107 PR)

---

## 목차

1. [팀 구성 및 기여 개요](#1-팀-구성-및-기여-개요)
2. [기여자별 담당 영역](#2-기여자별-담당-영역)
3. [브랜치 전략](#3-브랜치-전략)
4. [PR 이력](#4-pr-이력)

---

## 1. 팀 구성 및 기여 개요

| 팀원 | 역할 | GitHub | 커밋 수 | 주요 브랜치 |
|------|------|--------|---------|------------|
| **김재현** | Project Leader | `Afraid-Not` | 311 (63%) | `dev`, `feat-onboard*`, `fix-qa*`, `feature-operations`, `feature-admin` |
| **이민혜** | Agent Developer | `meene11` | 125 (25%) | `feature/sales_*`, `fix/kanban-*`, `fix/chatbot_*` |
| **송진우** | Agent Developer | `Blanc617` | 56 (11%) | `feature-marketing` |
| **합계** | — | — | **492** | — |

> 커밋 수는 `git shortlog -sn --all` 기준. 기여자별 GitHub 계정 별칭이 복수인 경우 통합 집계함 (김재현: `Afraid-Not` + `JaeHyeon Kim`, 이민혜: `meene` + `meene11`, 송진우: `Blanc617` + `jinu`).

---

## 2. 기여자별 담당 영역

### 2.1 김재현 — Project Leader

**배경:** 숭실대학교 철학 석사 · IBMxREDHAT 개발자 과정 수료 · 전) ZIPIDA AI 연구원

**핵심 담당:**

| 영역 | 세부 내용 |
|------|-----------|
| **전체 아키텍처 설계** | LangGraph StateGraph 설계, Planner → Domain 2계층 구조 수립, Capability 시스템 설계 |
| **Planner DeepAgent** | `_planner.py` — JSON-schema 강제, PlanResult 6모드(dispatch/ask/chitchat/refuse/planning/error), 2회 재시도 로직 |
| **LangGraph 오케스트레이터** | `orchestrator.py`, `builder.py`, `nodes.py` — StateGraph 조립, `route_plan()` 조건부 라우팅, `Send()` 병렬 팬아웃 |
| **RAG 파이프라인** | pgvector + PostgreSQL FTS → RRF 하이브리드 검색, 3-way 공정성 분석 |
| **메모리 시스템** | Redis 단기 메모리, pgvector 장기 메모리(7일 TTL), GPT-4o-mini 압축 |
| **Celery 스케줄러** | Beat 60초 tick, KST 기준 자율 실행, D-7/D-3/D-1/D-0 알림 |
| **프론트엔드 핵심** | Bento Grid 대시보드, InlineChat 렌더링 시스템(29종 카드), NodeDetailModal 전역 마운트, 특수 마커 파싱 |
| **온보딩 투어** | `TourOverlay`, `TourContext`, 투어 완료 인사 + LLM 환영 메시지 자동 트리거 (v4.2.0) |
| **어드민 페이지** | 유저·결제·통계·LLM 코스트 4탭 관리 (v3.7.0) |
| **QA 안정화** | `fix-qa`, `fix-qa3`, `fix-qa10`, `fix-qa11` 브랜치 — 전반적 버그 수정 다수 |
| **문서** | SRS, 프로젝트 계획서, PPT 시나리오, 협업 이력 |

**주요 커밋 예시:**

```
feat: v4.2.0 — 온보딩 투어 가이드
feat(tour): 투어 완료 시 LLM 환영 인사 자동 트리거
fix: v4.1.4 — Planner 프로필 재질문 차단 + 채팅 자동 스크롤
release: v4.0.0 — Vercel 프로덕션 배포
feat: v3.8.0 — Notice 알림 기능
chore: resolve CHANGELOG conflict, bump to v3.9.0
```

---

### 2.2 이민혜 — Agent Developer (매출 도메인)

**배경:** 새올행정시스템 유지보수 · 자바 풀스택 개발자 · UI 사업부 프로젝트 참여

**핵심 담당:**

| 영역 | 세부 내용 |
|------|-----------|
| **매출 에이전트 전체** | `sales.py` + `_sales/` 서브패키지 — 매출·비용 자연어 입력, OCR, 통계, 메뉴 관리 |
| **SalesInputTable / CostInputTable** | 인라인 테이블 폼 카드, pending_save 강제 override 로직 |
| **영수증 OCR** | GPT-4o Vision 기반 자동 type 분류(sales/cost) — `feature/sales_ocr_langgraph` |
| **매출 통계 대시보드** | `/api/stats/` 월간·일일·상위 항목 차트 — `feature/sales_dashboard` |
| **메뉴 관리** | 메뉴별 원가·마진 분석, 메뉴 일괄 등록 capability (v4.1.20) |
| **Slack 연동** | 매출 알림 Slack OAuth 연동, 폴링 무한 반복 버그 수정 (v4.1.19) |
| **Kanban 안정화** | 카드 이동 후 글자 투명 현상 수정 (v4.1.12) — `fix/kanban-drag-opacity` |
| **버그 수정** | 서비스 매출 입력 흐름 미동작 (v4.2.2), 영수증 이미지 라우팅 오류 (v4.2.1) |

**주요 커밋 예시:**

```
fix(sales): v4.2.2 — 서비스 매출 입력 흐름 미동작 수정
fix(sales): v4.2.1 — 영수증 이미지 이력서 오라우팅 버그 수정
feat(sales): v4.1.20 — 메뉴 일괄 등록 capability 추가
fix(slack): v4.1.19 — Slack 연동 폴링 무한 반복 문제 수정
fix(kanban): v4.1.12 — 카드 이동 후 글자 투명 현상 수정
fix(sales): v4.1.8 — 대시보드 UX 개선: 거짓말 버튼 제거 + 빈 상태 통일
```

---

### 2.3 송진우 — Agent Developer (마케팅 도메인)

**배경:** 성결대학교 컴퓨터공학전공 · 자바 풀스택 개발자 · 팀 프로젝트 팀장 다수 경험

**핵심 담당:**

| 영역 | 세부 내용 |
|------|-----------|
| **마케팅 에이전트 전체** | `marketing.py` — SNS 포스트·블로그·광고카피·리뷰답글·마케팅 캘린더 |
| **Instagram 자동화** | Meta Graph API 자동 게시, DALL-E 3 이미지, 사진 라이브러리 — `feature-marketing` |
| **YouTube Shorts** | 4단계 위저드 (스크립트→자막→TTS→영상 합성), Google OAuth 연동 |
| **네이버 블로그** | Playwright 기반 포스트 자동 업로드 |
| **계정별 OAuth 격리** | Instagram·YouTube 계정별 자격증명 격리, Redirect URI 설정 (v4.1.10) |
| **Bento Grid 레이아웃** | 대시보드 레이아웃 조정 (v4.1.13) |

**주요 커밋 예시:**

```
fix(marketing): v4.1.15 — 인스타·유튜브·네이버·결제 다수 개선
fix(marketing): YouTube·Instagram 계정별 OAuth 설정 + 댓글 자격증명 격리 (v4.1.10)
fix(marketing): Instagram 연결 버튼 동작 + 계정별 자격증명 격리 (v4.1.8)
feat(dashboard): BentoGrid 레이아웃 조정 (v4.1.13)
fix: v4.0.2 — ngrok Script 위치 및 strategy 수정 (hydration 에러 해소)
```

---

## 3. 브랜치 전략

```
main ──────────────────────────────────────── 릴리스 스냅샷
  └── dev ◄───────────── 모든 feature/fix PR의 병합 대상
          ├── feature-marketing         (송진우 — 마케팅 에이전트)
          ├── feature/sales_*           (이민혜 — 매출 에이전트)
          ├── feat-onboard / feat-onboard-2  (김재현 — 온보딩 투어)
          ├── feature-admin             (김재현 — 어드민 페이지)
          ├── feature-operations        (김재현 — 운영 기능)
          ├── fix-qa / fix-qa3 / fix-qa10 / fix-qa11  (김재현 — QA 안정화)
          ├── fix/kanban-drag-opacity   (이민혜 — Kanban 버그)
          ├── fix/chatbot_artifact_message (이민혜 — 채팅 버그)
          └── fix/ngrok-fetch-patch     (송진우 — 배포 이슈)
```

| 브랜치 패턴 | 주 담당자 | 용도 |
|------------|----------|------|
| `feature-marketing` | 송진우 | 마케팅 에이전트 기능 개발 |
| `feature/sales_*` | 이민혜 | 매출 에이전트 기능 개발·버그 수정 |
| `feat-onboard*` | 김재현 | 온보딩 투어 |
| `feature-admin` | 김재현 | 어드민 대시보드 |
| `fix-qa*` | 김재현 | 전반적 QA·안정화 |
| `fix/kanban-*`, `fix/chatbot_*` | 이민혜 | 프론트엔드 버그 수정 |
| `fix/ngrok-*` | 송진우 | 배포 환경 수정 |

---

## 4. PR 이력

총 **107개 PR** — `dev` 브랜치 기준 병합 완료.

### Phase 6 — 운영 & 고도화 (PR #63 ~ #107)

| PR | 브랜치 | 담당자 | 주요 내용 |
|----|--------|--------|-----------|
| #107 | `feature/sales_bugB_service_revenue` | 이민혜 | fix(sales): v4.2.2 — 서비스 매출 입력 흐름 수정 |
| #106 | `feature/sales_bugPicture_fix` | 이민혜 | fix(sales): v4.2.1 — 영수증 이미지 라우팅 버그 수정 |
| #103 | `feature/sales_menu_auto_register` | 이민혜 | feat(sales): v4.1.20 — 메뉴 일괄 등록 capability |
| #102 | `feature/sales_polling_fix` | 이민혜 | fix(slack): v4.1.19 — Slack 폴링 무한 반복 수정 |
| #100 | `fix-qa11` | 김재현 | fix: QA 안정화 4차 — 다수 버그 수정 |
| #99 | `feature-marketing` | 송진우 | fix(marketing): v4.1.15~18 — SNS 연동 개선 |
| #97 | `fix-qa11` | 김재현 | fix: QA 안정화 3차 |
| #95 | `feature/sales_fix_revenue` | 이민혜 | fix(sales): v4.1.15~16 — Revenue 서브허브·통계 수정 |
| #94 | `fix-qa11` | 김재현 | fix: QA 안정화 2차 |
| #93 | `fix-qa11` | 김재현 | fix: QA 안정화 1차 |
| #92 | `feature-marketing` | 송진우 | fix(marketing): v4.1.13 — 마케팅 다수 개선 |
| #91 | `fix/kanban-drag-opacity` | 이민혜 | fix(kanban): v4.1.12 — 카드 이동 글자 투명 수정 |
| #90 | `feature-marketing` | 송진우 | fix(marketing): v4.1.11 — YouTube Redirect URI 제거 |
| #89 | `feature-marketing` | 송진우 | fix(marketing): v4.1.10 — 계정별 OAuth 격리 |
| #88 | `fix-qa10` | 김재현 | fix: QA 안정화 (fix-qa10) 2차 |
| #87 | `feature-marketing` | 송진우 | fix(marketing): 데이터 품질 가드 + YouTube 검증 |
| #86 | `feature-marketing` | 송진우 | fix(marketing): v4.1.8 — Instagram 연결 버튼 수정 |
| #85 | `feature/sales_inlineBtn_remove` | 이민혜 | fix(sales): v4.1.8 — 대시보드 UX 개선 |
| #84 | `fix-qa10` | 김재현 | fix: QA 안정화 (fix-qa10) 1차 |
| #78 | `feature/sales_fix_test1` | 이민혜 | fix(sales): 다중 버그 수정 3건 |
| #74 | `fix-qa` | 김재현 | fix(qa): v4.1.3 — QA 전반 안정성 개선 |
| #73 | `fix/chatbot_artifact_message` | 이민혜 | fix(chatbot): 히스토리 클릭 이벤트 전파 차단 |
| #72 | `dev` | 김재현 | chore: dev 동기화 |
| #71 | `feature-marketing` | 송진우 | feat(marketing): v4.1.1 — 마케팅 기능 추가 |
| #70 | `feature/sales_ocr_langgraph` | 이민혜 | feat(sales): OCR LangGraph 연동 |
| #69 | `dev` | 김재현 | chore: dev 동기화 |
| #68 | `fix/ngrok-fetch-patch` | 송진우 | fix: v4.0.2 — ngrok hydration 에러 수정 |
| #65 | `fix/sales_notification_toggle` | 이민혜 | fix: 매출 알림 토글 수정 |
| #64 | `feature/sales_notification` | 이민혜 | feat(sales): 매출 알림 기능 |
| #63 | `fix-kvcaching` | 김재현 | fix: KV 캐싱 이슈 수정 |

---

### Phase 5 — 서비스 확장 (PR #42 ~ #62)

| PR | 브랜치 | 담당자 | 주요 내용 |
|----|--------|--------|-----------|
| #62 | `feature-marketing` | 송진우 | feat(marketing): v3.9.0 — 마케팅 기능 확장 |
| #61 | `feature/sales_menu_inline_cost` | 이민혜 | feat(sales): 메뉴 인라인 비용 입력 |
| #60 | `feature-admin` | 김재현 | feat(admin): v3.7.0 — 어드민 페이지 4탭 |
| #59 | `feature-marketing` | 송진우 | feat(marketing): v3.6.0 — 마케팅 고도화 |
| #58 | `feature-marketing` | 송진우 | feat(marketing): v3.5.0 — YouTube Shorts 위저드 |
| #57 | `feature/sales_dashboard` | 이민혜 | feat(sales): 매출 통계 대시보드 |
| #56 | `feature-marketing` | 송진우 | feat(marketing): 마케팅 캘린더 + DALL-E 3 포스터 |
| #55 | `feature/test_refactor_sales` | 이민혜 | refactor(sales): 매출 에이전트 리팩토링 |
| #54 | `feature/sales_bugfix` | 이민혜 | fix(sales): 다수 버그 수정 |
| #53 | `feature-marketing` | 송진우 | feat(marketing): Instagram DM 캠페인 |
| #52 | `feature-login` | 김재현 | feat: 로그인 페이지 개선 |
| #51 | `feature/sales_shortmenu` | 이민혜 | feat(sales): 빠른 메뉴 등록 |
| #49 | `feature/sales-phase2` | 이민혜 | feat(sales): 매출 Phase 2 — POS 연동 + 통계 API |
| #48 | `feature-marketing` | 송진우 | feat(marketing): 네이버 블로그 자동 업로드 |
| #47 | `feature-recruit` | 김재현 | feat(recruit): 채용 에이전트 개선 |
| #46 | `feature/sales_agent_test` | 이민혜 | test(sales): 매출 에이전트 테스트 |
| #45 | `feature-marketing` | 송진우 | feat(marketing): Instagram Meta Graph API 자동 게시 |
| #44 | `feature/sales-rag-agentic-loop` | 이민혜 | feat(sales): RAG + Agentic Loop 연동 |
| #43 | `feature/sales-stats-enhancement` | 이민혜 | feat(sales): 통계 API 고도화 |
| #42 | `feature-operations` | 김재현 | feat: 운영 기능 — Slack·Square·PortOne 연동 |

---

### Phase 3~4 — 도메인 에이전트 + SNS·UI (PR #2 ~ #41)

| PR | 브랜치 | 담당자 | 주요 내용 |
|----|--------|--------|-----------|
| #41 | `feature-operations` | 김재현 | feat: PortOne PG 구독 결제 + Webhook |
| #38~40 | `feature-marketing` | 송진우 | feat(marketing): 이벤트 포스터 + 마케팅 캘린더 |
| #36~37 | `feature-operations` | 김재현 | feat: YouTube OAuth + 인사이트 수집 |
| #32 | `feature-marketing` | 송진우 | feat(marketing): SNS 카피·리뷰 답글 생성 |
| #31 | `feature/documents` | 김재현 | feat(documents): 서류 에이전트 — 공정성 분석 |
| #30 | `feature/sales-menu-pricing` | 이민혜 | feat(sales): 메뉴 수익성 분석 + 가격 전략 |
| #28 | `feature-signinup` | 김재현 | feat: 회원가입·로그인 UI 개선 |
| #27 | `feature/sales-stats-chart` | 이민혜 | feat(sales): 매출 통계 차트 |
| #26 | `feature-documents` | 김재현 | feat(documents): DOCX 자동 생성 + 법률 자문 |
| #25 | `feature/sales-menu-analysis` | 이민혜 | feat(sales): 메뉴별 원가·마진 분석 |
| #24 | `feature-marketing` | 송진우 | feat(marketing): DALL-E 3 이미지 생성 |
| #23 | `feature/sales-csv-import` | 이민혜 | feat(sales): Excel/CSV 업로드 + idempotent dedup |
| #22 | `feature/sales-langsmith` | 이민혜 | feat: LangSmith LLM 추적 연동 |
| #21 | `feature-documents` | 김재현 | feat(documents): 급여명세서 DOCX 생성 |
| #20 | `feature-marketing` | 송진우 | feat(marketing): 마케팅 에이전트 기초 |
| #19 | `fix/kanban-column-scroll` | 김재현 | fix(kanban): 컬럼 스크롤 수정 |
| #18 | `fix/sales-input-error` | 이민혜 | fix(sales): 매출 입력 오류 수정 |
| #17 | `feature-documents` | 김재현 | feat(documents): 계약서 공정성 3-way RAG 분석 |
| #16 | `feature/sales-ocr` | 이민혜 | feat(sales): 영수증 OCR 기초 구현 |
| #15 | `feature-marketing` | 송진우 | feat(marketing): SNS 포스트 생성 |
| #13 | `feature-marketing` | 송진우 | feat(marketing): 마케팅 Capability 등록 |
| #12 | `feature-documents` | 김재현 | feat(documents): 문서 업로드 자동 분류 |
| #11 | `feature/sales-analytics` | 이민혜 | feat(sales): 매출 분석 기초 |
| #10 | `feature-documents` | 김재현 | feat(documents): 서류 에이전트 기초 |
| #9 | `feature-marketing` | 송진우 | feat(marketing): 이벤트 포스터 HTML 생성 |
| #8 | `feature-marketing` | 송진우 | feat(marketing): 마케팅 에이전트 MVP |
| #7 | `feature/sales-agent` | 이민혜 | feat(sales): 매출 에이전트 MVP |
| #6 | `feature-documents` | 김재현 | feat(documents): 서류 도메인 초기 구조 |
| #5 | `feature-marketing` | 송진우 | feat(marketing): 마케팅 도메인 초기 구조 |
| #4 | `feature-documents` | 김재현 | feat(documents): 문서 도메인 초기 구조 |
| #3 | `feature-marketing` | 송진우 | feat(marketing): 마케팅 도메인 스캐폴드 |
| #2 | `feature-documents` | 김재현 | feat(documents): 서류 도메인 스캐폴드 |

---

*문서 끝 — BOSS-COLLAB-001 v1.0*
