# BOSS-2

![version](https://img.shields.io/badge/version-0.9.0-blue)

> AI 기반 소상공인 자율 운영 플랫폼. 오케스트레이터 챗봇 하나로 채용·마케팅·매출·서류를 자동 관리합니다.

## Overview

중앙 오케스트레이터 AI와 대화하면 채용 / 마케팅 / 매출 관리 노드가 자동으로 생성·실행됩니다.
생성된 모든 작업물에는 Celery 스케쥴러가 연결되어 켜두면 알아서 돌아갑니다.

```
[사용자 채팅]
      ↓
[Orchestrator Agent]  ← OpenAI API
      ↓ 라우팅
  ┌────┬────┬────┐
채용 마케팅 매출 서류
  │    │    │    │
생성물 + Celery Beat 스케쥴러
```

## Architecture

| 영역      | 기술                                           |
| --------- | ---------------------------------------------- |
| Frontend  | Next.js 16 (App Router), React Flow, Shadcn/ui |
| Backend   | FastAPI (Python 3.12)                          |
| Database  | Supabase (PostgreSQL + pgvector + Realtime)    |
| Scheduler | Celery + Redis / Upstash (Celery Beat)         |
| AI        | OpenAI API (GPT-4o), BAAI/bge-m3 (임베딩)      |
| RAG       | pgvector(1024dim) + BM25 하이브리드 서치 + RRF |
| Auth      | Supabase Auth (이메일 + 비밀번호)              |

## Key Features

- **Recruitment 에이전트 v0.9.0** — 당근알바/알바천국/사람인 **3종 공고 동시 작성** (`[JOB_POSTINGS]` 마커 → 부모 `job_posting_set` + 자식 × 3 + `contains` 엣지) · **HTML 포스터 생성** (GPT-4o standalone HTML, `recruitment-posters` 버킷 + `artifacts.content` 이중 저장, 프론트 `<iframe srcDoc>` 샌드박스 렌더) · 업종별 CHOICES 분기(cafe/restaurant/retail/beauty/academy/default) · 2026 최저임금·주휴수당·4대보험 시뮬레이션 (`_recruit_calc.py`) · `hiring_drive` 기간 artifact 로 스케쥴러 D-7/3/1/0 리마인드 자동
- **Function-calling Capability 라우팅 v0.9.0** — OpenAI tools API 로 도메인 에이전트의 기능을 capability 단위(recruitment 4~5 + documents 6~7 + marketing 5)로 노출. orchestrator 가 `describe_all()` 로 스펙 조립 후 `tool_choice="auto"` + `parallel_tool_calls=True` 로 라우팅 · 필수 파라미터 부족 시 LLM 이 자연어로 되묻기 · 실패 시 legacy `_call_domain_with_shortcut` 자동 폴백 · sales 는 팀원 기능 완료 후 별도 PR 에서 합류
- **Legal 서브브랜치 v0.9.0 (`_legal.py`)** — 소상공인 다분야 법령(노동·임대차·공정거래·개인정보·세법·상법·가맹·전자상거래·식품위생 등) 16종 수집. `classify_legal_intent` → `search_legal_knowledge` RPC RAG → GPT-4o 답변 + 면책 고지 자동 첨부 → Documents > Legal 서브허브에 `legal_advice` artifact 저장. `legal_annual_values` 테이블에서 연도별 법정 수치 자동 주입
- **Documents 에이전트 v0.7.0** — 계약서·견적서·제안서·공지문·체크리스트·가이드 6종 type + 계약서 subtype 7종(`labor/lease/service/supply/partnership/franchise/nda`). 스켈레톤 + 한국 법령·관행 조항 markdown(`_doc_knowledge/<subtype>/{acceptable,risks}.md`) 을 system 프롬프트에 자동 주입. `due_label` 메타(계약 만료/납품기한/견적 유효기간 등) 로 스케쥴러 **D-7/D-3/D-1/D-0** 알림 트리거
- **공정성 분석 v0.8.0** — PDF/DOCX/이미지 업로드(`📎` 채팅 첨부 버튼) → 이미지는 `gpt-4o vision` OCR → 1,349 청크 지식 베이스(법령 1,171 + 위험패턴 100 + 허용조항 78) **3-way RRF RAG** → 갑/을 유불리 비율 + 위험 조항 JSON. `uploaded_doc` / `analysis` artifact 2개 + `analyzed_from` 엣지 생성, 프론트는 `ReviewResultCard` 로 이중 바 + 위험 조항 수정안 렌더
- **표준 서브허브 17개 (전 계정 공통)** — `bootstrap_workspace` 트리거가 가입 즉시 Recruitment(Job_posting/Interviews/Onboarding/Evaluations) + Documents(Contracts/Tax&HR/Legal/Operations) + Sales(Reports/Customers/Pricing/Costs) + Marketing(Social/Blog/Campaigns/Events/Reviews) 서브허브를 생성. 모든 artifact 는 `artifact_edges.relation='contains'` 로 이 중 하나의 서브허브에 귀속됨
- **자유 캔버스**: React Flow 기반 드래그 가능한 노드 뷰 (Sand/Paper 테마)
- **오케스트레이터 채팅**: 대화만으로 모든 기능 제어 — **복수 도메인 동시 처리**(`recruitment+marketing` 같은 요청을 각 에이전트로 fan-out 후 하나의 응답으로 합성) + **plan 모드**(기간을 주면 4개 도메인 활동/일정을 일자별 할 일로 정리) + **distinct refuse**(도메인 무관 요청은 명시적으로 거절) + **마크다운 렌더**(assistant 응답의 `**bold**`/`---`/헤더/리스트/테이블 을 Sand/Paper 테마로 표시)
- **로그인 브리핑**: 직전 접속 이후 자동 실행·알림·실패·에이전트별 오늘 추천을 헤드라인 3줄 + 상세 섹션으로 요약해 채팅창에 자동 오픈. 프로필이 비어있으면 하나씩 부드럽게 수집(`profile_nudge`).
- **닉네임 + 사업 프로필 자동 학습**: 대화 중 사용자가 스스로 밝힌 호칭·업종·가게명·단계·위치·주 채널·핵심 목표 등을 `[SET_NICKNAME]` / `[SET_PROFILE]` 인라인 블록으로 추출 → `profiles` 테이블 저장 → 이후 모든 에이전트 응답에 system 컨텍스트로 주입
- **CHOICES shortcut**: 도메인 에이전트가 `[CHOICES]` 객관식 질문을 던질 때, 히스토리/장기기억에 답이 있으면 LLM 추론으로 자동 선택 후 에이전트를 재호출 → 한 턴에 최종 응답까지
- **진짜 작동하는 Celery 스케쥴러**: `app/scheduler/` 모듈로 `tick` 태스크(Beat 60s 주기)가 due schedule fan-out + `start_date`/`due_date` D-0/D-1 알림을 `activity_logs.schedule_notify` 로 기록. 실행 결과는 `kind='log'` artifact 노드로 캔버스에 자동 추가됨.
- **일정 관리 모달**: `schedule` + 기간성 artifact(start/end/due)를 달력·리스트로 통합 관리
- **전역 검색 팔레트** (`⌘K` / `Ctrl+K`): 제목·본문·메모·metadata 하이브리드(벡터+FTS) 검색, 결과 클릭 시 캔버스가 해당 노드로 포커스 이동 (아카이브 자식도 자동으로 `showArchive` 켜고 retry)
- **노드 상세 모달**: 노드 클릭 시 부모/자식 관계, 서브도메인, metadata, ID 와 함께 **타임라인 메모**(생성/편집/삭제) — 작성된 메모는 자동 임베딩되어 검색·대화 컨텍스트에 합류
- **Hover Inspector**: 노드 호버 시 관계·metadata 패널 표시, 최소화 상태 localStorage 유지
- **활동이력 / 일정 → 캔버스 점프**: `ActivityModal`·`ScheduleManagerModal` 항목 클릭 시 `boss:focus-node` 이벤트로 해당 노드로 이동
- **RAG + 하이브리드 서치**: pgvector 벡터 검색 + BM25 키워드 검색 (RRF 병합, artifact/memo/schedule/log/hub 전 범위 인덱싱)
- **계정별 장기 기억**: Supabase Auth 계정마다 독립 메모리 + context 압축
- **실시간 업데이트**: Supabase Realtime으로 캔버스 즉시 반영

## Project Structure

```
BOSS-2/
├── frontend/                    # Next.js App
│   ├── app/
│   │   ├── (auth)/login/        # 이메일+비밀번호 로그인
│   │   ├── dashboard/           # 메인 캔버스
│   │   └── api/chat/            # 스트리밍 프록시
│   ├── components/
│   │   ├── canvas/              # React Flow 노드들
│   │   ├── chat/                # 채팅 인터페이스
│   │   └── sidebar/             # 생성물 상세 패널
│   └── lib/
│       ├── supabase.ts
│       └── api.ts
│
├── backend/                     # FastAPI
│   ├── app/
│   │   ├── agents/              # Orchestrator + 도메인 Agents (+ _doc_templates / _doc_review / _doc_knowledge)
│   │   ├── core/                # embedder / llm / doc_parser / ocr / supabase / config
│   │   ├── memory/              # 장기 기억 + context 압축
│   │   ├── rag/                 # 임베딩 + 하이브리드 서치
│   │   ├── scheduler/           # Celery app / tick 태스크 / scanner / log_nodes
│   │   ├── routers/             # API (auth / chat / activity / artifacts / schedules / evaluations / summary / memos / search / uploads / reviews)
│   │   └── models/              # Pydantic 스키마
│   ├── scripts/
│   │   ├── backfill_embeddings.py
│   │   ├── ingest_contract_risks.py         # 계약 위험 패턴 md → pattern_contract_knowledge_chunks
│   │   ├── ingest_contract_acceptable.py    # 허용 조항 md → acceptable_contract_knowledge_chunks
│   │   └── ingest_contract_laws.py          # 법제처 Open API → law_contract_knowledge_chunks
│   ├── celeryconfig.py
│   └── requirements.txt
│
├── supabase/
│   ├── migrations/              # DB 스키마 (001~014, 순서대로 실행)
│   └── seed/                    # mock 데이터 + cleanup
│
├── .gitignore
├── .gitattributes
├── CHANGELOG.md
└── CLAUDE.md
```

## Getting Started

### 1. 환경 변수 설정

```bash
cp .env.example .env
# .env 파일에 값 입력
```

### 2. Supabase 설정

```bash
# supabase/migrations/ 파일을 Supabase MCP 또는 SQL Editor에서 순서대로 실행
#   001_extensions.sql                        (pgcrypto, uuid-ossp, vector, pg_trgm)
#   002_schema.sql                            (11개 테이블)
#   003_indexes.sql                           (ivfflat, GIN, btree)
#   004_rls.sql                               (Row Level Security)
#   005_functions_triggers.sql                (bootstrap, hybrid_search, memory_search)
#   006_expand_embeddings_source_type.sql     (schedule/log/hub source_type + upsert_embedding RPC)
#   007_memos.sql                             (memos 테이블 + RLS + 'memo' source_type)
#   008_expand_activity_log_types.sql         (schedule_run / schedule_notify 타입 추가)
#   009_profile_last_seen.sql                 (profiles.last_seen_at — 로그인 브리핑 트리거)
#   010_profile_expansion.sql                 (profiles 에 사업 컨텍스트 7개 core 필드 + profile_meta)
#   011_contract_knowledge.sql                (law/pattern/acceptable 3 테이블 + HNSW/trgm/FTS 인덱스 + RLS)
#   012_contract_knowledge_search.sql         (3-way RRF RPC: search_{law,pattern,acceptable}_contract_knowledge)
#   013_artifact_edges_analyzed_from.sql      (artifact_edges.relation CHECK 에 'analyzed_from' 추가)
#   014_standard_sub_hubs.sql                 (ensure_standard_sub_hubs 헬퍼 + bootstrap 확장 + backfill)
#
# (선택) mock 데이터 시드 / 제거
#   supabase/seed/seed_mock_data.sql
#   supabase/seed/cleanup_mock_data.sql
#
# (선택) 검색용 임베딩 백필 — 기존 artifact/schedule/log/hub 에 한 번 실행
#   cd backend && python scripts/backfill_embeddings.py
#
# (선택) 공정성 분석 지식 베이스 인제스트 — 011/012 마이그레이션 적용 후 1회 실행
#   cd backend && python scripts/ingest_contract_risks.py         # 위험 패턴 100청크
#   cd backend && python scripts/ingest_contract_acceptable.py    # 관행 허용 78청크
#   cd backend && python scripts/ingest_contract_laws.py          # 법령 조문 ~1,171청크
```

### 3. Backend 실행

```bash
cd backend
conda create -n boss2 python=3.12
conda activate boss2
uv pip install -r requirements.txt

# FastAPI
uvicorn app.main:app --reload --port 8000

# Celery Worker (별도 터미널)
celery -A app.scheduler.celery_app worker --loglevel=info

# Celery Beat (별도 터미널)
celery -A app.scheduler.celery_app beat --loglevel=info
```

### 4. Frontend 실행

```bash
cd frontend
npm install
npm run dev
```

## Available Slash Commands (Claude Code)

| 커맨드             | 설명                              |
| ------------------ | --------------------------------- |
| `/forge-agent`     | Agent 로직 개발/디버그            |
| `/forge-scheduler` | Celery 태스크 관리                |
| `/forge-rag`       | RAG 파이프라인 설정/디버그        |
| `/forge-schema`    | Supabase 스키마/마이그레이션 생성 |
| `/forge-memory`    | 계정별 장기 기억 관리             |
| `/forge-context`   | Context 압축 로직                 |

## Version

현재 버전: **0.8.0** — 자세한 변경 내역은 [CHANGELOG.md](./CHANGELOG.md) 참고.

## Branch Policy

- **default branch: `dev`** — 모든 feature 브랜치는 `dev` 로 PR.
- `main` 은 릴리스 스냅샷 용도.
