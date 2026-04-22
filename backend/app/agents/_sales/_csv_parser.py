"""CSV / Excel 매출 파일 파서 — pandas 없이 csv 내장 + openpyxl 사용.

`sales.py` 의 `run_parse_csv` 핸들러에서만 호출.
GPT-4o-mini 로 컬럼명을 자동 매핑하고 items 리스트를 반환한다.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from datetime import date as _date
from typing import Any

from app.core.llm import chat_completion
from app.core.supabase import get_supabase

log = logging.getLogger(__name__)

_COLUMN_MAP_PROMPT = (
    "아래 CSV/Excel 헤더 컬럼명들을 분석해서 다음 표준 필드로 매핑해줘.\n"
    "반드시 JSON만 반환. 다른 텍스트 없음.\n\n"
    "표준 필드: date(날짜), item_name(메뉴/상품명), quantity(수량), "
    "unit_price(단가), amount(금액), category(카테고리)\n\n"
    "입력 컬럼: {columns}\n\n"
    '출력 형식: {{"date":"컬럼명 또는 null","item_name":"컬럼명 또는 null",'
    '"quantity":"컬럼명 또는 null","unit_price":"컬럼명 또는 null",'
    '"amount":"컬럼명 또는 null","category":"컬럼명 또는 null"}}\n\n'
    "없으면 null. 정확히 입력 컬럼명 중 하나만 사용."
)


async def _map_columns(headers: list[str]) -> dict[str, str | None]:
    try:
        resp = await chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": _COLUMN_MAP_PROMPT.format(
                        columns=json.dumps(headers, ensure_ascii=False)
                    ),
                },
                {"role": "user", "content": "매핑해줘"},
            ],
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
        )
        return json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:
        log.warning("[_csv_parser] column map failed: %s", e)
        return {}


def _parse_csv_bytes(file_bytes: bytes) -> tuple[list[str], list[dict]]:
    for encoding in ("utf-8-sig", "utf-8", "cp949", "euc-kr"):
        try:
            text = file_bytes.decode(encoding)
            reader = csv.DictReader(io.StringIO(text))
            headers = list(reader.fieldnames or [])
            rows = [dict(row) for row in reader]
            if headers:
                return headers, rows
        except Exception:
            continue
    return [], []


def _parse_xlsx_bytes(file_bytes: bytes) -> tuple[list[str], list[dict]]:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        if not all_rows:
            return [], []
        headers = [str(h).strip() if h is not None else f"col{i}" for i, h in enumerate(all_rows[0])]
        rows = []
        for row in all_rows[1:]:
            if all(v is None for v in row):
                continue
            rows.append({
                headers[i]: (str(row[i]).strip() if row[i] is not None else "")
                for i in range(len(headers))
            })
        return headers, rows
    except Exception as e:
        log.warning("[_csv_parser] xlsx parse failed: %s", e)
        return [], []


def _safe_int(val: Any) -> int:
    if val is None or str(val).strip() == "":
        return 0
    try:
        return int(str(val).replace(",", "").replace("원", "").replace(" ", "").strip())
    except Exception:
        return 0


def _build_items(rows: list[dict], mapping: dict[str, str | None], today: str) -> list[dict]:
    items = []
    for row in rows:
        item_name = row.get(mapping.get("item_name") or "", "").strip()
        if not item_name:
            continue
        quantity = _safe_int(row.get(mapping.get("quantity") or "", 1)) or 1
        unit_price = _safe_int(row.get(mapping.get("unit_price") or "", 0))
        amount = _safe_int(row.get(mapping.get("amount") or "", 0))
        if amount == 0 and unit_price > 0:
            amount = quantity * unit_price
        if unit_price == 0 and amount > 0 and quantity > 0:
            unit_price = amount // quantity
        category = row.get(mapping.get("category") or "", "기타").strip() or "기타"
        recorded_date = row.get(mapping.get("date") or "", today).strip() or today
        items.append({
            "item_name":     item_name,
            "category":      category,
            "quantity":      quantity,
            "unit_price":    unit_price,
            "amount":        amount,
            "recorded_date": recorded_date,
        })
    return items


async def parse_sales_file(
    *,
    storage_path: str,
    bucket: str = "documents-uploads",
    mime_type: str = "text/csv",
    original_name: str = "",
) -> dict[str, Any]:
    """Supabase storage 의 CSV/Excel 파일 → items 리스트.

    반환: {"items": [...], "total_rows": int, "mapped_date": bool}
    """
    sb = get_supabase()
    try:
        file_bytes = sb.storage.from_(bucket).download(storage_path)
    except Exception as e:
        log.warning("[_csv_parser] download failed path=%s err=%s", storage_path, e)
        return {"items": [], "total_rows": 0, "mapped_date": False}

    if not isinstance(file_bytes, (bytes, bytearray)):
        data = getattr(file_bytes, "data", None)
        if isinstance(data, (bytes, bytearray)):
            file_bytes = bytes(data)
        else:
            return {"items": [], "total_rows": 0, "mapped_date": False}

    is_excel = (
        "excel" in mime_type
        or "spreadsheet" in mime_type
        or original_name.lower().endswith((".xlsx", ".xls"))
    )

    if is_excel:
        headers, rows = _parse_xlsx_bytes(bytes(file_bytes))
        # xlsx 파싱 실패 시 CSV 폴백 (이름만 .xlsx로 바꾼 CSV 파일 대응)
        if not headers:
            log.info("[_csv_parser] xlsx failed, retrying as csv file=%s", original_name)
            headers, rows = _parse_csv_bytes(bytes(file_bytes))
    else:
        headers, rows = _parse_csv_bytes(bytes(file_bytes))

    if not headers or not rows:
        log.warning("[_csv_parser] empty parse result file=%s", original_name)
        return {"items": [], "total_rows": 0, "mapped_date": False}

    mapping = await _map_columns(headers)
    today = _date.today().isoformat()
    items = _build_items(rows, mapping, today)
    mapped_date = bool(mapping.get("date"))

    log.info(
        "[_csv_parser] done file=%s total_rows=%d items=%d mapped_date=%s",
        original_name, len(rows), len(items), mapped_date,
    )
    return {"items": items, "total_rows": len(rows), "mapped_date": mapped_date}
