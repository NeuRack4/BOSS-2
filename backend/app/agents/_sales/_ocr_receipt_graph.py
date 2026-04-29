"""영수증 OCR LangGraph 파이프라인

흐름:
  [ocr_node] → [validate_node] → 성공 → [save_node]
                               → 실패 → [retry_node] → [save_node]

validate_node: LLM 호출 없이 Python 조건으로 판단 (비용 0)
  - items 개수 0개 → 실패
  - type이 "sales" 또는 "cost" 아닌 값 → 실패
  - amount가 음수인 항목 존재 → 실패

retry_node: 더 상세한 프롬프트로 재호출 (최대 1회)
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import date as _date
from typing import TypedDict

from langgraph.graph import StateGraph, END

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn): return fn
        return _decorator

from app.core.llm import client as _openai_client
from app.agents._sales._ocr import _RECEIPT_PROMPT

log = logging.getLogger(__name__)

_RECEIPT_RETRY_PROMPT = (
    "영수증을 더 꼼꼼히 분석해서 모든 품목을 추출하세요.\n"
    "type은 반드시 \"sales\" 또는 \"cost\" 중 하나여야 합니다.\n"
    "amount는 반드시 양수 정수여야 합니다.\n"
    "반드시 아래 JSON 형식으로만 반환하세요. 다른 텍스트 금지.\n\n"
    '{"type":"sales 또는 cost","items":[{"item_name":"품목명","category":"분류",'
    '"quantity":수량정수,"unit_price":단가정수,"amount":금액정수,"memo":""}]}'
)

_VALID_TYPES = {"sales", "cost"}


# ── 상태 정의 ─────────────────────────────────────────────────────────────────

class ReceiptOCRState(TypedDict):
    image_bytes: bytes
    mime_type:   str
    result:      dict   # {"type": "sales"|"cost", "items": [...]}
    is_valid:    bool
    retry_count: int
    fail_reason: str


# ── 노드 1: OCR ───────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_receipt.ocr")
async def ocr_node(state: ReceiptOCRState) -> ReceiptOCRState:
    log.info("[OCR_RECEIPT] ocr_node 시작")
    b64 = base64.standard_b64encode(state["image_bytes"]).decode("ascii")
    data_url = f"data:{state['mime_type']};base64,{b64}"
    today = _date.today().isoformat()
    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": [
                {"type": "text",      "text": _RECEIPT_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        items = parsed.get("items") or []
        for it in items:
            if not it.get("recorded_date"):
                it["recorded_date"] = today
        state["result"] = {
            "type":  parsed.get("type") if parsed.get("type") in _VALID_TYPES else "sales",
            "items": items,
        }
    except Exception as e:
        log.warning("[OCR_RECEIPT] ocr_node 실패: %s", e)
        state["result"] = {"type": "sales", "items": []}
    log.info("[OCR_RECEIPT] ocr_node 완료 | items=%d건", len(state["result"]["items"]))
    return state


# ── 노드 2: 검증 ──────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_receipt.validate")
async def validate_node(state: ReceiptOCRState) -> ReceiptOCRState:
    result = state["result"]
    items = result.get("items") or []

    if not items:
        state["is_valid"] = False
        state["fail_reason"] = "items_empty"
        log.info("[OCR_RECEIPT] validate_node 실패: items_empty")
        return state

    if result.get("type") not in _VALID_TYPES:
        state["is_valid"] = False
        state["fail_reason"] = "invalid_type"
        log.info("[OCR_RECEIPT] validate_node 실패: invalid_type")
        return state

    if any(it.get("amount", 0) < 0 for it in items):
        state["is_valid"] = False
        state["fail_reason"] = "negative_amount"
        log.info("[OCR_RECEIPT] validate_node 실패: negative_amount")
        return state

    state["is_valid"] = True
    state["fail_reason"] = ""
    log.info("[OCR_RECEIPT] validate_node 통과 | items=%d건", len(items))
    return state


# ── 노드 3: 재시도 ────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_receipt.retry")
async def retry_node(state: ReceiptOCRState) -> ReceiptOCRState:
    log.info("[OCR_RECEIPT] retry_node 시작 | reason=%s", state["fail_reason"])
    state["retry_count"] += 1
    b64 = base64.standard_b64encode(state["image_bytes"]).decode("ascii")
    data_url = f"data:{state['mime_type']};base64,{b64}"
    today = _date.today().isoformat()
    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": [
                {"type": "text",      "text": _RECEIPT_RETRY_PROMPT},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]}],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
        raw = resp.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        items = parsed.get("items") or []
        for it in items:
            if not it.get("recorded_date"):
                it["recorded_date"] = today
        state["result"] = {
            "type":  parsed.get("type") if parsed.get("type") in _VALID_TYPES else "sales",
            "items": items,
        }
    except Exception as e:
        log.warning("[OCR_RECEIPT] retry_node 실패: %s", e)
    log.info("[OCR_RECEIPT] retry_node 완료 | items=%d건", len(state["result"]["items"]))
    return state


# ── 노드 4: 저장 ──────────────────────────────────────────────────────────────

@_traceable(name="sales._ocr_receipt.save")
async def save_node(state: ReceiptOCRState) -> ReceiptOCRState:
    log.info("[OCR_RECEIPT] save_node | items=%d건 반환", len(state["result"]["items"]))
    return state


# ── 분기 조건 ─────────────────────────────────────────────────────────────────

def route_after_validate(state: ReceiptOCRState) -> str:
    if state["is_valid"] or state["retry_count"] >= 1:
        return "save"
    return "retry"


# ── 그래프 조립 ───────────────────────────────────────────────────────────────

def build_receipt_ocr_graph():
    g = StateGraph(ReceiptOCRState)
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

async def run_receipt_ocr_graph(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """영수증 이미지 → LangGraph 파이프라인 → {"type": ..., "items": [...]} 반환."""
    pipeline = build_receipt_ocr_graph()
    state = await pipeline.ainvoke({
        "image_bytes": image_bytes,
        "mime_type":   mime_type,
        "result":      {"type": "sales", "items": []},
        "is_valid":    False,
        "retry_count": 0,
        "fail_reason": "",
    })
    return state["result"]
