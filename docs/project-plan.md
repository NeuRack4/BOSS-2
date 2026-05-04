# BOSS 프로젝트 계획서

**문서 번호:** BOSS-PP-001  
**버전:** 1.0  
**작성일:** 2026-05-04  
**작성자:** BOSS 개발팀  
**상태:** 진행 중 (현재 v4.2.2)

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [팀 구성](#2-팀-구성)
3. [기술 스택](#3-기술-스택)
4. [추진 단계 및 WBS](#4-추진-단계-및-wbs)
5. [마일스톤 요약](#5-마일스톤-요약)
6. [현재 진행 상황](#6-현재-진행-상황)
7. [향후 계획](#7-향후-계획)
8. [리스크 관리](#8-리스크-관리)

---

## 1. 프로젝트 개요

### 1.1 배경 및 필요성

국내 소상공인은 약 **770만 명**으로 전체 사업체의 대다수를 차지하지만, 5년 생존율은 **20%**에 불과하다. 폐업의 핵심 원인은 외부 경쟁이 아닌 **운영 과부하**다. 소상공인은 채용·마케팅·매출 분석·계약서 검토를 모두 혼자 처리해야 하며, 기존 도구(배달의민족·알바천국·세금계산서 앱)는 각 영역을 개별 커버하지만 **서로 연결되지 않는다**.

BOSS는 이 단절을 해결하기 위해, **채팅 한 마디로 4개 업무 도메인을 통합 자동화**하는 AI 자율 운영 플랫폼이다.

### 1.2 목표

| 구분 | 내용 |
|------|------|
| **제품 목표** | 소상공인이 채팅만으로 채용·마케팅·매출·문서 업무를 처리 |
| **기술 목표** | LangGraph 기반 멀티 에이전트 오케스트레이션 + Celery 자율 실행 |
| **비즈니스 목표** | 초기 사용자 확보 → 구독 결제 → 서비스 확장 |

### 1.3 범위

- **포함:** 웹 플랫폼 (프론트엔드 + 백엔드 + AI 파이프라인 + 스케줄러)
- **제외:** 모바일 네이티브 앱, 하드웨어 POS 기기 직접 제어

---

## 2. 팀 구성

| 역할 | 담당 영역 |
|------|-----------|
| **풀스택 리드** | 전체 아키텍처 설계, LangGraph 오케스트레이터, 백엔드 API |
| **AI 엔지니어** | DeepAgent 구현, RAG 파이프라인, 메모리 시스템 |
| **프론트엔드** | Next.js 16 UI, InlineChat, 캔버스, 대시보드 |
| **백엔드** | FastAPI 도메인 라우터, Celery 스케줄러, Supabase 스키마 |

---

## 3. 기술 스택

| 레이어 | 기술 |
|--------|------|
| **프론트엔드** | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 |
| **백엔드** | FastAPI · Python 3.12 · async 전역 |
| **AI 오케스트레이션** | LangGraph StateGraph · DeepAgents SDK · GPT-4o / GPT-4o-mini |
| **임베딩** | BAAI/bge-m3 (1024-dim) 로컬 서버 |
| **DB** | Supabase PostgreSQL 15 · pgvector · Row Level Security |
| **캐시 · 큐** | Upstash Redis · Celery 5 (Beat + Worker) |
| **외부 연동** | Meta Graph API · Naver Blog · YouTube Data API · PortOne PG · Square POS |
| **미디어** | DALL-E 3 · FFmpeg · Google TTS |
| **모니터링** | LangSmith LLM 추적 |

---

## 4. 추진 단계 및 WBS

### Phase 1 — 기초 인프라 구축 (v0.3) ✅

> 목표: 서비스 운영 가능한 기본 뼈대 확립

| # | 기능 그룹 | 세부 작업 | 핵심 기술 | 상태 |
|---|-----------|-----------|-----------|------|
| 1.1 | DB & 스키마 | PostgreSQL 확장 활성화 (pgvector · pg_trgm · uuid-ossp) | Supabase · PostgreSQL 15 | ✅ 완료 |
| 1.2 | DB & 스키마 | 핵심 테이블 설계 (profiles · artifacts · artifact_edges · embeddings) | Supabase · pgvector | ✅ 완료 |
| 1.3 | DB & 스키마 | Row Level Security — account_id 완전 격리 | Supabase RLS | ✅ 완료 |
| 1.4 | 백엔드 기초 | FastAPI 앱 구조 + Router 체계 + async 전역 | FastAPI · Python 3.12 | ✅ 완료 |
| 1.5 | 프론트엔드 | Next.js 16 App Router 스캐폴드 + Supabase Auth 인증 | Next.js 16 · Supabase Auth | ✅ 완료 |
| 1.6 | 프론트엔드 | 로그인 · 회원가입 페이지 + Auth Proxy 보호 | Next.js 16 · TypeScript | ✅ 완료 |

---

### Phase 2 — AI 에이전트 MVP (v0.4 ~ v0.6) ✅

> 목표: 자연어 → 업무 실행 핵심 파이프라인 구현

| # | 기능 그룹 | 세부 작업 | 핵심 기술 | 상태 |
|---|-----------|-----------|-----------|------|
| 2.1 | LangGraph 오케스트레이터 | StateGraph 구축 — Planner → 도메인 → synthesizer 흐름 | LangGraph · Python | ✅ 완료 |
| 2.2 | LangGraph 오케스트레이터 | Planner DeepAgent — 자연어 → PlanResult JSON 변환 | DeepAgents · GPT-4o | ✅ 완료 |
| 2.3 | LangGraph 오케스트레이터 | route_plan() 조건부 라우팅 + depends_on 병렬 실행 (Send() 팬아웃) | LangGraph Send API | ✅ 완료 |
| 2.4 | LangGraph 오케스트레이터 | Capability 시스템 — describe() + dispatch 맵 자동 수집 | Python · DeepAgents | ✅ 완료 |
| 2.5 | 메모리 & 검색 | BAAI/bge-m3 1024-dim 임베딩 서버 | sentence-transformers · CUDA | ✅ 완료 |
| 2.6 | 메모리 & 검색 | hybrid_search() — pgvector cosine + BM25 FTS → RRF 융합 | pgvector · PostgreSQL FTS | ✅ 완료 |
| 2.7 | 메모리 & 검색 | 단기메모리 (Redis 20턴) + 장기메모리 (pgvector 7일 TTL) | Upstash Redis · pgvector | ✅ 완료 |
| 2.8 | 메모리 & 검색 | 20턴 초과 시 GPT-4o-mini 자동 압축 | GPT-4o-mini · Redis | ✅ 완료 |
| 2.9 | 자동화 기초 | Celery Beat 스케줄러 — 60초 tick + KST timezone | Celery 5 · Upstash Redis | ✅ 완료 |
| 2.10 | 자동화 기초 | artifact.metadata.schedule_enabled 토글 → Celery 자동 등록 | Celery · Supabase | ✅ 완료 |
| 2.11 | 자동화 기초 | D-7·D-3·D-1·D-0 만료 알림 + 실행 결과 log artifact 자동 생성 | Celery · Supabase | ✅ 완료 |
| 2.12 | 검색 & 브리핑 | 전역 검색 API (FTS + pgvector) | FastAPI · Supabase FTS | ✅ 완료 |
| 2.13 | 검색 & 브리핑 | 로그인 브리핑 — 8시간 미접속 시 활동요약 + 도메인 제안 | LangGraph · GPT-4o | ✅ 완료 |
| 2.14 | 검색 & 브리핑 | 프로필 넛지 — 핵심 7필드 3개 미만 시 STRONG 지시 주입 | Python ContextVar | ✅ 완료 |

---

### Phase 3 — 도메인 에이전트 구현 (v0.8 ~ v0.9) ✅

> 목표: 4개 업무 도메인 전문 AI 에이전트 완성

| # | 도메인 | 세부 작업 | 핵심 기술 | 상태 |
|---|--------|-----------|-----------|------|
| 3.1 | 서류 에이전트 | 계약서 공정성 3-way 분석 (위험조항 + 허용조항 + 법령 RAG) | pgvector · FTS · RRF · GPT-4o | ✅ 완료 |
| 3.2 | 서류 에이전트 | 법률·세무·노동 자문 (16종 법령 지식베이스 ~2000청크) | pgvector · GPT-4o | ✅ 완료 |
| 3.3 | 서류 에이전트 | 급여명세서·사업자등록 서류 DOCX 자동 생성 | python-docx · GPT-4o | ✅ 완료 |
| 3.4 | 서류 에이전트 | 문서 업로드 자동 분류 (PDF·DOCX·이미지) | GPT-4o Vision · FastAPI | ✅ 완료 |
| 3.5 | 채용 에이전트 | 채용공고 자동 생성 (잡코리아·사람인·워크넷 3종 포맷) | DeepAgents · GPT-4o · RAG | ✅ 완료 |
| 3.6 | 채용 에이전트 | 이력서 PDF/DOCX 파싱 + 구조화 추출 | GPT-4o Vision · python-docx | ✅ 완료 |
| 3.7 | 채용 에이전트 | 인터뷰 질문 생성 + 인건비 시뮬레이션 (최저임금·4대보험) | GPT-4o · Supabase | ✅ 완료 |
| 3.8 | 매출 에이전트 | 매출·비용 자연어 입력 → 구조화 저장 | DeepAgents · GPT-4o · Supabase | ✅ 완료 |
| 3.9 | 매출 에이전트 | 영수증 OCR 자동 인식 및 비용 분류 | GPT-4o Vision | ✅ 완료 |
| 3.10 | 매출 에이전트 | 메뉴 수익성 분석 + 가격 전략 제안 | GPT-4o · Supabase | ✅ 완료 |

---

### Phase 4 — SNS 연동 & UI 완성 (v1.0 ~ v1.2) ✅

> 목표: 마케팅 자동화 + 사용자 인터페이스 완성

| # | 기능 그룹 | 세부 작업 | 핵심 기술 | 상태 |
|---|-----------|-----------|-----------|------|
| 4.1 | 마케팅 에이전트 | SNS 포스트·블로그·광고카피·리뷰답글·마케팅 캘린더 생성 | DeepAgents · GPT-4o · pgvector RAG | ✅ 완료 |
| 4.2 | 마케팅 에이전트 | 이벤트 포스터 HTML 자동 생성 + DALL-E 3 이미지 | GPT-4o · DALL-E 3 | ✅ 완료 |
| 4.3 | 마케팅 에이전트 | Instagram Meta Graph API 자동 게시 | Meta Graph API · FastAPI | ✅ 완료 |
| 4.4 | 마케팅 에이전트 | 네이버 블로그 Playwright 자동 업로드 | Playwright · Python | ✅ 완료 |
| 4.5 | 마케팅 에이전트 | YouTube Shorts 4단계 위저드 (스크립트→자막→TTS→영상 합성) | GPT-4o · FFmpeg · Google TTS | ✅ 완료 |
| 4.6 | 마케팅 에이전트 | Instagram DM 캠페인 자동 발송 큐 | Meta Graph API | ✅ 완료 |
| 4.7 | 프론트엔드 UI | Bento Grid 메인 대시보드 (12컬럼 드래그 레이아웃) | react-grid-layout · Tailwind v4 | ✅ 완료 |
| 4.8 | 프론트엔드 UI | InlineChat — 29종 인라인 폼 카드 렌더링 시스템 | React 19 · react-markdown | ✅ 완료 |
| 4.9 | 프론트엔드 UI | NodeDetailModal 단일 전역 마운트 | React 19 · Context API | ✅ 완료 |
| 4.10 | 프론트엔드 UI | Kanban 보드 — 도메인별 artifact 상태 추적 | @xyflow/react · @dagrejs/dagre | ✅ 완료 |
| 4.11 | 프론트엔드 UI | 특수 마커 파싱 ([CHOICES]·[ACTION:*]·[ARTIFACT] 등) | TypeScript · React 19 | ✅ 완료 |

---

### Phase 5 — 서비스 확장 (v2.x ~ v3.x) ✅

> 목표: 외부 시스템 연동 + 데이터 분석 고도화

| # | 기능 그룹 | 세부 작업 | 핵심 기술 | 상태 |
|---|-----------|-----------|-----------|------|
| 5.1 | 외부 연동 | Square POS API 매출 자동 동기화 | Square API · FastAPI | ✅ 완료 |
| 5.2 | 외부 연동 | PortOne PG 구독 결제 + Webhook 처리 | PortOne · FastAPI | ✅ 완료 |
| 5.3 | 외부 연동 | Slack OAuth 워크스페이스 알림 연동 | Slack OAuth · FastAPI | ✅ 완료 |
| 5.4 | 외부 연동 | YouTube Google OAuth + 인사이트 수집 | Google OAuth · YouTube Data API | ✅ 완료 |
| 5.5 | 데이터 & 통계 | 매출 통계 API (일별·월별·상품별·시간대별 분석) | FastAPI · Supabase SQL | ✅ 완료 |
| 5.6 | 데이터 & 통계 | 보조금 매칭 — 정부지원사업 검색 + 캐시 시스템 | Supabase · 외부 API | ✅ 완료 |
| 5.7 | 데이터 & 통계 | 직원 관리 + 근무기록 CRUD | FastAPI · Supabase | ✅ 완료 |
| 5.8 | 데이터 & 통계 | 프로필 아바타 업로드 (Supabase Storage + RLS) | Supabase Storage | ✅ 완료 |
| 5.9 | 프론트엔드 | 도메인 전용 페이지 4종 (채용·마케팅·매출·서류) | Next.js 16 · React 19 | ✅ 완료 |
| 5.10 | 프론트엔드 | SearchPalette 전역 검색 팔레트 | React 19 · Supabase FTS | ✅ 완료 |
| 5.11 | 프론트엔드 | 모달 시스템 14종 (결제·연동·메모리·스케줄 등) | React 19 · Tailwind v4 | ✅ 완료 |
| 5.12 | 프론트엔드 | Supabase Realtime — artifact 변경 시 canvas 즉시 갱신 | Supabase Realtime · CustomEvent | ✅ 완료 |

---

### Phase 6 — 운영 & 고도화 (v4.0 ~ v4.2) ✅

> 목표: UX 완성도 향상 + 운영 도구 + 버그 안정화

| # | 기능 그룹 | 세부 작업 | 핵심 기술 | 상태 |
|---|-----------|-----------|-----------|------|
| 6.1 | UX 개선 | 온보딩 투어 오버레이 (TourOverlay · TourContext · 투어 완료 인사) | React 19 · CSS | ✅ 완료 |
| 6.2 | UX 개선 | 프로필 메모리 사이드바 + 활동 타임라인 카드 | React 19 · Supabase Realtime | ✅ 완료 |
| 6.3 | 운영 도구 | 어드민 페이지 — 유저·비용·결제·통계 관리 | Next.js 16 · Supabase | ✅ 완료 |
| 6.4 | 운영 도구 | LangSmith LLM 호출 추적 + 구조화 로깅 | LangSmith · LangChain | ✅ 완료 |
| 6.5 | 안정화 | 매출 입력 흐름 버그 수정 (v4.2.2) | FastAPI · React 19 | ✅ 완료 |
| 6.6 | 안정화 | 영수증 이미지 라우팅 버그 수정 (v4.2.1) | FastAPI · Next.js 16 | ✅ 완료 |
| 6.7 | 안정화 | 로고·파비콘 교체 + README 팀 소개 섹션 | Next.js 16 | ✅ 완료 |

---

## 5. 마일스톤 요약

```
v0.3  ●──────────────────────────────────────────────────────────────● v4.2.2
      기초 인프라   AI MVP   도메인 에이전트   SNS+UI   서비스확장   운영고도화
      Phase 1      Phase 2   Phase 3          Phase 4   Phase 5      Phase 6
       ✅           ✅         ✅               ✅         ✅           ✅
```

| 버전 | 마일스톤 | 핵심 달성 내용 |
|------|---------|--------------|
| v0.3 | 기초 인프라 완성 | DB 스키마 + Auth + FastAPI + Next.js 기반 완성 |
| v0.6 | AI 에이전트 MVP | Planner DeepAgent + LangGraph + RAG + Celery 스케줄러 |
| v0.9 | 4도메인 완성 | 채용·서류·매출 에이전트 + GPT-4o Vision 연동 |
| v1.2 | UI + 마케팅 완성 | SNS 자동 게시 + YouTube Shorts + 전체 UI 시스템 |
| v3.x | 서비스 확장 완료 | POS·PG·Slack·YouTube 연동 + 통계·보조금 API |
| **v4.2.2** | **현재 운영 버전** | 온보딩 투어 + 어드민 + LangSmith + 버그 안정화 |

---

## 6. 현재 진행 상황

### 6.1 전체 진행률

| Phase | 완료 항목 | 전체 항목 | 완료율 |
|-------|-----------|-----------|--------|
| Phase 1 — 기초 인프라 | 6 | 6 | **100%** |
| Phase 2 — AI 에이전트 MVP | 14 | 14 | **100%** |
| Phase 3 — 도메인 에이전트 | 10 | 10 | **100%** |
| Phase 4 — SNS + UI | 11 | 11 | **100%** |
| Phase 5 — 서비스 확장 | 12 | 12 | **100%** |
| Phase 6 — 운영 고도화 | 7 | 7 | **100%** |
| **전체** | **60** | **60** | **100%** |

### 6.2 현재 버전 (v4.2.2)

- 전체 WBS 60개 작업 완료
- 주요 버그(매출 입력 흐름, 영수증 이미지 라우팅) 수정 완료
- 온보딩 투어 및 어드민 대시보드 운영 중
- LangSmith 기반 LLM 호출 모니터링 가동 중

---

## 7. 향후 계획

### Phase 7 — AI 파이프라인 고도화 (v5.x 예정)

> 목표: 에이전트 품질 및 성능 최적화

| 우선순위 | 과제 | 설명 |
|----------|------|------|
| 🔴 높음 | DeepAgents SDK 리팩토링 | 출력 호환성 재설계 + Planner 라우팅 품질 개선 (이전 시도 실패 이력 있음 — 신중한 접근 필요) |
| 🔴 높음 | 스트리밍 응답 최적화 | TTFT(첫 토큰 응답) 목표 3초 이내 달성 |
| 🟡 중간 | 에이전트 평가 자동화 | Capability별 응답 품질 자동 측정 파이프라인 |
| 🟡 중간 | RAG 정확도 개선 | 청크 전략 고도화 + Reranker 도입 |

### Phase 8 — UX & 접근성 확장 (v5.x ~ v6.x 예정)

| 우선순위 | 과제 | 설명 |
|----------|------|------|
| 🟡 중간 | 모바일 반응형 개선 | 태블릿(768px) 레이아웃 최적화 |
| 🟡 중간 | 다국어 지원 | 영문 인터페이스 (해외 진출 대비) |
| 🟢 낮음 | PWA 전환 | 오프라인 지원 + 홈 화면 설치 |

### Phase 9 — 비즈니스 확장 (v6.x~ 예정)

| 우선순위 | 과제 | 설명 |
|----------|------|------|
| 🔴 높음 | 사용자 획득 채널 구축 | 소상공인 커뮤니티 연동, 제휴 마케팅 |
| 🟡 중간 | 엔터프라이즈 플랜 | 다점포 관리, 팀 계정, 권한 체계 |
| 🟡 중간 | 데이터 분석 대시보드 | 업종별 벤치마크 비교 |
| 🟢 낮음 | 외부 POS 기기 직접 연동 확대 | Square 외 국내 POS 추가 |

---

## 8. 리스크 관리

| # | 리스크 | 영향도 | 발생 가능성 | 대응 방안 |
|---|--------|--------|------------|-----------|
| R-001 | DeepAgents SDK 호환성 변경 | 높음 | 중간 | SDK 버전 고정 + 추상화 레이어 유지 |
| R-002 | OpenAI API 비용 급증 | 높음 | 중간 | gpt-4o-mini 폴백 + 토큰 사용량 모니터링 |
| R-003 | Supabase 서비스 장애 | 높음 | 낮음 | 읽기 전용 캐시 레이어 + 장애 알림 |
| R-004 | Meta/Naver API 정책 변경 | 중간 | 중간 | SNS별 어댑터 패턴으로 교체 비용 최소화 |
| R-005 | BAAI/bge-m3 메모리 부족 | 중간 | 낮음 | GPU 메모리 모니터링 + CPU 폴백 |
| R-006 | 개인정보 처리 법적 이슈 | 높음 | 낮음 | account_id RLS 격리 유지 + 법률 검토 정기화 |

---

*문서 끝 — BOSS-PP-001 v1.0*
