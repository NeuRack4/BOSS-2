# OCR 면접 준비 — BOSS-2 기준

## 1. OCR이란?

**OCR (Optical Character Recognition)** — 이미지에서 텍스트를 추출하는 기술.

전통적 방식 (Tesseract, EasyOCR): 픽셀 패턴 인식 → 문자 매핑.  
BOSS-2 방식: **GPT-4o Vision** — 이미지를 base64로 인코딩해 LLM에 직접 전달. 한국어 품질이 압도적으로 높음.

---

## 2. BOSS-2 OCR 파이프라인

### 이미지 처리 흐름
```
사용자 이미지 업로드 (JPG/PNG/WEBP 등)
  → 프론트: FormData로 POST /api/sales/ocr
  → 백엔드: bytes → base64 → data URL
  → GPT-4o Vision API 호출 (response_format: json_object)
  → JSON 파싱 → items 배열 반환
  → 프론트: SalesInputTable 또는 CostInputTable 자동 채우기
```

### Excel/CSV 처리 흐름
```
파일 업로드
  → openpyxl (Excel) / csv 모듈 (CSV) 로 파싱
  → 헤더 자동 감지 (_detect_header)
  → 컬럼 매핑 (품목/수량/단가/금액/분류 등 한/영 혼용 지원)
  → items 배열 반환
```

---

## 3. 핵심 구현 포인트

### base64 인코딩
```python
import base64
b64 = base64.standard_b64encode(file_bytes).decode("ascii")
data_url = f"data:{mime};base64,{b64}"
```
- OpenAI Vision API는 URL 또는 data URL 둘 다 받음
- 서버에서 직접 보낼 때는 data URL 사용

### response_format: json_object
```python
response_format={"type": "json_object"}
```
- GPT가 반드시 JSON 객체를 반환하도록 강제
- 배열을 원하면 `{"items": [...]}` 형태로 프롬프트 작성해야 함 (raw 배열 반환 불가)

### 헤더 자동 감지
```python
# 첫 10행 중 컬럼 매핑 점수가 가장 높은 행을 헤더로 선택
best_score = max(len(col_map) for each row)
```
- 실제 데이터 파일은 헤더가 1~3행에 있는 경우가 많음
- 한국어 컬럼명(품목, 수량, 단가)과 영어(item, qty, price) 모두 지원

### 여러 파일 병합
```python
for upload in files:
    if ext in _IMAGE_EXTS:
        result = await _ocr_image_to_items(data, filename)
        all_items.extend(result.get("items", []))
```
- 여러 장의 영수증 → 각각 OCR 후 items 배열 병합
- 매출/비용 타입은 첫 번째 이미지 기준으로 결정

---

## 4. 매출 vs 비용 자동 분류

### 이미지의 경우
- GPT-4o Vision 프롬프트에 `"type": "sales 또는 cost"` 요청
- 판매 내역 → `sales`, 구매/지출 영수증 → `cost`

### Excel/CSV의 경우
- 파일만으로 판단 어려움 → **별도 GPT-4o-mini 호출**로 타입 추론
```python
async def _infer_type(items: list[dict]) -> Literal["sales", "cost"]:
    # 항목명 샘플 5개 보여주고 sales/cost 한 단어로 응답 요청
```

---

## 5. 인코딩 이슈 (CSV)

한국 파일은 EUC-KR / CP949로 저장된 경우 많음.
```python
for enc in ("utf-8-sig", "utf-8", "euc-kr", "cp949"):
    try:
        text = data.decode(enc)
        break
    except Exception:
        continue
```
- `utf-8-sig`: BOM 포함 UTF-8 (Excel에서 내보낸 CSV)
- `euc-kr` / `cp949`: 구형 한국어 인코딩

---

## 6. 면접 예상 질문

**Q. 왜 Tesseract/EasyOCR 대신 GPT-4o Vision을 썼나요?**  
A. 한국어 손글씨, 영수증 폰트, 표 구조 인식에서 전통 OCR보다 정확도가 훨씬 높습니다. 별도 모델 설치·유지가 필요 없고, 텍스트 추출과 항목 파싱을 한 번의 API 호출로 처리할 수 있어 파이프라인이 단순해집니다.

**Q. response_format: json_object를 쓸 때 주의할 점은?**  
A. GPT는 반드시 JSON 객체(dict)를 반환합니다. 배열을 원할 경우 프롬프트에서 `{"items": [...]}` 형태를 명시해야 합니다. raw 배열을 요청하면 GPT가 임의 키로 감싸서 반환할 수 있어 키 추출 로직이 깨질 수 있습니다.

**Q. 여러 장의 영수증을 동시에 처리할 때 성능 이슈는?**  
A. 현재는 순차 처리(`for upload in files`)입니다. 파일 수가 많으면 `asyncio.gather`로 병렬 처리하면 됩니다. 다만 OpenAI API rate limit을 고려해야 합니다.

**Q. Excel 컬럼 매핑 실패하면 어떻게 되나요?**  
A. `_detect_header`가 매핑 점수 1점 미만이면 `None` 반환 → 빈 items 배열 반환 → 프론트에서 "인식 실패" 안내 + 빈 표 오픈으로 사용자가 직접 입력 가능합니다.

**Q. 보안 측면에서 이미지 OCR 시 주의할 점은?**  
A. 이미지가 OpenAI 서버로 전송됩니다. 민감한 개인정보(주민번호, 카드번호 등)가 포함된 이미지는 주의가 필요합니다. 현재는 소상공인 영수증 용도라 실사용 위험도는 낮지만, 약관 안내 또는 민감정보 마스킹 전처리를 추가할 수 있습니다.

---

## 7. 관련 파일

| 파일 | 역할 |
|------|------|
| `backend/app/routers/sales_ocr.py` | OCR 엔드포인트 + Excel/CSV 파서 |
| `backend/app/core/ocr.py` | 문서용 기본 Vision OCR (텍스트 추출) |
| `frontend/components/chat/ChatOverlay.tsx` | `analyzeSalesFiles()` — 파일 감지 + API 호출 + 표 오픈 |
| `frontend/components/chat/SalesInputTable.tsx` | 매출 표 모달 |
| `frontend/components/chat/CostInputTable.tsx` | 비용 표 모달 |
