# Resume Parse & Interview Question Generation — Design Spec

**Date:** 2026-04-24  
**Branch:** feature-recruit  
**Scope:** Recruitment agent — resume upload parsing + resume-based interview question generation

---

## Overview

소상공인이 채팅창에 구직자 이력서 파일(PDF/이미지, 복수 가능)을 올리면:

1. LLM이 이력서를 파싱해 구조화된 데이터를 `resumes` 테이블에 저장
2. 저장된 이력서 context 기반으로 날카로운 맞춤 면접 질문을 생성해 artifact로 저장

---

## 1. Frontend Changes

**File:** `frontend/components/chat/InlineChat.tsx`

- `DOMAIN_CAPABILITIES.recruitment` 배열에서 `"3개 플랫폼 동시 공고"` 항목 제거
- 새 항목 추가:
  ```ts
  { name: "이력서 분석 & 면접 질문", prompt: "이력서 파일을 올려주시면 파싱하고 맞춤 면접 질문을 뽑아드릴게요" }
  ```

---

## 2. DB Migration

**File:** `supabase/migrations/035_resumes_table.sql`  
**Apply via:** Supabase MCP

```sql
create table if not exists resumes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null,
  file_name    text,
  parsed_at    timestamptz not null default now(),
  applicant    jsonb not null default '{}'
);

create index if not exists resumes_account_id_idx on resumes (account_id);
```

**`applicant` JSONB 구조 (LLM이 추출, 없으면 null):**

```json
{
  "name": "홍길동",
  "phone": "010-1234-5678",
  "email": "hong@example.com",
  "age": 25,
  "address": "서울시 강남구",
  "education": [
    { "school": "...", "major": "...", "degree": "...", "year": "..." }
  ],
  "experience": [
    { "company": "...", "role": "...", "period": "...", "description": "..." }
  ],
  "skills": ["바리스타 2급", "포스기 운용"],
  "certifications": ["식품위생사"],
  "desired_position": "홀 서빙",
  "desired_salary": "시급 10,500원",
  "introduction": "자기소개 전문",
  "raw_text": "이력서 원문 텍스트 전체"
}
```

---

## 3. Backend: `recruit_resume_parse` Capability

**File:** `backend/app/agents/recruitment.py`

**Capability descriptor (`describe()`):**

```python
Capability(
    name="recruit_resume_parse",
    description="구직자 이력서 파일을 파싱해 DB에 저장합니다. 파일 업로드가 있을 때 사용.",
    parameters={
        "file_count": {"type": "integer", "description": "업로드된 이력서 파일 수"}
    }
)
```

**`run_resume_parse()` 함수 흐름:**

1. `_upload_context.get()` 으로 업로드 파일 목록 수신 (bytes + filename)
2. 파일별로 GPT-4o에 이미지/텍스트 전달 → `applicant` JSON 추출
3. Supabase `resumes` 테이블에 INSERT (account_id 스코프)
4. 파싱 요약 텍스트 생성 (이름, 경력 하이라이트)
5. `[CHOICES]` 응답: "면접 질문 생성할까요? / 다른 이력서도 올릴게요"

**파싱 프롬프트 원칙:**

- 없는 정보는 null (절대 hallucination 금지)
- `raw_text`는 항상 채움
- JSON 스키마를 response_format으로 강제

---

## 4. Backend: `recruit_resume_interview` Capability

**File:** `backend/app/agents/recruitment.py`

**Capability descriptor (`describe()`):**

```python
Capability(
    name="recruit_resume_interview",
    description="저장된 이력서를 바탕으로 날카로운 맞춤 면접 질문을 생성합니다.",
    parameters={
        "resume_id": {"type": "string", "description": "대상 이력서 UUID"},
        "count": {"type": "integer", "description": "질문 수 (기본 7)", "default": 7}
    }
)
```

**`run_resume_interview()` 함수 흐름:**

1. `resume_id`로 `resumes` 테이블 조회 (account_id 필터 필수)
2. `applicant` JSON 전체를 LLM context로 주입
3. 경력 공백, 직무 불일치, 짧은 재직기간, 자기소개 모순 등에서 날카로운 질문 도출
4. `_artifact.save()` — `kind='interview_questions'`, `metadata.resume_id` 연결
5. 채팅에 질문 목록 렌더링 + artifact 카드

**질문 생성 프롬프트 원칙:**

- 이력서의 구체적 내용(회사명, 기간, 역할)을 직접 인용한 질문
- "~하셨다고 하셨는데, 구체적으로 어떻게?" 형식 권장
- 직무 적합성, 성실성, 상황 대응력 축으로 분류

---

## 5. 전체 UX 흐름

```
사용자: 이력서 파일 3장 업로드 + "이력서 분석해줘"
  → orchestrator → recruit_resume_parse
  → 파싱 완료 요약 (지원자 3명 이름, 경력 1줄)
  → [CHOICES]: "홍길동 면접 질문 생성 / 김철수 면접 질문 생성 / 이영희 면접 질문 생성"

사용자: "홍길동 면접 질문 생성"
  → orchestrator → recruit_resume_interview (resume_id=홍길동 uuid)
  → artifact 저장 + 질문 목록 표시
```

---

## 6. 파일 변경 요약

| 파일                                        | 변경 내용                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `frontend/components/chat/InlineChat.tsx`   | "3개 플랫폼 동시 공고" 제거, "이력서 분석 & 면접 질문" 추가            |
| `supabase/migrations/035_resumes_table.sql` | resumes 테이블 생성                                                    |
| `backend/app/agents/recruitment.py`         | `run_resume_parse`, `run_resume_interview` 추가, `describe()` 업데이트 |

---

## 7. 제외 범위 (이번 스코프 밖)

- 이력서 목록 관리 UI (캔버스 카드뷰)
- 이력서 삭제/편집
- HWP 파일 파싱 (PDF/이미지만 지원)
