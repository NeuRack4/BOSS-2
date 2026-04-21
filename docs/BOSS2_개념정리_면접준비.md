# BOSS-2 개념 정리 & 면접 준비 노트

> 나만 보는 개인 학습 노트. 상세 설명 + 면접용 간결 답변 병행.

---

## 1. `artifacts` 테이블이 무엇이고, 왜 매출 데이터에 안 쓰는지

### 상세 설명

`artifacts`는 BOSS-2 캔버스에 올라가는 **모든 노드(카드)의 통합 테이블**이다.

- 채용 공고, 계약서 초안, 스케줄, 분석 결과물 등 "AI가 생성한 문서/결과"를 저장
- 구조: `kind(anchor|domain|artifact|schedule|log)` + `type(job_posting|contract|revenue_entry 등)` + `content(텍스트)` + `metadata(jsonb)`
- 캔버스 DAG의 노드 역할 → `artifact_edges`로 부모-자식 관계 연결

**왜 매출 원장 데이터엔 안 쓰나?**

`artifacts`는 "AI가 만든 요약 카드/문서"용이지, "거래 건별 숫자 원장"용이 아니다.

| 구분 | artifacts | sales_records |
|------|-----------|---------------|
| 목적 | AI 생성 결과물 노드 | 개별 거래 원장 |
| 행 수 | 수십~수백 개 | 수천 개 이상 가능 |
| 집계 | 불가 (jsonb 안에 묻힘) | SQL GROUP BY, SUM 가능 |
| 구조 | 유연한 jsonb | 정형 컬럼 (date, amount, category...) |

→ `sales_records` 테이블에 거래를 저장하고, 그것의 "요약 카드"를 `revenue_entry` type의 artifact로 만들어서 캔버스에 표시하는 구조.

**쉽게 말하면**: 영수증 묶음(원장) = `sales_records`, 그걸 대표하는 영수증 아이콘 카드 = `artifacts(type='revenue_entry')`.

### 면접용 간결 답변

> artifacts는 캔버스에 표시되는 AI 생성 결과물 노드 테이블입니다. 매출 거래 원장은 건별로 수천 건이 쌓이고 SUM/GROUP BY 집계가 필요해서, 정형 컬럼을 가진 별도 `sales_records` 테이블로 분리했습니다. artifacts에는 그 집계 결과를 요약한 `revenue_entry` 카드 노드만 생성합니다.

---

## 2. RLS(Row Level Security)가 무엇이고, 왜 모든 새 테이블에 적용해야 하는지

### 상세 설명

**RLS = 데이터베이스 레벨에서 "행 단위"로 접근을 제어하는 보안 정책**

Supabase(PostgreSQL)에서 테이블에 `ENABLE ROW LEVEL SECURITY`를 선언하면, 쿼리가 날아올 때 DB 자체가 필터링한다.

```sql
-- 예시: artifacts 테이블 RLS 정책
CREATE POLICY "users can only see own artifacts"
  ON artifacts FOR ALL
  USING (account_id = auth.uid());
```

이 정책이 있으면 `SELECT * FROM artifacts`를 해도 **현재 로그인한 유저의 행만** 반환된다.

**왜 반드시 적용해야 하나?**

Supabase는 프론트엔드에서 DB에 직접 쿼리를 날릴 수 있다 (anon key 사용). RLS가 없으면:
- 악의적 유저가 `SELECT * FROM sales_records` → 모든 사람의 매출 데이터 유출
- API 서버 코드 버그로 account_id 필터를 빠뜨려도 → 타인 데이터 노출

RLS는 "API 코드가 실수해도 DB가 마지막으로 막아주는 안전망"이다.

**BOSS-2 규칙**: 새 테이블 마이그레이션 작성 시 반드시 마지막에 RLS 추가.

```sql
ALTER TABLE sales_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own sales records"
  ON sales_records FOR ALL
  USING (account_id = auth.uid());
```

### 면접용 간결 답변

> RLS는 PostgreSQL의 행 단위 접근 제어 기능입니다. Supabase는 프론트엔드가 DB에 직접 쿼리할 수 있어서, RLS가 없으면 API 버그 시 타인 데이터가 노출됩니다. `auth.uid()`를 기준으로 "자기 데이터만 보인다"는 정책을 DB 레벨에서 강제하기 때문에, 모든 신규 테이블에 의무 적용합니다.

---

## 3. 오케스트레이터 → 에이전트 라우팅 흐름

### 상세 설명

**흐름 전체 그림**:

```
사용자 메시지
    ↓
orchestrator.run(message, account_id, history)
    ↓
classify_intent(message, history)
    → ["recruitment"], ["sales"], ["chitchat"], ["refuse"], ["planning"] 등 라벨 리스트 반환
    ↓
라벨에 따라 분기:
    ├─ ["refuse"]   → 거절 메시지 (BOSS 범위 안내)
    ├─ ["planning"] → _handle_planning() (기간 플랜 생성)
    ├─ ["chitchat"] → 직접 GPT 응답 (도메인 에이전트 호출 안 함)
    ├─ 도메인 1개 (V2: recruitment/documents/marketing)
    │       → _dispatch_via_tools() (OpenAI function-calling)
    │         tool_calls 있으면 → capability handler 실행
    │         없으면 → GPT 자연어 되묻기
    ├─ 도메인 1개 (sales / 실패 시 폴백)
    │       → _call_domain_with_shortcut() → sales.run()
    └─ 도메인 2개 이상
            → 전부 V2: _dispatch_via_tools(parallel_tool_calls=True)
            → 그 외: 각각 shortcut → _synthesize_cross_domain()
```

**핵심 포인트**:
- 오케스트레이터는 **라우터**일 뿐, 비즈니스 로직 없음
- 에이전트 간 직접 호출 금지 — 반드시 오케스트레이터 경유
- sales는 아직 V2(capability) 미적용 → legacy shortcut 경로

### 면접용 간결 답변

> 사용자 메시지가 오면 오케스트레이터가 GPT로 의도를 분류해 라벨 리스트를 만들고, 라벨에 따라 해당 도메인 에이전트로 라우팅합니다. recruitment/documents/marketing은 OpenAI function-calling 기반 V2 경로, sales는 레거시 직접 호출 경로를 사용합니다. 오케스트레이터 자체는 라우팅만 하고 비즈니스 로직은 없습니다.

---

## 4. `[ARTIFACT]`, `[CHOICES]` 마커 시스템이 어떻게 동작하는지

### 상세 설명

에이전트(GPT)가 텍스트 응답 안에 특수 마커를 삽입하면, 백엔드/프론트가 이를 파싱해서 후처리한다.

**`[ARTIFACT]` 마커**:
```
[ARTIFACT]
{"type": "job_posting", "title": "카페 알바 공고", "content": "...", "domains": ["recruitment"]}
[/ARTIFACT]
```
- 백엔드(`_artifact.py`)가 이 블록을 파싱 → Supabase `artifacts` 테이블에 INSERT
- 프론트 채팅창에는 마커가 보이지 않고 저장 완료 메시지만 표시
- 캔버스 Realtime 구독 → 새 노드 자동 추가

**`[CHOICES]` 마커**:
```
어떤 계약서를 작성할까요?
[CHOICES]
근로계약서|임대차계약서|서비스 계약서
[/CHOICES]
```
- 프론트가 이 마커를 파싱 → 버튼 UI로 렌더링
- 사용자가 버튼 클릭 → 해당 텍스트를 메시지로 전송
- 오케스트레이터는 이 단답 후속 메시지를 도메인 에이전트로 다시 sticky routing

**`[SET_NICKNAME]`, `[SET_PROFILE]` 마커**:
- 응답 파이프라인이 항상 이 블록을 뽑아서 `profiles` 테이블에 저장
- 사용자에게 보내는 최종 응답에서는 제거됨 (마커 노출 방지)

**흐름 요약**:
```
GPT 응답 (마커 포함 raw text)
    ↓
_extract_and_save_artifact()  → DB 저장
_extract_and_save_nickname()  → profiles 업데이트
_extract_and_save_profile()   → profiles 업데이트
    ↓
마커 제거된 clean text → 프론트 전송
    ↓
프론트: [CHOICES] 파싱 → 버튼 렌더링
```

### 면접용 간결 답변

> 에이전트가 GPT 응답 텍스트 안에 `[ARTIFACT]`, `[CHOICES]` 같은 특수 마커를 삽입합니다. 백엔드 파이프라인이 응답을 받아 마커를 파싱해 DB 저장 등 후처리를 하고, 마커를 제거한 clean text를 프론트로 보냅니다. 프론트는 `[CHOICES]`를 버튼 UI로 렌더링합니다. 이 구조 덕분에 GPT가 structured action을 일반 대화 흐름 안에서 트리거할 수 있습니다.

---

## 5. `upsert_embedding` RPC 사용법

### 상세 설명

**왜 필요한가?**

BOSS-2는 RAG(검색 증강 생성)를 위해 모든 저장 데이터를 벡터 임베딩으로도 저장한다. 나중에 "비슷한 내용 찾아줘" 같은 요청이 오면 벡터 유사도로 검색한다.

**`upsert_embedding` RPC 정의**:
```sql
-- Supabase DB 함수 (005_functions_triggers.sql)
public.upsert_embedding(
  account_id  UUID,
  source_type TEXT,   -- 'sales' | 'recruitment' | 'documents' | 'memory' | 'memo' 등
  source_id   TEXT,   -- artifact.id 또는 record.id (유니크 키로 upsert 판단)
  content     TEXT,   -- 임베딩할 텍스트
  embedding   vector(1024)  -- BAAI/bge-m3로 생성한 벡터
)
```

**백엔드에서 사용하는 방법**:
```python
from app.core.embedder import embedder
from app.core.supabase import get_supabase

# 1. 텍스트 → 벡터 변환
vector = embedder.encode(content)  # BAAI/bge-m3, 1024차원

# 2. Supabase RPC 호출
sb = get_supabase()
sb.rpc("upsert_embedding", {
    "account_id": account_id,
    "source_type": "sales",
    "source_id": str(artifact_id),
    "content": content,
    "embedding": vector.tolist()
}).execute()
```

**중요 규칙**:
- 임베딩 생성은 반드시 `backend/app/core/embedder.py`만 사용 (직접 model.encode 금지)
- `source_id` 기준으로 upsert → 같은 artifact 수정 시 덮어쓰기 (중복 없음)
- 새 artifact/memo 저장 시 항상 임베딩도 같이 저장해야 RAG에서 검색됨

### 면접용 간결 답변

> `upsert_embedding`은 텍스트를 BAAI/bge-m3 모델로 1024차원 벡터로 변환해서 `embeddings` 테이블에 저장하는 Supabase DB 함수입니다. `source_id`로 upsert되므로 같은 항목을 여러 번 저장해도 중복이 없습니다. 모든 artifact/매출 기록 저장 시 반드시 같이 호출해야 이후 RAG 검색에 포함됩니다.

---

## 6. `hybrid_search` 함수가 어떻게 RAG recall을 하는지

### 상세 설명

**RAG(Retrieval-Augmented Generation)란?**

GPT에게 질문할 때, DB에서 관련 내용을 먼저 꺼내서 GPT 프롬프트에 "참고자료"로 같이 넣어주는 기법. 이렇게 하면 GPT가 "이 사람의 과거 데이터"를 아는 척 대답할 수 있다.

**hybrid_search 구조**:

```
사용자 쿼리 텍스트
    ↓
1. 벡터 검색 (pgvector)
   - 쿼리 텍스트 → 임베딩(벡터) 변환
   - embeddings 테이블에서 코사인 유사도 상위 N개 추출
    
2. 키워드 검색 (FTS - Full Text Search)
   - PostgreSQL tsvector로 BM25 근사 점수 계산
   - 형태소 분석으로 "매출" → "매출", "매" 등 토큰 매칭

3. RRF (Reciprocal Rank Fusion)으로 두 결과 병합
   - 벡터 순위 + 키워드 순위를 합산하는 공식
   - 둘 다 상위에 오른 항목이 최종 높은 점수
    ↓
최종 관련 텍스트 목록 → GPT system 프롬프트에 주입
```

**왜 hybrid?**
- 벡터 검색만 하면: "계약서 검토" 쿼리에 "계약" 단어 자체는 잘 잡지만 완전히 다른 의미의 유사 벡터가 섞일 수 있음
- 키워드만 하면: 동의어/의미적 유사어 못 잡음 ("급여" vs "월급")
- 둘을 합치면 상호 보완

**코드에서 사용하는 방법**:
```python
# backend/app/core/memory.py 또는 각 에이전트
from app.core.embedder import embedder

query_vector = embedder.encode(query_text)
result = sb.rpc("hybrid_search", {
    "account_id": account_id,
    "query_text": query_text,
    "query_embedding": query_vector.tolist(),
    "match_count": 5
}).execute()
# result.data → 관련 텍스트 리스트 → system 프롬프트에 붙임
```

### 면접용 간결 답변

> `hybrid_search`는 벡터 유사도 검색(pgvector)과 PostgreSQL 전문검색(FTS)을 RRF 알고리즘으로 병합하는 DB 함수입니다. 사용자 쿼리를 벡터로 변환해 의미적으로 유사한 과거 데이터를 찾고, 동시에 키워드 매칭도 병행해서 두 결과를 합산합니다. 이 결과를 GPT 프롬프트에 참고자료로 주입해서 AI가 해당 유저의 과거 맥락을 반영한 답변을 하게 합니다.

---

## 7. 코드 작성 규칙 요약

### 상세 설명

**왜 embedder.py만 써야 하나?**
- 임베딩 모델(BAAI/bge-m3)은 무겁다. 직접 로드하면 메모리 낭비 + 싱글턴 관리 불가
- `embedder.py`가 싱글턴으로 모델을 한 번만 로드하고 재사용

**왜 llm.py만 써야 하나?**
- 모델 변경, 토큰 카운팅, 에러 재시도 로직을 한 곳에서 관리
- 여러 에이전트가 각자 `OpenAI()` 인스턴스 만들면 설정 불일치 발생 가능

**마이그레이션 파일명 규칙**:
- `021_sales_records.sql` 형태 (3자리 순번 + 밑줄 + 설명)
- 현재 최신: 021번. 다음은 022번 (`022_cost_records.sql`)

**API 응답 구조**:
```python
# 항상 이 구조
return {"data": {...}, "error": None, "meta": {}}
# 에러 시
raise HTTPException(status_code=400, detail="에러 메시지")
```

### 면접용 간결 답변

> 임베딩과 OpenAI 호출을 각각 embedder.py, llm.py 한 곳으로만 하는 이유는 싱글턴 관리와 설정 일관성 때문입니다. 에이전트 간 직접 호출 금지는 오케스트레이터 라우팅 로직을 우회하면 의도 분류, 닉네임 추출, 마커 파이프라인이 전부 건너뛰어지기 때문입니다.

---

## 8. 발표/데모 준비 핵심 설명

### 멀티턴 대화 흐름
```
사용자 대화 1회 → Redis(memory_short)에 messages 배열로 저장
                  → 20턴 초과 시 GPT-4o-mini로 요약 압축
사용자 대화 시작 → Redis에서 최근 N개 messages 꺼냄
               → GPT API에 messages 배열째로 전달
               → 이전 대화 맥락 유지
```
**면접 답변**: Redis를 단기 메모리로 사용해 대화 히스토리를 배열로 저장하고, 20턴 초과 시 GPT로 자동 압축합니다. 매 요청마다 이 히스토리를 GPT에 전달해 멀티턴 맥락을 유지합니다.

---

### RAG 설명
**면접 답변**: 사용자의 과거 데이터(artifact, 메모 등)를 저장할 때 동시에 벡터 임베딩도 저장합니다. 질문이 오면 hybrid_search로 관련 과거 데이터를 검색해 GPT 프롬프트에 참고자료로 주입합니다. 이 덕분에 AI가 해당 유저의 비즈니스 맥락을 반영해 답변합니다.

---

### 왜 별도 `sales_records` 테이블인가
**면접 답변**: artifacts는 AI 생성 문서 카드 역할이고 집계 쿼리에 최적화되어 있지 않습니다. 매출 원장은 건별 거래 데이터라 SQL 집계(SUM, GROUP BY)가 필요하므로 정형 컬럼의 별도 테이블로 분리했습니다.

---

### 오케스트레이터 패턴
**면접 답변**: 단일 진입점(orchestrator)이 의도 분류 후 도메인 에이전트로 라우팅하는 패턴입니다. 에이전트는 비즈니스 로직만 담당하고 오케스트레이터가 라우팅, 닉네임 추출, 마커 파이프라인을 통합 관리합니다.

---

### RLS 보안
**면접 답변**: Supabase는 프론트에서 DB 직접 접근이 가능해서 API 코드 버그만으로도 데이터가 노출될 수 있습니다. RLS를 DB 레벨에서 걸면 auth.uid() 기준으로 자신의 데이터만 반환되므로 마지막 안전망 역할을 합니다.

---

### OCR 정확도 처리
**면접 답변**: GPT-4o Vision으로 이미지에서 품목/금액을 추출한 뒤, 바로 저장하지 않고 SalesInputTable 모달을 통해 사용자가 검토·수정하도록 합니다. AI 추출 결과를 pre-fill로만 쓰고 최종 저장 전 사람이 확인하는 구조입니다.

---

*마지막 업데이트: 2026-04-21*
