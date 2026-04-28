# DeepAgent 리팩토링 설계 문서

**날짜**: 2026-04-26  
**브랜치**: refactor  
**작업자**: Afraid-Not

---

## 목표

소상공인 자율 운영 플랫폼 BOSS-2의 Planner와 Domain Agent(Documents 우선)를 `deepagents` SDK 기반 DeepAgent로 전환한다.

- Planner가 능동적으로 tool을 호출해 컨텍스트를 수집하는 구조
- Domain Agent가 multi-step tool calling으로 복합 요청 처리
- 결과물(artifact 저장, 채팅 UI, 스케줄링) 동작은 현재와 동일하게 유지

---

## 핵심 제약

1. **결과물 계층 불변** — artifact 저장, UI 마커(`[[instagram_post]]` 등), 스케줄링 기능은 이전과 동일하게 동작해야 한다.
2. **Planner 내부 tool call 비노출** — deepagent의 내부 추론/tool call 로그는 절대 사용자 reply에 포함되지 않는다. Terminal tool 결과만 reply로 추출한다.
3. **점진적 전환** — 한 번에 전체를 교체하지 않고 Phase별로 검증 후 진행한다.
4. **API 응답 형식 유지** — `{ reply, choices, speaker }` 구조 변경 없음.

---

## 전체 아키텍처

```
User
  ↓
[planner_node] — Planner DeepAgent
  non-terminal tools:
    get_profile()
    search_memory(query)
    get_recent_artifacts(domain?, limit?)
    get_memos(limit?)
    list_capabilities()
  terminal tools:
    ask_user(question, choices?)   → plan_mode = "ask"
    dispatch(steps, brief, opening?) → plan_mode = "dispatch"
  ↓
route_plan()
  ├─ "ask"      → ask_node      → profile_saver_node → END
  ├─ "chitchat" → chitchat_node → profile_saver_node → END
  ├─ "refuse"   → refuse_node   → profile_saver_node → END
  ├─ "planning" → planning_node → profile_saver_node → END
  └─ "dispatch" → run_domain_node (Send()로 병렬)
                    ├─ documents_node  — Documents DeepAgent
                    ├─ marketing_node  — Marketing DeepAgent
                    ├─ recruitment_node — Recruitment DeepAgent
                    └─ sales_node      — Sales DeepAgent
  ↓
synthesizer_node  (복수 도메인이면 합성, 단일이면 pass-through)
  ↓
profile_saver_node  (profile_updates DB 저장)
  ↓
END

API response: { reply: str, choices: list[str], speaker: list[str] }
```

---

## BossState

```python
# backend/app/agents/graph/state.py
from typing import Annotated
import operator
from typing_extensions import TypedDict

class DomainResult(TypedDict):
    domain: str
    capability: str
    reply: str

class BossState(TypedDict):
    # 입력
    account_id: str
    message: str
    history: list[dict]
    rag_context: str
    long_term_context: str
    # planner 출력
    plan_mode: str           # dispatch | ask | chitchat | refuse | planning | error
    plan_steps: list[dict]   # [{ capability, args, depends_on }]
    plan_brief: str
    plan_opening: str
    plan_question: str
    plan_choices: list[str]
    profile_updates: dict[str, str]
    # domain 출력 (Send()용 — add reducer로 병렬 집계)
    domain_results: Annotated[list[DomainResult], operator.add]
    # 최종 출력
    final_reply: str
    final_choices: list[str]
    speaker: list[str]
```

---

## Planner DeepAgent

### 도구 명세

| Tool | 설명 | Terminal |
|------|------|----------|
| `get_profile()` | 사용자 프로필(업종, 지역, 단계 등) 반환 | No |
| `search_memory(query)` | pgvector 장기기억 하이브리드 검색 | No |
| `get_recent_artifacts(domain?, limit?)` | 최근 저장 artifact 목록 | No |
| `get_memos(limit?)` | 최근 메모 목록 | No |
| `list_capabilities()` | 4개 도메인 capability 카탈로그 (파라미터 스펙 포함) | No |
| `ask_user(question, choices?)` | 사용자에게 되묻기 (명확화 질문) | **Yes** |
| `dispatch(steps, brief, opening?)` | 도메인 에이전트 실행 결정 | **Yes** |

### 강제 종료 로직 (2-attempt retry)

```python
result = await planner_agent.ainvoke({"messages": [...], "context": ...})

terminal_called = extract_terminal_tool(result)  # ask_user 또는 dispatch
if not terminal_called:
    # retry with reminder injected into system
    result = await planner_agent.ainvoke({"messages": [..., TERMINAL_REMINDER]})
    terminal_called = extract_terminal_tool(result)
    if not terminal_called:
        return error_fallback()
```

### dispatch tool 스키마

```python
{
    "steps": [
        {
            "capability": str,   # 카탈로그에 존재하는 이름
            "args": dict,        # required 파라미터 모두 채워진 상태
            "depends_on": str | None  # None이면 병렬 실행 가능
        }
    ],
    "brief": str,      # domain agent에 전달할 내부 지시
    "opening": str     # 사용자에게 먼저 보이는 한두 줄 (선택)
}
```

### 명확화 원칙

- **Planner가 모든 명확화 질문을 담당한다.**
- `list_capabilities()` 결과에서 required 파라미터를 확인하고 부족하면 `ask_user()` 호출.
- Domain agent는 항상 완전한 args를 받아 실행만 한다. 내부에서 되묻지 않는다.

---

## Domain DeepAgents

### Documents DeepAgent

**도구 목록**

| Tool | 설명 | Terminal |
|------|------|----------|
| `get_uploaded_doc()` | 업로드 문서 컨텍스트 | No |
| `get_recent_analysis()` | 직전 공정성 분석 결과 | No |
| `get_sub_hubs()` | 이 계정 서브허브 목록 | No |
| `handle_legal(question)` | 법률 Q&A 처리 | No |
| `write_document(type, title, content, subtype?, metadata?)` | 서류 작성 + artifact 직접 저장 | **Yes** |
| `analyze_document(doc_id_or_ephemeral, user_role, subtype?)` | 공정성 분석 + artifact 직접 저장 | **Yes** |

**기존 StateGraph 대체**

| 기존 노드 | 신규 방식 |
|----------|----------|
| `classify_node` | DeepAgent가 내부적으로 판단 |
| `legal_node` | `handle_legal()` tool 호출 |
| `review_node` | `analyze_document()` tool 호출 |
| `write_review_node` | `write_document(type="contract")` 호출 |
| `write_tax_hr_node` | `write_document(type="checklist"|"payroll_doc")` 호출 |
| `write_operations_node` | `write_document(type="estimate"|"notice")` 호출 |
| `ask_category_node` | 제거 — Planner가 사전에 처리 |

### 나머지 3개 도메인 (Marketing, Recruitment, Sales)

기존 handler 함수를 tool로 래핑. Documents와 동일한 패턴.

| 도메인 | 주요 terminal tools |
|--------|-------------------|
| Marketing | `write_sns_post()`, `write_blog_post()`, `write_event_plan()`, `write_event_poster()`, `write_review_reply()`, `schedule_task()` |
| Recruitment | `write_job_posting()`, `parse_resume()`, `generate_interview_questions()` |
| Sales | `record_sales()`, `analyze_sales()`, `record_cost()`, `analyze_menu()` |

---

## Artifact 저장 방식 변경

| 항목 | 기존 | 신규 |
|------|------|------|
| 저장 트리거 | LLM이 `[ARTIFACT]` 마커 삽입 → `save_artifact_from_reply()` 파싱 | tool 내부에서 직접 Supabase 저장 |
| 실패 원인 | LLM이 마커 형식을 틀리거나 누락 가능 | 저장 로직이 tool 코드에 고정 → 파싱 에러 없음 |
| reply 텍스트 | `[ARTIFACT]...` 포함 | `[ARTIFACT]` 마커 없음 |
| Rich card markers | `[[instagram_post]]` 등 reply에 포함 | tool이 동일 형식 문자열 반환 → 그대로 reply에 포함 |

`[SET_PROFILE]`, `[SET_NICKNAME]` 마커도 동일하게 제거 — tool이 직접 저장.

---

## Orchestrator 변경

```python
# orchestrator.py (경량화 후)
async def run(message, account_id, history, rag_context="", long_term_context="") -> str:
    result = await boss_graph.ainvoke(BossState(...))
    return result["final_reply"]
```

기존 orchestrator.py의 1000줄+ 로직 대부분이 graph/nodes.py로 이동.  
`build_briefing()`, `run_scheduled()` 등 주변 기능은 orchestrator.py에 유지.

---

## 마이그레이션 전략 (3 Phase)

### Phase 1: Planner DeepAgent 전환
- `backend/app/agents/_planner.py` → DeepAgent 버전으로 교체
- `orchestrator._dispatch_via_planner()` → 새 planner 사용
- Domain agents (documents, marketing, recruitment, sales) 현재 그대로 유지
- **검증 게이트**: 라우팅, choices, artifact 저장, scheduling 정상 동작 확인

### Phase 2: Documents DeepAgent 전환
- `backend/app/agents/documents.py` StateGraph → DeepAgent 교체
- 나머지 3개 도메인 현재 그대로 유지
- **검증 게이트**: 계약서 작성, 법률 Q&A, 공정성 분석, sub_hub 저장 확인

### Phase 3: 나머지 도메인 + 그래프 통합
- Marketing, Recruitment, Sales → DeepAgent 전환
- `backend/app/agents/graph/` 디렉토리 생성 (state.py, builder.py, nodes.py)
- orchestrator.py 경량화
- **검증 게이트**: 전체 E2E 동작 확인

---

## 패키지 추가

```
deepagents  (langchain-ai/deepagents)
```

`backend/requirements.txt`에 추가.

---

## 변경되지 않는 것

- API 응답 형식: `{ reply, choices, speaker }`
- 프론트 마커 파싱 로직 (`[[instagram_post]]`, `[ACTION:...]` 등)
- Celery Beat 스케줄링 연동
- Supabase artifact/profile 테이블 스키마
- RAG 파이프라인
- 장기기억 압축/저장 로직
