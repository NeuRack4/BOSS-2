# BOSS-2 소프트웨어 요구사항 명세서 (SRS)

**문서 번호:** BOSS2-SRS-001  
**버전:** 1.0  
**작성일:** 2026-05-04  
**작성자:** BOSS-2 개발팀  
**상태:** 초안

---

## 목차

1. [소개](#1-소개)
2. [전체 설명](#2-전체-설명)
3. [기능 요구사항](#3-기능-요구사항)
4. [비기능 요구사항](#4-비기능-요구사항)
5. [외부 인터페이스 요구사항](#5-외부-인터페이스-요구사항)
6. [시스템 제약 및 기타](#6-시스템-제약-및-기타)

---

## 1. 소개

### 1.1 목적

본 문서는 **BOSS-2** 시스템의 소프트웨어 요구사항을 IEEE 830 표준에 따라 명세한다. BOSS-2는 AI 기반 소상공인 자율 운영 플랫폼으로, 개발팀·투자자·심사위원·외부 이해관계자가 시스템의 기능·비기능 요구사항을 명확히 이해할 수 있도록 작성되었다.

### 1.2 범위

**제품명:** BOSS-2 (Business Operations Support System v2)

**제품 설명:**  
BOSS-2는 소상공인이 채용·마케팅·매출·문서 관리 업무를 AI 에이전트와의 자연어 대화만으로 처리할 수 있도록 지원하는 플랫폼이다. LangGraph 기반의 멀티 에이전트 오케스트레이션 위에 Planner → Domain 2계층 구조의 DeepAgent가 동작하며, 생성된 업무 결과물(Artifact)은 Celery Beat 스케줄러를 통해 자율적으로 반복 실행된다.

**포함 범위:**
- 사용자 인증 및 프로필 관리
- AI 채팅 인터페이스 (Planner + 4개 도메인 에이전트)
- 업무 결과물(Artifact) 캔버스 및 관리
- 자율 실행 스케줄러
- 지식베이스 RAG (Retrieval-Augmented Generation)
- 단기·장기 메모리 시스템
- 관리자 대시보드

**제외 범위:**
- 모바일 네이티브 앱 (iOS/Android)
- 외부 POS 기기 하드웨어 연동
- 결제 게이트웨이 직접 처리 (3rd-party 위임)

### 1.3 정의·약어·용어

| 용어 | 정의 |
|------|------|
| **Artifact** | AI 에이전트가 생성한 업무 결과물 (채용공고, 마케팅 카피, 매출 리포트, 계약서 초안 등) |
| **Planner DeepAgent** | 사용자 메시지를 분석해 실행 계획(PlanResult)을 수립하는 최상위 AI 에이전트 |
| **Domain Agent** | Recruitment·Marketing·Sales·Documents 4개 업무 도메인별 전문 AI 에이전트 |
| **Capability** | 도메인 에이전트가 수행할 수 있는 개별 작업 단위 (예: `write_job_posting`, `create_sns_copy`) |
| **PlanResult** | Planner가 생성하는 실행 계획 JSON 구조체 |
| **LangGraph** | 에이전트 워크플로우를 유향 그래프(StateGraph)로 정의하는 Python 라이브러리 |
| **RAG** | Retrieval-Augmented Generation. 벡터 DB 검색 결과를 LLM 컨텍스트에 주입하는 기법 |
| **RRF** | Reciprocal Rank Fusion. 여러 검색 결과를 통합하는 앙상블 알고리즘 |
| **Celery Beat** | Python 분산 태스크 큐의 주기적 실행 스케줄러 |
| **Sub-hub** | 도메인별 업무 분류 카테고리 (예: 채용 → 공고관리·면접·평가·계약) |
| **account_id** | 시스템 내 사업체 단위의 고유 식별자 |
| **KST** | Korea Standard Time (UTC+9) |
| **pgvector** | PostgreSQL 벡터 유사도 검색 확장 |

### 1.4 참고 문서

| 문서 | 위치 |
|------|------|
| 프로젝트 아키텍처 가이드 | `CLAUDE.md` |
| 온보딩 투어 설계서 | `docs/superpowers/specs/2026-05-02-onboarding-tour-design.md` |
| DeepAgent 리팩토링 설계서 | `docs/superpowers/specs/2026-04-26-deepagent-refactor-design.md` |
| 관리자 페이지 설계서 | `docs/superpowers/specs/2026-04-28-admin-page-design.md` |
| PPT 시나리오 | `docs/ppt-scenario.md` |

### 1.5 개요

본 문서는 다음 순서로 구성된다.

- **2장** — 시스템 컨텍스트, 기능 요약, 사용자 특성, 제약·가정
- **3장** — 기능 요구사항 (FR-xxx 번호 체계)
- **4장** — 비기능 요구사항 (NFR-xxx 번호 체계)
- **5장** — 외부 인터페이스 요구사항
- **6장** — 시스템 제약 및 기타

---

## 2. 전체 설명

### 2.1 제품 관점

BOSS-2는 독립형(standalone) 웹 애플리케이션으로, 아래 외부 시스템과 연동한다.

```
┌──────────────────────────────────────────────────────┐
│                    사용자 (브라우저)                    │
└─────────────────────┬────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼────────────────────────────────┐
│           Frontend (Next.js 16 App Router)           │
│   InlineChat · Canvas · Kanban · Dashboard · Auth    │
└─────────────────────┬────────────────────────────────┘
                      │ REST API / SSE
┌─────────────────────▼────────────────────────────────┐
│           Backend (FastAPI / Python async)           │
│  Orchestrator → LangGraph → Planner + Domain Agents  │
├──────────────┬───────────────────┬───────────────────┤
│  Supabase    │  Redis (Cache)    │  Celery Beat      │
│  PostgreSQL  │  단기 메모리       │  자율 스케줄 실행   │
│  pgvector    │                   │                   │
└──────────────┴───────────────────┴───────────────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
      OpenAI API   BAAI/bge-m3  외부 서비스
      (LLM)        (Embedding)  (결제·알림 등)
```

### 2.2 제품 기능 요약

| # | 기능 그룹 | 설명 |
|---|-----------|------|
| F1 | 인증·온보딩 | 회원가입·로그인·프로필 설정·온보딩 투어 |
| F2 | AI 채팅 | 자연어 대화로 업무 지시 및 결과 수신 |
| F3 | Artifact 캔버스 | 생성된 업무 결과물 조회·편집·공유 |
| F4 | 자율 스케줄러 | Artifact에 cron 설정 → 자율 반복 실행 |
| F5 | 채용 관리 | 공고 작성·면접 안내·평가·계약서 생성 |
| F6 | 마케팅 관리 | SNS 카피·이메일·DM 캠페인 생성·발송 |
| F7 | 매출 관리 | 매출 입력·분석·리포트·보조금 탐색 |
| F8 | 문서 관리 | 계약서·세무·법률·운영 문서 초안 생성 |
| F9 | 지식베이스 RAG | 업로드 문서 임베딩·하이브리드 검색 |
| F10 | 메모리 | 단기(Redis)·장기(pgvector) 대화 기억 |
| F11 | 관리자 | 사용자·Artifact·시스템 현황 모니터링 |

### 2.3 사용자 특성

| 사용자 유형 | 기술 수준 | 주요 사용 목적 |
|------------|----------|---------------|
| **소상공인 사업주** | 비IT, 스마트폰·PC 기본 수준 | 일상 업무 자동화, 보고서·공고 생성 |
| **직원 (매니저급)** | 기본 IT 소양 | 특정 도메인(채용·매출) 업무 위임 |
| **시스템 관리자** | 개발자 수준 | 사용자 관리, 로그 모니터링, 설정 |

### 2.4 제약 사항

| 유형 | 제약 내용 |
|------|-----------|
| **기술** | Python 3.12+, Node.js 20+, PostgreSQL 15+ (Supabase 관리형) |
| **보안** | Supabase service_role key는 백엔드 전용. 모든 쿼리에 `account_id` 필터 필수 |
| **법적** | 개인정보보호법 준수. 채용 공고는 노동법 적합성 검토 후 생성 |
| **시간** | 스케줄러는 KST 기준 동작 (`Asia/Seoul`). UTC 변환 없이 저장 |
| **LLM** | OpenAI API 토큰 한도 준수. 장기 메모리 압축으로 컨텍스트 관리 |
| **임베딩** | BAAI/bge-m3 (1024-dim) 로컬 실행. GPU 없을 시 CPU 폴백 |

### 2.5 가정 및 의존성

- Supabase 프로젝트가 프로비저닝되어 있고 마이그레이션이 순서대로 적용되었다고 가정
- OpenAI API 키가 유효하며 GPT-4o 계열 모델에 접근 가능하다고 가정
- Redis 인스턴스가 백엔드와 동일 네트워크에서 동작한다고 가정
- Celery Worker 및 Beat가 별도 프로세스로 실행된다고 가정
- 클라이언트는 Chromium 계열 최신 브라우저를 사용한다고 가정

---

## 3. 기능 요구사항

> 요구사항 번호 체계: `FR-[도메인]-[번호]`  
> 우선순위: **필수(M)** · 중요(S) · 선택(C)

---

### 3.1 사용자 인증 및 온보딩

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-AUTH-001 | 시스템은 이메일+비밀번호 기반 회원가입 기능을 제공해야 한다. | M |
| FR-AUTH-002 | 시스템은 로그인 성공 시 JWT 세션 토큰을 발급하고, 프록시(`proxy.ts`)가 Public 경로(`/login`, `/signup`) 외 모든 요청을 인증 게이트로 보호해야 한다. | M |
| FR-AUTH-003 | 사업체명·업종·운영 기간·직원 수·소재지·연락처·SNS 채널 등 7개 핵심 프로필 필드를 온보딩 단계에서 수집해야 한다. | M |
| FR-AUTH-004 | 핵심 프로필 필드 중 3개 미만 입력 시 매 대화 턴마다 프로필 입력 유도 메시지를 강하게 노출해야 한다. | S |
| FR-AUTH-005 | 최초 로그인 시 서비스 사용법을 안내하는 온보딩 투어를 제공해야 한다. | S |
| FR-AUTH-006 | 사용자는 AI 대화를 통해 닉네임(`[SET_NICKNAME]` 마커)과 프로필(`[SET_PROFILE]` 마커)을 자연어로 변경할 수 있어야 한다. | S |

---

### 3.2 AI 채팅 (Planner + 도메인 에이전트)

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-CHAT-001 | 시스템은 사용자의 자연어 메시지를 수신하여 Planner DeepAgent가 `dispatch·ask·chitchat·refuse·planning·error` 중 하나의 모드로 분류한 PlanResult를 반환해야 한다. | M |
| FR-CHAT-002 | Planner는 `dispatch_plan` 또는 `ask_user` 중 하나를 반드시 호출해야 종료되며, 2회 재시도 후에도 실패 시 `error` 모드 응답을 반환해야 한다. | M |
| FR-CHAT-003 | `dispatch` 모드에서 `depends_on`이 없는 steps는 LangGraph `Send()`를 통해 병렬로 실행되어야 한다. | M |
| FR-CHAT-004 | 시스템은 최초 로그인·8시간 이상 미접속·스케줄 실패 상황에서 자동 브리핑 메시지를 생성해야 한다. | S |
| FR-CHAT-005 | 채팅 응답은 `[CHOICES]`, `[ACTION:*]`, `[[ONBOARDING_FORM]]`, `[ARTIFACT]`, `[JOB_POSTINGS]` 등 특수 마커를 포함할 수 있으며, 프론트엔드는 이를 파싱하여 인터랙티브 UI로 렌더링해야 한다. | M |
| FR-CHAT-006 | 대화 히스토리는 20턴 초과 시 gpt-4o-mini로 자동 압축되어야 한다. | S |
| FR-CHAT-007 | 모든 에이전트 노드는 `account_id` 스코프의 컨텍스트를 thread-safe하게 주입받아야 한다. | M |
| FR-CHAT-008 | Planner는 사용자 질의에 앞서 `list_capabilities`, `get_profile`, `get_recent_artifacts`, `search_memos` 도구를 활용하여 컨텍스트를 수집할 수 있어야 한다. | M |

---

### 3.3 캔버스 (Artifact 관리)

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-CANVAS-001 | 시스템은 AI 에이전트가 생성한 Artifact를 캔버스 UI에 실시간(`Supabase Realtime`)으로 표시해야 한다. | M |
| FR-CANVAS-002 | 사용자는 Artifact를 조회·편집·삭제·공유할 수 있어야 한다. | M |
| FR-CANVAS-003 | Artifact 상세 보기는 `NodeDetailModal` 단일 인스턴스(`NodeDetailContext`)를 통해 렌더링되어야 하며, 도메인별 중복 모달을 생성하지 않아야 한다. | M |
| FR-CANVAS-004 | Artifact는 `kind` 필드로 유형(채용공고·마케팅·매출·문서·log 등)을 구분하고, `logged_from` 엣지로 원본 Artifact와 연결되어야 한다. | M |
| FR-CANVAS-005 | Artifact 생성·변경 시 `boss:artifacts-changed` 커스텀 이벤트를 `window`에 dispatch하여 프로필 사이드바·카드가 자동 갱신되어야 한다. | S |

---

### 3.4 자율 스케줄러

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-SCHED-001 | 사용자는 Artifact의 `metadata.schedule_enabled` 토글로 자율 반복 실행을 활성화/비활성화할 수 있어야 한다. | M |
| FR-SCHED-002 | 스케줄 설정은 `metadata.cron`, `metadata.next_run`, `metadata.schedule_status` 필드로 Artifact 메타데이터에 저장되어야 한다. | M |
| FR-SCHED-003 | Celery Beat의 `tick` 태스크(60초 주기)는 `schedule_enabled=true`인 Artifact를 KST 기준으로 실행해야 한다. | M |
| FR-SCHED-004 | 스케줄 D-7·D-3·D-1·D-0 도래 시 `activity_logs.schedule_notify`에 알림을 기록해야 한다. | S |
| FR-SCHED-005 | 스케줄 실행 결과는 `kind='log'` Artifact로 저장되고 원본과 `logged_from` 엣지로 연결되어야 한다. | M |
| FR-SCHED-006 | 스케줄 실패 시 다음 브리핑 턴에 실패 정보를 포함한 요약이 제공되어야 한다. | S |

---

### 3.5 채용 도메인

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-REC-001 | 시스템은 사업체 정보와 채용 조건을 기반으로 채용공고 초안을 자동 생성해야 한다. | M |
| FR-REC-002 | 생성된 채용공고는 노동법 적합성(최저임금, 근로조건 명시 등)을 검토 후 제시되어야 한다. | M |
| FR-REC-003 | 지원자 이력서 업로드 시 파싱·분석하여 면접 질문 초안을 자동 생성해야 한다. | M |
| FR-REC-004 | 시스템은 면접 평가 결과를 기록하고 채용 여부 권고 의견을 제공해야 한다. | S |
| FR-REC-005 | 근로계약서 초안을 자동 생성하고 DOCX 포맷으로 다운로드할 수 있어야 한다. | M |
| FR-REC-006 | 채용 Sub-hub는 공고관리·면접·평가·계약 4개 카테고리로 구성되어야 한다. | M |

---

### 3.6 마케팅 도메인

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-MKT-001 | 시스템은 업종·타깃 고객·프로모션 정보를 기반으로 SNS 게시물(인스타그램·네이버 블로그·카카오채널) 카피를 생성해야 한다. | M |
| FR-MKT-002 | 이메일 마케팅 템플릿 및 발송 스케줄을 생성할 수 있어야 한다. | S |
| FR-MKT-003 | DM 캠페인을 생성하고 발송 내역을 관리할 수 있어야 한다. | S |
| FR-MKT-004 | 마케팅 콘텐츠에 이미지 URL 또는 첨부 파일을 연결할 수 있어야 한다. | S |
| FR-MKT-005 | 마케팅 Sub-hub는 SNS·이메일·DM·광고·이벤트 5개 카테고리로 구성되어야 한다. | M |

---

### 3.7 매출 도메인

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-SALES-001 | 사용자는 일별·주별·월별 매출을 입력하고 조회할 수 있어야 한다. | M |
| FR-SALES-002 | 영수증 이미지 업로드 시 OCR로 매출 데이터를 자동 추출하여 입력할 수 있어야 한다. | S |
| FR-SALES-003 | 시스템은 매출 트렌드 분석 및 시각화 리포트를 생성해야 한다. | M |
| FR-SALES-004 | 메뉴·상품별 매출 비중 분석을 제공해야 한다. | S |
| FR-SALES-005 | 정부 보조금·지원사업 검색 및 신청 안내를 제공해야 한다. | S |
| FR-SALES-006 | POS 연동 데이터를 매출 DB와 동기화할 수 있어야 한다. | C |
| FR-SALES-007 | 매출 Sub-hub는 매출입력·분석·메뉴관리·비용·보조금 5개 카테고리로 구성되어야 한다. | M |

---

### 3.8 문서 도메인

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-DOC-001 | 시스템은 계약서·임대차·프랜차이즈 계약 등 법률 문서 초안을 자동 생성해야 한다. | M |
| FR-DOC-002 | 업로드된 계약서에 대해 3-way RRF(법령·위험조항·허용조항) 기반 공정성 분석을 수행해야 한다. | M |
| FR-DOC-003 | 세무·HR 관련 서식(원천징수, 4대보험 등) 작성을 지원해야 한다. | S |
| FR-DOC-004 | 운영 매뉴얼·공지사항·내부 규정 등 운영 문서 초안을 생성할 수 있어야 한다. | S |
| FR-DOC-005 | 생성된 문서는 DOCX 포맷으로 다운로드할 수 있어야 한다. | M |
| FR-DOC-006 | Documents Sub-hub는 Review·Tax&HR·Legal·Operations 4개 카테고리로 구성되어야 한다. | M |

---

### 3.9 지식베이스 및 RAG

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-RAG-001 | 사용자는 PDF·DOCX·TXT 파일을 업로드하여 지식베이스에 인덱싱할 수 있어야 한다. | M |
| FR-RAG-002 | 업로드 문서는 BAAI/bge-m3(1024-dim) 모델로 임베딩되어 pgvector에 저장되어야 한다. | M |
| FR-RAG-003 | 검색은 pgvector 벡터 유사도 + PostgreSQL FTS를 RRF로 결합한 하이브리드 검색을 사용하며, 기본 4 chunks를 반환해야 한다. | M |
| FR-RAG-004 | 문서 공정성 분석은 법령·위험조항·허용조항 3개 인덱스에 대한 독립 검색 후 RRF로 통합해야 한다. | M |
| FR-RAG-005 | 검색 결과는 에이전트 컨텍스트에 `rag_context`로 주입되어야 한다. | M |

---

### 3.10 메모리 시스템

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-MEM-001 | 단기 메모리는 Redis에 저장되며 현재 세션의 대화 히스토리를 관리해야 한다. | M |
| FR-MEM-002 | 장기 메모리는 도메인×일자 단위로 Supabase pgvector에 digest 형태로 저장되어야 한다. | M |
| FR-MEM-003 | 장기 메모리 검색은 RRF + importance 가중치를 사용하며 7일 TTL을 적용해야 한다. | M |
| FR-MEM-004 | 대화 히스토리가 20턴을 초과하면 gpt-4o-mini를 통해 자동 압축 후 저장해야 한다. | S |
| FR-MEM-005 | LangGraph `MemorySaver()`는 `thread_id=account_id`로 체크포인트를 관리해야 한다. | M |

---

### 3.11 관리자 기능

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| FR-ADMIN-001 | 관리자는 전체 사용자 목록을 조회하고 계정 상태를 관리할 수 있어야 한다. | M |
| FR-ADMIN-002 | 관리자는 시스템 전체 Artifact 현황 및 스케줄 실행 로그를 조회할 수 있어야 한다. | S |
| FR-ADMIN-003 | 관리자 접근은 별도 권한 체계로 일반 사용자와 분리되어야 한다. | M |

---

## 4. 비기능 요구사항

> 요구사항 번호 체계: `NFR-[유형]-[번호]`

### 4.1 성능

| ID | 요구사항 | 기준값 |
|----|---------|--------|
| NFR-PERF-001 | AI 채팅 첫 토큰 응답 시간 (TTFT) | 3초 이내 (90th percentile) |
| NFR-PERF-002 | Artifact 캔버스 초기 로딩 | 2초 이내 |
| NFR-PERF-003 | RAG 검색 응답 | 500ms 이내 |
| NFR-PERF-004 | Celery Beat tick 지연 | 60±10초 이내 |
| NFR-PERF-005 | 동시 접속 사용자 | 100명 동시 처리 |

### 4.2 보안

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| NFR-SEC-001 | 모든 API 엔드포인트는 JWT 인증을 통과한 요청만 처리해야 한다. | M |
| NFR-SEC-002 | Supabase service_role 키는 백엔드 환경 변수로만 관리하며, 프론트엔드에 노출되어서는 안 된다. | M |
| NFR-SEC-003 | 모든 DB 쿼리는 `account_id` 필터를 직접 포함하여 타 사업체 데이터 접근을 방지해야 한다. | M |
| NFR-SEC-004 | 파일 업로드는 허용 MIME 타입(PDF·DOCX·TXT·이미지)만 수락하며 크기 제한을 적용해야 한다. | M |
| NFR-SEC-005 | HTTPS를 통한 전송 암호화를 강제해야 한다. | M |
| NFR-SEC-006 | 비밀번호는 단방향 해시(bcrypt)로 저장되어야 한다. | M |

### 4.3 확장성

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| NFR-SCALE-001 | Celery Worker는 수평 확장이 가능해야 한다. | S |
| NFR-SCALE-002 | 새 도메인 Capability 추가 시 `describe()` 등록만으로 Planner가 자동 인식해야 한다. | M |
| NFR-SCALE-003 | 표준 Sub-hub 18종은 `ensure_standard_sub_hubs()` idempotent 부트스트랩으로 관리되어야 한다. | M |

### 4.4 가용성

| ID | 요구사항 | 기준값 |
|----|---------|--------|
| NFR-AVAIL-001 | 서비스 가용성 목표 (월 기준) | 99.5% 이상 |
| NFR-AVAIL-002 | 계획된 유지보수 시간 | 월 4시간 이하 (사전 공지) |
| NFR-AVAIL-003 | AI API 장애 시 fallback 응답 제공 | 에러 메시지 + 재시도 안내 |

### 4.5 유지보수성

| ID | 요구사항 | 우선순위 |
|----|---------|---------|
| NFR-MAINT-001 | 백엔드는 Python async 전역 패턴을 일관되게 적용해야 한다. | M |
| NFR-MAINT-002 | DB 스키마 변경은 `supabase/migrations/`의 번호 순 마이그레이션 파일로 관리되어야 한다. | M |
| NFR-MAINT-003 | 환경 변수는 `.env.example`에 모두 문서화되어야 한다. | S |
| NFR-MAINT-004 | 모든 라우터는 `backend/app/main.py`에 명시된 mount 순서를 준수해야 한다. | S |

---

## 5. 외부 인터페이스 요구사항

### 5.1 사용자 인터페이스

| ID | 요구사항 |
|----|---------|
| FR-UI-001 | 인터페이스는 한국어를 기본 언어로 제공해야 한다. |
| FR-UI-002 | 반응형 레이아웃으로 데스크톱(1280px+) 및 태블릿(768px+)을 지원해야 한다. |
| FR-UI-003 | InlineChat은 스트리밍 응답(SSE)으로 토큰을 점진적으로 렌더링해야 한다. |
| FR-UI-004 | 캔버스는 Supabase Realtime 구독으로 새 Artifact를 즉시 반영해야 한다. |
| FR-UI-005 | 에러 메시지는 사용자 친화적 한국어로 표시해야 한다. |

### 5.2 하드웨어 인터페이스

본 시스템은 특수 하드웨어 인터페이스를 요구하지 않는다. BAAI/bge-m3 임베딩 모델은 CPU 환경에서도 동작해야 하며, GPU 가용 시 가속을 활용할 수 있다.

### 5.3 소프트웨어 인터페이스

| 외부 시스템 | 용도 | 프로토콜 |
|------------|------|---------|
| **OpenAI API** | LLM 추론 (GPT-4o, gpt-4o-mini) | HTTPS REST |
| **Supabase** | PostgreSQL DB, pgvector, Auth, Realtime, Storage | HTTPS + WebSocket |
| **Redis** | 단기 메모리, Celery 브로커/결과 저장 | Redis Protocol (TCP) |
| **BAAI/bge-m3** | 텍스트 임베딩 | 로컬 Python 프로세스 |
| **결제 서비스** | 구독 결제 처리 | HTTPS REST (3rd-party) |

### 5.4 통신 인터페이스

| 인터페이스 | 프로토콜 | 설명 |
|-----------|---------|------|
| 프론트 ↔ 백엔드 API | HTTPS REST | JWT Bearer 토큰 인증 |
| 채팅 스트리밍 | SSE (Server-Sent Events) | 토큰 단위 점진적 응답 |
| 캔버스 실시간 | WebSocket (Supabase Realtime) | Artifact 변경 구독 |
| 백엔드 ↔ Redis | TCP (Redis 6379) | 로컬 네트워크 |
| 백엔드 ↔ Supabase | HTTPS | service_role 키 인증 |

---

## 6. 시스템 제약 및 기타

### 6.1 기술 스택 제약

| 레이어 | 기술 | 버전 |
|--------|------|------|
| Frontend | Next.js (App Router) | 16.x |
| Backend | FastAPI + Python | 3.12+ |
| AI 오케스트레이션 | LangGraph StateGraph | 최신 안정 |
| AI 에이전트 | DeepAgents SDK | 최신 안정 |
| DB | Supabase PostgreSQL + pgvector | 15+ |
| 캐시·큐 | Redis + Celery | 7.x / 5.x |
| 패키지 관리 | conda (환경) + uv pip (설치) | - |

### 6.2 브랜치 및 배포 정책

- 기본 개발 브랜치: `dev` (모든 feature 브랜치는 `dev`로 PR)
- 릴리스 브랜치: `main` (스냅샷 관리)
- 마이그레이션 적용 순서: 파일명 알파벳 오름차순 (번호 중복 파일 포함)

### 6.3 개발 컨벤션

- 백엔드: `async/await` 전역 사용
- 프론트엔드: arrow function 우선
- 모든 쿼리: `account_id` 스코프 필터 필수
- 새 Capability: `describe()` 등록 → `_capability.py` 자동 수집

### 6.4 미해결 이슈 및 향후 과제

| # | 항목 | 우선순위 |
|---|------|---------|
| 1 | deepagents SDK 출력 호환성 리팩토링 재시도 (이전 실패 이력 있음) | 높음 |
| 2 | POS 연동 인터페이스 표준화 | 중간 |
| 3 | 모바일 반응형 레이아웃 개선 | 중간 |
| 4 | 다국어(영어) 지원 | 낮음 |

---

*문서 끝 — BOSS2-SRS-001 v1.0*
