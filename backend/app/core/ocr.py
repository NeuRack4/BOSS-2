"""이미지·스캔 문서 OCR.

OpenAI gpt-4o vision (Responses 이전 Chat Completions 호환 방식) 로 구현.
한국어 텍스트가 많은 서류 특성상 EasyOCR/Tesseract 보다 품질 우위.

공개 API:
  extract_text_from_image(file_bytes: bytes, filename: str) -> str

디자인 주의:
  - 서버에서 base64 로 한 번에 보낼 수 있는 크기 제한 (20MB 라우터 한도) 내에서만 호출.
  - 민감 이미지는 가능한 한 원본 그대로 전달 (별도 전처리·압축 없이).
  - 429/500 류 네트워크 오류는 HTTPException 503 으로 일원화.
"""

from __future__ import annotations

import base64
import logging

from fastapi import HTTPException

from app.core.llm import client as _openai_client

log = logging.getLogger(__name__)

_OCR_MODEL = "gpt-4o"   # vision 지원. mini 는 정확도 떨어짐.

_MIME_BY_EXT: dict[str, str] = {
    "jpg":  "image/jpeg",
    "jpeg": "image/jpeg",
    "png":  "image/png",
    "webp": "image/webp",
    "bmp":  "image/bmp",
    "tiff": "image/tiff",
    "gif":  "image/gif",
}

_PROMPT = (
    "이미지에 보이는 **모든 텍스트**를 위에서 아래·왼쪽에서 오른쪽 순으로 정확히 추출해주세요.\n\n"
    "규칙:\n"
    "- 원문 그대로 (번역·요약·재서술 금지).\n"
    "- 표는 각 행을 별도 줄로, 셀 구분은 ' | ' 사용.\n"
    "- 문단 사이는 빈 줄 1개.\n"
    "- 도장·서명은 <서명>, <인> 같이 꺾쇠 태그로 표시.\n"
    "- 읽을 수 없는 글자는 생략하고 계속 진행.\n"
    "- 추출된 텍스트만 출력하고 설명·메타 주석을 붙이지 마세요."
)


def _detect_mime(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return _MIME_BY_EXT.get(ext, "image/jpeg")


async def extract_text_from_image(file_bytes: bytes, filename: str) -> str:
    if not file_bytes:
        raise HTTPException(status_code=400, detail="빈 이미지입니다.")

    mime = _detect_mime(filename)
    b64 = base64.standard_b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    try:
        resp = await _openai_client.chat.completions.create(
            model=_OCR_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": _PROMPT},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            temperature=0,
            max_tokens=4000,
        )
    except Exception as exc:
        log.exception("ocr vision call failed")
        raise HTTPException(status_code=503, detail=f"OCR 호출 실패: {str(exc)[:200]}")

    text = (resp.choices[0].message.content or "").strip()
    if not text or len(text) < 10:
        raise HTTPException(
            status_code=422,
            detail="이미지에서 텍스트를 충분히 추출하지 못했습니다. 더 선명한 이미지로 시도해주세요.",
        )
    return text
