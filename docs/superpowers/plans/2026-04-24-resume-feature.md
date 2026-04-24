# Resume Parse & Interview Question Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소상공인이 채용 채팅창에 이력서 파일(PDF/이미지)을 올리면 LLM이 파싱해 `resumes` 테이블에 저장하고, 저장된 이력서 기반 맞춤 면접 질문을 생성해 artifact로 저장한다.

**Architecture:** `_upload_context` ContextVar로 업로드 payload를 전달하는 기존 패턴을 따른다. `resumes` 테이블에 직접 INSERT (service_role key). 면접 질문은 LLM 직접 호출 후 artifacts 테이블에 직접 저장 (`kind='artifact'`, `type='interview_questions'`, `metadata.resume_id`). 기존 `run()` 메인 함수를 거치지 않고 `run_resume_parse` / `run_resume_interview` 함수가 직접 LLM + DB를 처리한다.

**Tech Stack:** Python 3.12 + FastAPI (async), supabase-py, OpenAI GPT-4o, Next.js 16 TypeScript

---

## File Map

| 파일                                        | 변경                                                              |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `supabase/migrations/035_resumes_table.sql` | 신규 생성                                                         |
| `backend/app/models/schemas.py`             | `upload_payloads: list[dict] \| None` 추가                        |
| `backend/app/agents/_upload_context.py`     | 복수 upload 지원 (`_PENDING_UPLOADS`)                             |
| `backend/app/routers/chat.py`               | `upload_payloads` contextvar 세팅/해제                            |
| `backend/app/agents/recruitment.py`         | `run_resume_parse`, `run_resume_interview`, `describe()` 업데이트 |
| `frontend/components/chat/InlineChat.tsx`   | "3개 플랫폼 동시 공고" 제거, "이력서 분석 & 면접 질문" 추가       |

---

## Task 1: DB 마이그레이션 파일 생성 및 Supabase MCP 적용

**Files:**

- Create: `supabase/migrations/035_resumes_table.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 035_resumes_table.sql
create table if not exists resumes (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null,
  file_name    text,
  parsed_at    timestamptz not null default now(),
  applicant    jsonb not null default '{}'
);

create index if not exists resumes_account_id_idx on resumes (account_id);
```

- [ ] **Step 2: Supabase MCP로 SQL 실행**

MCP tool: `mcp__plugin_supabase_supabase__execute_sql`

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

Expected: 성공 응답 (no error)

- [ ] **Step 3: 테이블 존재 확인**

MCP tool: `mcp__plugin_supabase_supabase__execute_sql`

```sql
select column_name, data_type from information_schema.columns
where table_name = 'resumes' order by ordinal_position;
```

Expected:

```
id           | uuid
account_id   | uuid
file_name    | text
parsed_at    | timestamp with time zone
applicant    | jsonb
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/035_resumes_table.sql
git commit -m "feat: add resumes table migration (035)"
```

---

## Task 2: `_upload_context.py` — 복수 파일 지원 추가

**Files:**

- Modify: `backend/app/agents/_upload_context.py`

현재 파일은 단일 `upload_payload` dict만 지원한다. `_PENDING_UPLOADS` ContextVar를 추가해 복수 파일 지원.

- [ ] **Step 1: `_upload_context.py` 수정**

현재 파일 끝에 다음을 추가한다 (기존 코드 유지):

```python
# -- 복수 이력서 업로드 지원 (v0.11+) --
_PENDING_UPLOADS: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "boss2.pending_uploads", default=None
)


def set_pending_uploads(payloads: list[dict[str, Any]] | None) -> None:
    _PENDING_UPLOADS.set(payloads)


def get_pending_uploads() -> list[dict[str, Any]] | None:
    return _PENDING_UPLOADS.get()


def clear_pending_uploads() -> None:
    _PENDING_UPLOADS.set(None)
```

- [ ] **Step 2: 커밋**

```bash
git add backend/app/agents/_upload_context.py
git commit -m "feat: add plural upload context support for multi-resume upload"
```

---

## Task 3: `schemas.py` — `upload_payloads` 필드 추가

**Files:**

- Modify: `backend/app/models/schemas.py`

- [ ] **Step 1: `ChatRequest`에 `upload_payloads` 추가**

기존:

```python
class ChatRequest(BaseModel):
    message: str
    account_id: str
    session_id: str | None = None
    upload_payload: dict[str, Any] | None = None
    receipt_payload: dict[str, Any] | None = None
    save_payload: dict[str, Any] | None = None
```

변경 후:

```python
class ChatRequest(BaseModel):
    message: str
    account_id: str
    session_id: str | None = None
    upload_payload: dict[str, Any] | None = None
    upload_payloads: list[dict[str, Any]] | None = None  # 복수 파일용 (이력서 등)
    receipt_payload: dict[str, Any] | None = None
    save_payload: dict[str, Any] | None = None
```

- [ ] **Step 2: 커밋**

```bash
git add backend/app/models/schemas.py
git commit -m "feat: add upload_payloads list field to ChatRequest"
```

---

## Task 4: `chat.py` — `upload_payloads` contextvar 세팅

**Files:**

- Modify: `backend/app/routers/chat.py`

- [ ] **Step 1: import 추가**

기존:

```python
from app.agents._upload_context import set_pending_upload, clear_pending_upload
```

변경:

```python
from app.agents._upload_context import (
    set_pending_upload, clear_pending_upload,
    set_pending_uploads, clear_pending_uploads,
)
```

- [ ] **Step 2: `chat()` 핸들러에 `upload_payloads` 세팅 추가**

기존 (line ~97):

```python
    set_pending_upload(req.upload_payload)
```

변경:

```python
    set_pending_upload(req.upload_payload)
    set_pending_uploads(req.upload_payloads)
```

- [ ] **Step 3: finally 블록에 cleanup 추가**

기존:

```python
    finally:
        clear_pending_upload()
        clear_pending_receipt()
        clear_pending_save()
        clear_speaker()
```

변경:

```python
    finally:
        clear_pending_upload()
        clear_pending_uploads()
        clear_pending_receipt()
        clear_pending_save()
        clear_speaker()
```

- [ ] **Step 4: 커밋**

```bash
git add backend/app/routers/chat.py
git commit -m "feat: wire upload_payloads contextvar in chat router"
```

---

## Task 5: `recruitment.py` — `run_resume_parse()` 추가

**Files:**

- Modify: `backend/app/agents/recruitment.py`

`run_interview()` 함수 바로 뒤(line ~620 이후)에 추가한다.

- [ ] **Step 1: 이력서 파싱 시스템 프롬프트 상수 추가**

파일 상단 상수 영역(line ~53, `_GENERIC_VALID_TYPES` 근처)에 추가:

```python
_RESUME_PARSE_SYSTEM = (
    "당신은 이력서 파싱 전문가입니다. "
    "주어진 이력서 텍스트에서 정보를 추출해 JSON만 반환하세요. "
    "없는 정보는 null로 설정하세요. 절대 정보를 추측하거나 만들어내지 마세요.\n\n"
    "반환 형식 (JSON only, 설명 없이):\n"
    "{\n"
    '  "name": "이름 또는 null",\n'
    '  "phone": "연락처 또는 null",\n'
    '  "email": "이메일 또는 null",\n'
    '  "age": 나이(정수) 또는 null,\n'
    '  "address": "주소 또는 null",\n'
    '  "education": [{"school":"","major":"","degree":"","year":""}],\n'
    '  "experience": [{"company":"","role":"","period":"","description":""}],\n'
    '  "skills": ["기술1"],\n'
    '  "certifications": ["자격증1"],\n'
    '  "desired_position": "희망직종 또는 null",\n'
    '  "desired_salary": "희망급여 또는 null",\n'
    '  "introduction": "자기소개 전문 또는 null",\n'
    '  "raw_text": "이력서 원문 전체"\n'
    "}"
)

_INTERVIEW_FROM_RESUME_SYSTEM = (
    "당신은 소상공인 채용 전문가입니다. "
    "지원자 이력서를 바탕으로 날카롭고 구체적인 면접 질문을 생성합니다.\n"
    "규칙:\n"
    "- 이력서의 구체적 내용(회사명, 기간, 역할)을 직접 인용해 질문\n"
    "- 경력 공백, 짧은 재직기간, 직무 불일치는 파고드는 질문 포함\n"
    "- 직무 적합성 / 성실성 / 상황 대응력 3축으로 골고루 구성\n"
    "- 번호 목록 형식으로만 답변 (설명 없이 질문만)"
)
```

- [ ] **Step 2: `run_resume_parse()` 함수 추가**

`run_interview()` 함수 다음에 추가:

```python
async def run_resume_parse(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    file_count: int = 1,
) -> str:
    """구직자 이력서 파일(복수 가능)을 파싱해 resumes 테이블에 저장."""
    import json as _json
    from app.agents._upload_context import get_pending_upload, get_pending_uploads

    uploads = get_pending_uploads() or []
    if not uploads:
        single = get_pending_upload()
        if single:
            uploads = [single]

    if not uploads:
        return (
            "이력서 파일을 첨부해주세요. 파일을 채팅창에 업로드한 후 다시 요청해주세요.\n\n"
            "[CHOICES]\n이력서 파일 업로드할게요\n[/CHOICES]"
        )

    sb = get_supabase()
    saved: list[dict] = []

    for up in uploads:
        content = (up.get("content") or "").strip()
        file_name = up.get("original_name") or up.get("title") or "이력서"
        if not content:
            log.warning("[resume_parse] empty content for file=%s", file_name)
            continue

        parse_resp = await chat_completion(
            messages=[
                {"role": "system", "content": _RESUME_PARSE_SYSTEM},
                {"role": "user", "content": f"다음 이력서를 파싱해주세요:\n\n{content[:6000]}"},
            ],
            model="gpt-4o",
            response_format={"type": "json_object"},
        )
        raw_json = parse_resp.choices[0].message.content or "{}"
        try:
            applicant = _json.loads(raw_json)
        except Exception:
            applicant = {"raw_text": content}

        applicant["raw_text"] = applicant.get("raw_text") or content

        row = (
            sb.table("resumes")
            .insert({
                "account_id": account_id,
                "file_name": file_name,
                "applicant": applicant,
            })
            .execute()
            .data
        )
        if row:
            saved.append({
                "id": row[0]["id"],
                "name": (applicant.get("name") or "").strip() or file_name,
                "applicant": applicant,
            })

    if not saved:
        return "이력서 파싱에 실패했습니다. 파일이 텍스트를 포함하는지 확인해주세요."

    lines = []
    for s in saved:
        exp = (s["applicant"].get("experience") or [])
        if exp:
            first = exp[0]
            exp_str = f"{first.get('company','')} {first.get('role','')} {first.get('period','')}".strip()
        else:
            exp_str = "경력 정보 없음"
        lines.append(f"- **{s['name']}**: {exp_str}")

    choices_items = "\n".join(f"{s['name']} 면접 질문 생성" for s in saved)
    summary = "\n".join(lines)

    return (
        f"이력서 {len(saved)}건 파싱 완료:\n\n{summary}\n\n"
        f"[CHOICES]\n{choices_items}\n다른 이력서도 올릴게요\n[/CHOICES]"
    )
```

- [ ] **Step 3: `chat_completion` 임포트 확인**

파일 상단에 이미 `from app.core.llm import chat_completion` 이 있는지 확인.
있으면 통과, 없으면 추가.

- [ ] **Step 4: 커밋**

```bash
git add backend/app/agents/recruitment.py
git commit -m "feat: add run_resume_parse capability to recruitment agent"
```

---

## Task 6: `recruitment.py` — `run_resume_interview()` 추가

**Files:**

- Modify: `backend/app/agents/recruitment.py`

`run_resume_parse()` 다음에 추가.

- [ ] **Step 1: `run_resume_interview()` 함수 추가**

```python
async def run_resume_interview(
    *,
    account_id: str,
    message: str,
    history: list[dict],
    long_term_context: str = "",
    rag_context: str = "",
    applicant_name: str,
    count: int = 7,
) -> str:
    """저장된 이력서를 기반으로 맞춤 면접 질문 생성 후 artifact 저장."""
    # record_artifact_for_focus, pick_sub_hub_id 는 모듈 최상위에서 이미 import 됨
    sb = get_supabase()

    # account_id 필터 필수 — 최신 파싱 순으로 이름 매칭
    rows = (
        sb.table("resumes")
        .select("*")
        .eq("account_id", account_id)
        .order("parsed_at", desc=True)
        .limit(50)
        .execute()
        .data
        or []
    )
    resume = next(
        (r for r in rows if (r.get("applicant") or {}).get("name") == applicant_name),
        None,
    )
    if resume is None:
        # 이름 정확 매칭 실패 시 파일명으로 폴백
        resume = next(
            (r for r in rows if applicant_name in (r.get("file_name") or "")),
            rows[0] if rows else None,
        )
    if resume is None:
        return f"'{applicant_name}' 이력서를 찾을 수 없습니다. 먼저 이력서를 업로드해주세요."

    applicant = resume.get("applicant") or {}
    resume_id = resume["id"]
    name = (applicant.get("name") or "").strip() or applicant_name

    context_lines = [f"지원자 이름: {name}"]
    if applicant.get("experience"):
        for e in applicant["experience"]:
            context_lines.append(
                f"경력: {e.get('company','')} / {e.get('role','')} / {e.get('period','')} — {e.get('description','')}"
            )
    if applicant.get("education"):
        for ed in applicant["education"]:
            context_lines.append(f"학력: {ed.get('school','')} {ed.get('major','')} {ed.get('year','')}")
    if applicant.get("skills"):
        context_lines.append(f"기술: {', '.join(applicant['skills'])}")
    if applicant.get("certifications"):
        context_lines.append(f"자격증: {', '.join(applicant['certifications'])}")
    if applicant.get("introduction"):
        context_lines.append(f"자기소개: {applicant['introduction'][:500]}")
    if applicant.get("desired_position"):
        context_lines.append(f"희망직종: {applicant['desired_position']}")

    context_text = "\n".join(context_lines)

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": _INTERVIEW_FROM_RESUME_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"아래 지원자 이력서를 바탕으로 날카로운 면접 질문 {count}개를 생성해주세요.\n\n"
                    f"{context_text}"
                ),
            },
        ],
        model="gpt-4o",
    )
    questions_text = (resp.choices[0].message.content or "").strip()

    title = f"{name} 면접 질문"
    payload: dict = {
        "account_id": account_id,
        "domains": ["recruitment"],
        "kind": "artifact",
        "type": "interview_questions",
        "title": title,
        "content": questions_text,
        "status": "draft",
        "metadata": {"resume_id": resume_id},
    }
    result = sb.table("artifacts").insert(payload).execute()
    if result.data:
        artifact_id = result.data[0]["id"]
        record_artifact_for_focus(artifact_id)
        hub_id = pick_sub_hub_id(sb, account_id, "recruitment")
        if hub_id:
            try:
                sb.table("artifact_edges").insert({
                    "account_id": account_id,
                    "parent_id": hub_id,
                    "child_id": artifact_id,
                    "relation": "contains",
                }).execute()
            except Exception:
                pass
        try:
            sb.table("activity_logs").insert({
                "account_id": account_id,
                "type": "artifact_created",
                "domain": "recruitment",
                "title": title,
                "description": "interview_questions 생성됨",
                "metadata": {"artifact_id": artifact_id, "resume_id": resume_id},
            }).execute()
        except Exception:
            pass

    return (
        f"**{name}** 이력서 기반 면접 질문 {count}개 생성 완료.\n\n{questions_text}"
    )
```

- [ ] **Step 2: 커밋**

```bash
git add backend/app/agents/recruitment.py
git commit -m "feat: add run_resume_interview capability to recruitment agent"
```

---

## Task 7: `recruitment.py` — `describe()` 업데이트

**Files:**

- Modify: `backend/app/agents/recruitment.py`

`describe()` 함수의 `caps` 리스트 끝(마지막 capability 다음)에 2개 추가.

- [ ] **Step 1: `describe()` 끝에 두 capability 추가**

`caps` 리스트 마지막 항목(payroll_preview 또는 posting_poster) 뒤, `return caps` 전에 삽입:

```python
        {
            "name": "recruit_resume_parse",
            "description": (
                "구직자 이력서 파일을 파싱해 DB에 저장한다. "
                "사용자가 이력서 파일을 업로드하고 파싱/분석을 요청할 때 호출. "
                "upload_payload 또는 upload_payloads contextvar 에 파일 내용이 있어야 한다."
            ),
            "handler": run_resume_parse,
            "parameters": {
                "type": "object",
                "properties": {
                    "file_count": {
                        "type": "integer",
                        "description": "업로드된 이력서 파일 수 (1 이상)",
                        "default": 1,
                    },
                },
                "required": [],
            },
        },
        {
            "name": "recruit_resume_interview",
            "description": (
                "저장된 이력서를 바탕으로 날카로운 맞춤 면접 질문을 생성하고 artifact 로 저장한다. "
                "이력서 파싱 완료 후 특정 지원자의 면접 질문을 요청할 때 호출."
            ),
            "handler": run_resume_interview,
            "parameters": {
                "type": "object",
                "properties": {
                    "applicant_name": {
                        "type": "string",
                        "description": "면접 질문을 생성할 지원자 이름 (이력서에서 파싱된 이름)",
                    },
                    "count": {
                        "type": "integer",
                        "description": "생성할 면접 질문 수 (기본 7)",
                        "default": 7,
                        "minimum": 3,
                        "maximum": 15,
                    },
                },
                "required": ["applicant_name"],
            },
        },
```

- [ ] **Step 2: 커밋**

```bash
git add backend/app/agents/recruitment.py
git commit -m "feat: register resume capabilities in recruitment describe()"
```

---

## Task 8: `InlineChat.tsx` — 프론트엔드 선택지 업데이트

**Files:**

- Modify: `frontend/components/chat/InlineChat.tsx`

- [ ] **Step 1: "3개 플랫폼 동시 공고" 항목 제거**

현재 (lines ~217-220):

```typescript
      {
        name: "3개 플랫폼 동시 공고",
        prompt: "3개 플랫폼에 채용 공고 동시에 올려줘",
      },
```

이 블록을 삭제한다.

- [ ] **Step 2: "이력서 분석 & 면접 질문" 항목 추가**

`{ name: "인건비 계산", ... }` 항목 다음에 추가:

```typescript
      {
        name: "이력서 분석 & 면접 질문",
        prompt: "이력서 파일을 올려주시면 파싱하고 맞춤 면접 질문을 뽑아드릴게요",
      },
```

- [ ] **Step 3: 커밋**

```bash
git add frontend/components/chat/InlineChat.tsx
git commit -m "feat: update recruitment quick-replies — remove 3-platform, add resume analysis"
```

---

## Task 9: 통합 검증

- [ ] **Step 1: 백엔드 서버 기동 확인**

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Expected: 서버 정상 기동, 에러 없음

- [ ] **Step 2: `describe()` capability 등록 확인**

```bash
python -c "
from app.agents.recruitment import describe
caps = describe('test')
names = [c['name'] for c in caps]
print(names)
assert 'recruit_resume_parse' in names
assert 'recruit_resume_interview' in names
print('OK')
"
```

Expected: `OK` 출력

- [ ] **Step 3: Supabase resumes 테이블 INSERT 테스트**

```bash
python -c "
from app.core.supabase import get_supabase
import asyncio
sb = get_supabase()
r = sb.table('resumes').insert({
    'account_id': '00000000-0000-0000-0000-000000000000',
    'file_name': 'test.pdf',
    'applicant': {'name': '테스트', 'raw_text': '테스트 이력서'}
}).execute()
print('inserted:', r.data[0]['id'])
sb.table('resumes').delete().eq('account_id', '00000000-0000-0000-0000-000000000000').execute()
print('cleaned up OK')
"
```

Expected: `inserted: <uuid>` + `cleaned up OK`

- [ ] **Step 4: 커밋 (없으면 skip)**

변경 없으면 skip.

---

## 완료 기준

- [ ] `resumes` 테이블이 Supabase에 존재
- [ ] `recruitment describe()`에 `recruit_resume_parse`, `recruit_resume_interview` 포함
- [ ] InlineChat.tsx에서 "3개 플랫폼 동시 공고" 미노출, "이력서 분석 & 면접 질문" 노출
- [ ] 백엔드 서버 기동 에러 없음
