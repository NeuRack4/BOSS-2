"""영수증 OCR — 이미지 → 항목 추출 (GPT-4o Vision).

`sales.py` 에이전트 내부에서만 호출. 기존 `routers/sales_ocr.py` 의 이미지
파싱 로직을 agent 경로로 이동한 것. Excel/CSV 파싱은 본 모듈 범위 밖.

주요 진입점
-----------
- `parse_receipt_from_storage(account_id, storage_path, bucket, mime_type)`
  Supabase storage 에서 이미지를 내려받아 vision 모델로 항목 추출.
- `parse_receipt_from_bytes(file_bytes, mime_type)` — 이미 메모리에 있는 경우.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import date as _date
from typing import Any

try:
    from langsmith import traceable as _traceable
except ImportError:
    def _traceable(**_kw):
        def _decorator(fn):
            return fn
        return _decorator

from app.core.llm import client as _openai_client
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)


_MENU_PROMPT = (
    "이 이미지는 카페·식당·가게의 메뉴판입니다.\n"
    "메뉴명과 가격을 모두 추출해 반드시 아래 JSON 형식으로만 반환하세요. 다른 텍스트 금지.\n\n"
    '{"menus":[{"name":"메뉴명","category":"음료 또는 디저트 또는 음식 또는 기타","price":가격정수}]}\n\n'
    "규칙:\n"
    "- category: 음료(커피·차·주스·라떼 등) / 디저트(케이크·쿠키·빵 등) / 음식(밥·면·반찬 등) / 기타\n"
    "- price: 숫자만 (원 단위 정수). 가격 없으면 0\n"
    "- 섹션 제목·설명·재료 등 메뉴가 아닌 텍스트 제외\n"
    "- 동일 메뉴 중복 제거\n"
    '- 파싱 불가 시 {"menus":[]}'
)

_RECEIPT_PROMPT = (
    "이 이미지는 영수증, 판매 내역, 또는 비용 기록입니다.\n"
    "이미지에서 품목/항목 정보를 추출해 반드시 아래 JSON 형식으로만 반환하세요. 다른 텍스트 금지.\n\n"
    '{"type":"sales 또는 cost","items":[{"item_name":"품목명","category":"분류",'
    '"quantity":수량정수,"unit_price":단가정수,"amount":금액정수,"memo":""}]}\n\n'
    "규칙:\n"
    "- type: 판매/매출 내역이면 'sales', 구매/지출/비용이면 'cost'\n"
    "- category(sales): 음료/음식/디저트/상품/서비스/기타\n"
    "- category(cost): 재료비/인건비/임대료/공과금/마케팅/기타\n"
    "- amount = quantity × unit_price. 합계만 보이면 quantity=1, unit_price=amount\n"
    "- 인식 불가 항목은 제외\n"
    '- 파싱 불가 시 {"type":"sales","items":[]}'
)


@_traceable(name="sales._ocr.parse_receipt_from_bytes")
async def parse_receipt_from_bytes(
    file_bytes: bytes,
    mime_type: str = "image/jpeg",
) -> dict[str, Any]:
    """이미지 바이트 → {"type": "sales"|"cost", "items": [...]} 반환."""
    b64 = base64.standard_b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"

    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text",      "text": _RECEIPT_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
    except Exception as e:
        log.warning("receipt vision call failed: %s", e)
        return {"type": "sales", "items": []}

    raw = resp.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
    except Exception:
        return {"type": "sales", "items": []}

    # 기본값 보정
    today = _date.today().isoformat()
    items = parsed.get("items") or []
    for it in items:
        if not it.get("recorded_date"):
            it["recorded_date"] = today
    kind = parsed.get("type") if parsed.get("type") in ("sales", "cost") else "sales"
    return {"type": kind, "items": items}


@_traceable(name="sales._ocr.parse_menu_from_bytes")
async def parse_menu_from_bytes(
    file_bytes: bytes,
    mime_type: str = "image/jpeg",
) -> list[dict]:
    """메뉴판 이미지 → [{"name", "category", "price"}, ...] 반환."""
    b64 = base64.standard_b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"

    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text",      "text": _MENU_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
    except Exception as e:
        log.warning("menu vision call failed: %s", e)
        return []

    raw = resp.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
    except Exception:
        return []

    return parsed.get("menus") or []


async def parse_receipt_from_storage(
    *,
    storage_path: str,
    bucket: str = "documents-uploads",
    mime_type: str = "image/jpeg",
) -> dict[str, Any]:
    """Supabase storage 에서 이미지를 내려받아 파싱."""
    sb = get_supabase()
    try:
        file_bytes = sb.storage.from_(bucket).download(storage_path)
    except Exception as e:
        log.warning("storage download failed: bucket=%s path=%s err=%s", bucket, storage_path, e)
        return {"type": "sales", "items": []}
    if not isinstance(file_bytes, (bytes, bytearray)):
        # supabase-py 일부 버전은 bytes 직접 반환, 다른 버전은 Response 객체. 방어.
        data = getattr(file_bytes, "data", None)
        if isinstance(data, (bytes, bytearray)):
            file_bytes = bytes(data)
        else:
            return {"type": "sales", "items": []}
    return await parse_receipt_from_bytes(bytes(file_bytes), mime_type=mime_type)
