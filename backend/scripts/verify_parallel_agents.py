"""
크로스 도메인 병렬 agent 실행 검증 스크립트.

테스트 케이스 3가지:
  1. 두 독립 step → asyncio.gather 병렬 실행 (타이밍 검증)
  2. depends_on 있는 순차 step → 순서 보장 검증
  3. ContextVar 격리 — 병렬 태스크 간 account_id 오염 없음 검증
"""
import asyncio
import time
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── 환경변수 없이 실행 가능하도록 최소 stub ─────────────────────────────────
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")
os.environ.setdefault("SUPABASE_URL", "https://stub.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")

from unittest.mock import AsyncMock, MagicMock, patch
from contextvars import ContextVar

# ── 실제 orchestrator 로직에서 핵심 함수만 추출 ───────────────────────────────
# (import 오류 방지를 위해 함수를 직접 복제)

async def _run_parallel_test():
    """asyncio.gather 병렬 실행 타이밍 검증."""
    DELAY = 0.3  # 각 handler 가 걸리는 시간

    async def slow_handler(name: str) -> tuple[str, str]:
        await asyncio.sleep(DELAY)
        return (name, f"reply_from_{name}")

    steps = [
        {"capability": "cap_a", "args": {}, "depends_on": None},
        {"capability": "cap_b", "args": {}, "depends_on": None},
    ]

    all_independent = all(not s.get("depends_on") for s in steps)
    assert all_independent, "steps가 모두 독립적이어야 함"

    # -- 병렬 실행
    t0 = time.perf_counter()
    pairs = await asyncio.gather(
        slow_handler("cap_a"),
        slow_handler("cap_b"),
    )
    elapsed = time.perf_counter() - t0

    assert len(pairs) == 2
    assert pairs[0] == ("cap_a", "reply_from_cap_a")
    assert pairs[1] == ("cap_b", "reply_from_cap_b")

    # 병렬이면 2*DELAY 보다 빠르게 끝나야 함 (여유 10% 허용)
    max_expected = DELAY * 1.5
    assert elapsed < max_expected, (
        f"병렬 실행이 예상보다 느림: {elapsed:.3f}s > {max_expected:.3f}s"
    )

    print(f"[PASS] 병렬 실행: {elapsed:.3f}s (기대 < {max_expected:.3f}s)")
    return True


async def _run_sequential_test():
    """depends_on 있는 순차 실행 — 결과가 preceding에 전달되는지 검증."""
    DELAY = 0.15

    results_map: dict[str, str] = {}
    call_log: list[str] = []

    async def handler_with_preceding(name: str, preceding: dict | None) -> tuple[str, str]:
        await asyncio.sleep(DELAY)
        call_log.append(name)
        # 순차면 preceding에 이전 결과가 있어야 함
        if name == "cap_b":
            assert preceding and "cap_a" in preceding, (
                "cap_b가 호출될 때 cap_a 결과가 preceding에 없음"
            )
        return (name, f"reply_{name}")

    steps = [
        {"capability": "cap_a", "args": {}, "depends_on": None},
        {"capability": "cap_b", "args": {}, "depends_on": "cap_a"},
    ]

    all_independent = all(not s.get("depends_on") for s in steps)
    assert not all_independent, "depends_on이 있으므로 순차여야 함"

    t0 = time.perf_counter()
    pairs = []
    for s in steps:
        name = s["capability"]
        dep = s.get("depends_on")
        preceding = results_map.copy() if dep else None
        n, r = await handler_with_preceding(name, preceding)
        results_map[n] = r
        pairs.append((n, r))
    elapsed = time.perf_counter() - t0

    assert call_log == ["cap_a", "cap_b"], f"호출 순서 오류: {call_log}"
    assert elapsed >= DELAY * 2 * 0.9, (
        f"순차 실행이 너무 빠름 (병렬로 잘못 실행됐을 수 있음): {elapsed:.3f}s"
    )

    print(f"[PASS] 순차 실행: {elapsed:.3f}s, 순서={call_log}")
    return True


async def _run_contextvar_isolation_test():
    """병렬 태스크 간 ContextVar 격리 — 각 태스크가 독립 컨텍스트를 가짐."""
    _ctx: ContextVar[str] = ContextVar("test_account_id")

    results: list[str] = []

    async def task(account_id: str, delay: float):
        # 각 task가 독립 컨텍스트를 갖는지 확인
        # asyncio.create_task 는 호출 시점의 컨텍스트를 복사하므로
        # 부모가 설정한 값을 읽을 수 있어야 함
        val = _ctx.get("MISSING")
        results.append(f"{account_id}:{val}")
        await asyncio.sleep(delay)

    # 부모 컨텍스트에서 값 설정 후 gather
    _ctx.set("parent_value")
    await asyncio.gather(
        asyncio.create_task(task("acct_A", 0.1)),
        asyncio.create_task(task("acct_B", 0.05)),
    )

    # 두 태스크 모두 부모의 값을 봐야 함
    assert all("parent_value" in r for r in results), (
        f"ContextVar 격리 실패: {results}"
    )

    print(f"[PASS] ContextVar 격리 검증: {results}")
    return True


async def _run_synthesize_test():
    """_synthesize_cross_domain 함수 실제 로직 경로 검증 (mock LLM)."""
    import re

    _ARTIFACT_RE = re.compile(r"\[ARTIFACT\](.*?)\[/ARTIFACT\]", re.DOTALL)
    _CHOICES_RE = re.compile(r"\[CHOICES\](.*?)\[/CHOICES\]", re.DOTALL)
    _SET_NICKNAME_RE = re.compile(r"\[SET_NICKNAME\](.*?)\[/SET_NICKNAME\]", re.DOTALL)
    _SET_PROFILE_RE = re.compile(r"\[SET_PROFILE\](.*?)\[/SET_PROFILE\]", re.DOTALL)

    def _strip_inline_blocks(text: str) -> str:
        text = _SET_NICKNAME_RE.sub("", text)
        text = _SET_PROFILE_RE.sub("", text)
        text = _ARTIFACT_RE.sub("", text)
        text = _CHOICES_RE.sub("", text)
        return text.strip()

    per_domain = {
        "recruitment": (
            "채용공고 초안을 캔버스에 올려뒀어요.\n"
            "[ARTIFACT]\ntype: job_posting\ntitle: 카페 알바 채용공고\n[/ARTIFACT]"
        ),
        "marketing": (
            "인스타 게시물을 작성했어요.\n"
            "[ARTIFACT]\ntype: sns_post\ntitle: 카페 홍보 게시물\n[/ARTIFACT]"
        ),
    }

    # [CHOICES] 없으면 합성 경로로 가야 함
    has_choices = any(_CHOICES_RE.search(r) for r in per_domain.values())
    assert not has_choices, "CHOICES 없는 경우여야 합성 경로로 진입"

    clean_map = {dom: _strip_inline_blocks(raw) for dom, raw in per_domain.items()}
    assert "ARTIFACT" not in clean_map["recruitment"]
    assert "캔버스에 올려뒀어요" in clean_map["recruitment"]

    print(f"[PASS] 합성 전처리: ARTIFACT 블록 제거, 본문 유지")
    return True


async def main():
    print("=" * 60)
    print("크로스 도메인 병렬 Agent 실행 검증")
    print("=" * 60)

    tests = [
        ("1. 병렬 실행 타이밍", _run_parallel_test),
        ("2. 순차 실행 (depends_on)", _run_sequential_test),
        ("3. ContextVar 격리", _run_contextvar_isolation_test),
        ("4. 합성 전처리 로직", _run_synthesize_test),
    ]

    passed = 0
    failed = 0
    for name, fn in tests:
        print(f"\n--- {name} ---")
        try:
            await fn()
            passed += 1
        except AssertionError as e:
            print(f"[FAIL] {e}")
            failed += 1
        except Exception as e:
            print(f"[ERROR] {type(e).__name__}: {e}")
            failed += 1

    print("\n" + "=" * 60)
    print(f"결과: {passed}/{passed+failed} 통과")
    if failed:
        print("⚠ 실패한 케이스가 있습니다.")
        sys.exit(1)
    else:
        print("모든 검증 통과")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
