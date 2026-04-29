"""메뉴판 OCR LangGraph 파이프라인

흐름:
  [ocr_node] → [validate_node] → 성공 → [save_node]
                               → 실패 → [retry_node] → [save_node]

validate_node: LLM 호출 없이 Python 조건으로 판단 (비용 0)
  - menus 개수 0개 → 실패
  - 메뉴명 빈 항목 존재 → 실패
  - 가격 0원은 허용 (가격 미기재 메뉴판 대응)

retry_node: 더 상세한 프롬프트로 재호출 (최대 1회)
"""
from __future__ import annotations

import base64
import json
import logging
from typing import TypedDict

from langgraph.graph import StateGraph, END

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn): return fn
        return _decorator

from app.core.llm import client as _openai_client
from app.agents._sales._ocr import _MENU_PROMPT

log = logging.getLogger(__name__)

_MENU_RETRY_PROMPT = (
    "이미지를 더 꼼꼼히 분석해서 메뉴명을 빠짐없이 추출하세요.\n"
    "가격이 없는 메뉴도 price:0 으로 포함하세요.\n"
    "반드시 아래 JSON 형식으로만 반환하세요. 다른 텍스트 금지.\n\n"
    '{"menus":[{"name":"메뉴명","category":"음료 또는 디저트 또는 음식 또는 기타","price":가격정수}]}'
)


# ── 상태 정의 ─────────────────────────────────────────────────────────────────

class MenuOCRState(TypedDict):
    image_bytes: bytes
    mime_type:   str
    menus:       list
    is_valid:    bool
    retry_count: int
    fail_reason: str


# ── 노드 1: OCR ───────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_menu.ocr")
async def ocr_node(state: MenuOCRState) -> MenuOCRState:
    log.info("[OCR_MENU] ocr_node 시작")
    b64 = base64.standard_b64encode(state["image_bytes"]).decode("ascii")
    data_url = f"data:{state['mime_type']};base64,{b64}"
    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": [
                {"type": "text",      "text": _MENU_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        state["menus"] = parsed.get("menus") or []
    except Exception as e:
        log.warning("[OCR_MENU] ocr_node 실패: %s", e)
        state["menus"] = []
    log.info("[OCR_MENU] ocr_node 완료 | menus=%d건", len(state["menus"]))
    return state


# ── 노드 2: 검증 ──────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_menu.validate")
async def validate_node(state: MenuOCRState) -> MenuOCRState:
    menus = state["menus"]
    if not menus:
        state["is_valid"] = False
        state["fail_reason"] = "menus_empty"
        log.info("[OCR_MENU] validate_node 실패: menus_empty")
        return state
    if any(not m.get("name", "").strip() for m in menus):
        state["is_valid"] = False
        state["fail_reason"] = "empty_name"
        log.info("[OCR_MENU] validate_node 실패: empty_name")
        return state
    state["is_valid"] = True
    state["fail_reason"] = ""
    log.info("[OCR_MENU] validate_node 통과 | menus=%d건", len(menus))
    return state


# ── 노드 3: 재시도 ────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_menu.retry")
async def retry_node(state: MenuOCRState) -> MenuOCRState:
    log.info("[OCR_MENU] retry_node 시작 | reason=%s", state["fail_reason"])
    state["retry_count"] += 1
    b64 = base64.standard_b64encode(state["image_bytes"]).decode("ascii")
    data_url = f"data:{state['mime_type']};base64,{b64}"
    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": [
                {"type": "text",      "text": _MENU_RETRY_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        state["menus"] = parsed.get("menus") or []
    except Exception as e:
        log.warning("[OCR_MENU] retry_node 실패: %s", e)
        state["menus"] = []
    log.info("[OCR_MENU] retry_node 완료 | menus=%d건", len(state["menus"]))
    return state


# ── 노드 4: 저장 ──────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_menu.save")
async def save_node(state: MenuOCRState) -> MenuOCRState:
    log.info("[OCR_MENU] save_node | menus=%d건 반환", len(state["menus"]))
    return state


# ── 분기 조건 ─────────────────────────────────────────────────────────────────

def route_after_validate(state: MenuOCRState) -> str:
    if state["is_valid"] or state["retry_count"] >= 1:
        return "save"
    return "retry"


# ── 그래프 조립 ───────────────────────────────────────────────────────────────

def build_menu_ocr_graph():
    g = StateGraph(MenuOCRState)
    g.add_node("ocr",      ocr_node)
    g.add_node("validate", validate_node)
    g.add_node("retry",    retry_node)
    g.add_node("save",     save_node)

    g.set_entry_point("ocr")
    g.add_edge("ocr",   "validate")
    g.add_edge("retry", "save")
    g.add_edge("save",  END)

    g.add_conditional_edges(
        "validate",
        route_after_validate,
        {"save": "save", "retry": "retry"},
    )
    return g.compile()


# ── 진입점 ────────────────────────────────────────────────────────────────────

async def run_menu_ocr_graph(image_bytes: bytes, mime_type: str = "image/jpeg") -> list:
    """메뉴판 이미지 → LangGraph 파이프라인 → menus 리스트 반환."""
    pipeline = build_menu_ocr_graph()
    state = await pipeline.ainvoke({
        "image_bytes": image_bytes,
        "mime_type":   mime_type,
        "menus":       [],
        "is_valid":    False,
        "retry_count": 0,
        "fail_reason": "",
    })
    return state["menus"]
