"""업로드된 서류의 텍스트 추출기.

지원 포맷:
  - PDF  (PyMuPDF 텍스트 기반)
  - DOCX (python-docx)
  - 이미지(JPG/PNG/WEBP/BMP/TIFF/GIF) — OpenAI gpt-4o vision OCR (v1.1.3~)

최상위 진입점 `parse_file` 은 async (이미지 OCR 이 async 이기 때문).
분석·저장 로직과 분리된 순수 변환 함수만 노출.
"""

from __future__ import annotations

import io

from fastapi import HTTPException

SUPPORTED_EXTS: tuple[str, ...] = ("pdf", "docx", "doc")
IMAGE_EXTS: tuple[str, ...] = ("jpg", "jpeg", "png", "webp", "bmp", "tiff", "gif")


def _ext_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def parse_pdf(file_bytes: bytes) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="PDF 파싱 모듈(pymupdf) 이 설치되지 않았습니다.",
        )

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        text = "\n".join(page.get_text() for page in doc).strip()
    finally:
        doc.close()

    if len(text) < 50:
        # 스캔 PDF 로 추정 — 페이지별 이미지 렌더 후 OCR 로 폴백은 v1.1.4 스코프
        raise HTTPException(
            status_code=422,
            detail="PDF 에서 텍스트를 추출하지 못했습니다. 스캔 PDF 는 이미지 형태(JPG/PNG) 로 올려주시면 OCR 로 처리됩니다.",
        )
    return text


def parse_docx(file_bytes: bytes) -> str:
    try:
        from docx import Document
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="DOCX 파싱 모듈(python-docx) 이 설치되지 않았습니다.",
        )
    doc = Document(io.BytesIO(file_bytes))
    text = "\n".join(p.text for p in doc.paragraphs).strip()
    if not text:
        raise HTTPException(status_code=422, detail="DOCX 에서 텍스트를 추출하지 못했습니다.")
    return text


async def parse_file(file_bytes: bytes, filename: str) -> str:
    ext = _ext_of(filename)
    if ext == "pdf":
        return parse_pdf(file_bytes)
    if ext in ("docx", "doc"):
        return parse_docx(file_bytes)
    if ext in IMAGE_EXTS:
        from app.core.ocr import extract_text_from_image
        return await extract_text_from_image(file_bytes, filename)
    raise HTTPException(
        status_code=415,
        detail=f"지원하지 않는 파일 형식: .{ext}. PDF·DOCX·이미지(JPG/PNG/WEBP/BMP/TIFF/GIF) 만 업로드할 수 있어요.",
    )
