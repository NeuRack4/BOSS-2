"""매출/비용 파일 파싱 API

POST /api/sales/ocr
  - 이미지(여러 장): GPT-4o Vision → 항목 파싱
  - Excel(.xlsx/.xls): openpyxl → 컬럼 자동 매핑
  - CSV(.csv): csv 모듈 → 컬럼 자동 매핑
  - 반환: { type: "sales"|"cost", date: "YYYY-MM-DD", items: [...] }
"""
from __future__ import annotations

import base64
import csv
import io
import json
import logging
import re
from datetime import date as _date
from typing import Literal

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.core.llm import client as _openai_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sales", tags=["sales_ocr"])

_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tiff", "gif", "heic", "heif"}
_EXCEL_EXTS = {"xlsx", "xls"}
_CSV_EXTS   = {"csv"}

_MIME_MAP = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "webp": "image/webp", "bmp": "image/bmp", "tiff": "image/tiff",
    "gif": "image/gif", "heic": "image/heic", "heif": "image/heif",
}

# 컬럼명 후보 매핑 (한/영 혼용)
_COL_ITEM   = {"품목", "상품명", "항목", "item_name", "item", "상품", "메뉴", "품명", "name"}
_COL_QTY    = {"수량", "qty", "quantity", "개수"}
_COL_PRICE  = {"단가", "unit_price", "price", "단위금액"}
_COL_AMOUNT = {"금액", "amount", "합계", "total", "판매액", "매출액", "비용", "결제금액"}
_COL_CAT    = {"분류", "category", "카테고리", "구분"}
_COL_DATE   = {"날짜", "date", "일자", "기록일", "recorded_date"}
_COL_MEMO   = {"메모", "memo", "note", "비고"}


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _match_col(header: str, candidates: set[str]) -> bool:
    h = header.strip().lower()
    return h in candidates or any(c in h for c in candidates)


def _parse_int(val: str | None) -> int:
    if not val:
        return 0
    cleaned = re.sub(r"[^\d]", "", str(val))
    return int(cleaned) if cleaned else 0


# ── Excel 파싱 ────────────────────────────────────────────────────────────────

def _parse_excel(data: bytes) -> list[dict]:
    try:
        import openpyxl
    except ImportError:
        raise HTTPException(status_code=422, detail="openpyxl 패키지가 없습니다. pip install openpyxl")

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    # 헤더 행 찾기 (첫 10행 중 가장 많은 컬럼이 매핑되는 행)
    header_idx, col_map = _detect_header(rows[:10])
    if col_map is None:
        return []

    items = []
    for row in rows[header_idx + 1:]:
        item = _row_to_item(row, col_map)
        if item:
            items.append(item)
    return items


# ── CSV 파싱 ─────────────────────────────────────────────────────────────────

def _parse_csv(data: bytes) -> list[dict]:
    # UTF-8 → EUC-KR 순으로 시도
    text = None
    for enc in ("utf-8-sig", "utf-8", "euc-kr", "cp949"):
        try:
            text = data.decode(enc)
            break
        except Exception:
            continue
    if text is None:
        raise HTTPException(status_code=422, detail="CSV 인코딩을 인식할 수 없습니다.")

    reader = csv.reader(io.StringIO(text))
    rows = [tuple(r) for r in reader if any(c.strip() for c in r)]
    if not rows:
        return []

    header_idx, col_map = _detect_header(rows[:10])
    if col_map is None:
        return []

    items = []
    for row in rows[header_idx + 1:]:
        item = _row_to_item(row, col_map)
        if item:
            items.append(item)
    return items


# ── 공통 헤더/행 처리 ─────────────────────────────────────────────────────────

def _detect_header(rows: list[tuple]) -> tuple[int, dict | None]:
    best_idx, best_map, best_score = 0, None, 0
    for i, row in enumerate(rows):
        headers = [str(c) if c is not None else "" for c in row]
        col_map: dict[str, int] = {}
        for j, h in enumerate(headers):
            if _match_col(h, _COL_ITEM)   and "item"   not in col_map: col_map["item"]   = j
            if _match_col(h, _COL_QTY)    and "qty"    not in col_map: col_map["qty"]    = j
            if _match_col(h, _COL_PRICE)  and "price"  not in col_map: col_map["price"]  = j
            if _match_col(h, _COL_AMOUNT) and "amount" not in col_map: col_map["amount"] = j
            if _match_col(h, _COL_CAT)    and "cat"    not in col_map: col_map["cat"]    = j
            if _match_col(h, _COL_DATE)   and "date"   not in col_map: col_map["date"]   = j
            if _match_col(h, _COL_MEMO)   and "memo"   not in col_map: col_map["memo"]   = j
        score = len(col_map)
        if score > best_score:
            best_idx, best_map, best_score = i, col_map, score
    return (best_idx, best_map) if best_score >= 1 else (0, None)


def _row_to_item(row: tuple, col_map: dict) -> dict | None:
    def get(key: str) -> str:
        idx = col_map.get(key)
        if idx is None or idx >= len(row):
            return ""
        return str(row[idx]).strip() if row[idx] is not None else ""

    item_name = get("item")
    if not item_name:
        return None

    qty    = _parse_int(get("qty")) or 1
    price  = _parse_int(get("price"))
    amount = _parse_int(get("amount")) or (qty * price)

    if amount == 0:
        return None

    return {
        "item_name": item_name,
        "category":  get("cat") or "기타",
        "quantity":  qty,
        "unit_price": price or amount,
        "amount":    amount,
        "memo":      get("memo"),
        "recorded_date": get("date") or _date.today().isoformat(),
    }


# ── 이미지 OCR + 항목 파싱 ────────────────────────────────────────────────────

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


async def _ocr_image_to_items(file_bytes: bytes, filename: str) -> dict:
    ext = _ext(filename)
    mime = _MIME_MAP.get(ext, "image/jpeg")
    b64 = base64.standard_b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": _RECEIPT_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=2000,
        )
    except Exception as e:
        log.warning("receipt ocr failed for %s: %s", filename, e)
        return {"type": "sales", "items": []}

    raw = resp.choices[0].message.content or "{}"
    try:
        return json.loads(raw)
    except Exception:
        return {"type": "sales", "items": []}


# ── GPT로 타입 추론 (Excel/CSV용) ─────────────────────────────────────────────

async def _infer_type(items: list[dict]) -> Literal["sales", "cost"]:
    """항목 목록만 보고 매출인지 비용인지 분류."""
    sample = items[:5]
    names = ", ".join(i.get("item_name", "") for i in sample)
    try:
        resp = await _openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": (
                    f"다음 항목들이 매출(판매) 기록인가요, 비용(구매/지출) 기록인가요?\n"
                    f"항목: {names}\n"
                    "반드시 'sales' 또는 'cost' 한 단어만 답하세요."
                ),
            }],
            temperature=0,
            max_tokens=5,
        )
        answer = (resp.choices[0].message.content or "").strip().lower()
        return "cost" if "cost" in answer else "sales"
    except Exception:
        return "sales"


# ── 메인 엔드포인트 ───────────────────────────────────────────────────────────

@router.post("/ocr")
async def parse_files(files: list[UploadFile]):
    """이미지/Excel/CSV → 매출 또는 비용 항목 파싱."""
    if not files:
        raise HTTPException(status_code=400, detail="파일이 없습니다.")

    today = _date.today().isoformat()
    all_items: list[dict] = []
    inferred_type: Literal["sales", "cost"] = "sales"
    has_image = False

    for upload in files:
        filename = upload.filename or "file"
        ext = _ext(filename)
        data = await upload.read()

        if ext in _IMAGE_EXTS:
            has_image = True
            result = await _ocr_image_to_items(data, filename)
            if result.get("type") == "cost":
                inferred_type = "cost"
            all_items.extend(result.get("items", []))

        elif ext in _EXCEL_EXTS:
            rows = _parse_excel(data)
            all_items.extend(rows)

        elif ext in _CSV_EXTS:
            rows = _parse_csv(data)
            all_items.extend(rows)

        else:
            raise HTTPException(
                status_code=422,
                detail=f"'{filename}' 는 지원하지 않는 형식입니다. 이미지·Excel·CSV만 가능합니다.",
            )

    if not all_items:
        return JSONResponse({
            "data": {"type": inferred_type, "date": today, "items": [], "parsed": 0},
            "error": "항목을 인식하지 못했어요. 더 선명한 이미지나 올바른 형식의 파일을 사용해주세요.",
            "meta": {},
        })

    # Excel/CSV는 이미지가 없으면 GPT로 타입 추론
    if not has_image and all_items:
        inferred_type = await _infer_type(all_items)

    # recorded_date 보정 — 파일에서 못 읽었으면 오늘 날짜
    for item in all_items:
        if not item.get("recorded_date"):
            item["recorded_date"] = today

    return {
        "data": {
            "type": inferred_type,
            "date": today,
            "items": all_items,
            "parsed": len(all_items),
        },
        "error": None,
        "meta": {},
    }
