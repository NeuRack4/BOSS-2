"""파일 업로드 엔드포인트.

POST /api/uploads/document
  multipart/form-data:
    file: PDF|DOCX (이미지는 v1.1.3 OCR 추가 예정)
    account_id: str
    original_name: str (선택, 없으면 파일명)

동작:
  1. 파일 bytes 수신 → 크기 검증 (< 20MB).
  2. Supabase Storage 버킷 `documents-uploads` 에 `{account_id}/{uuid}-{name}` 로 업로드.
  3. doc_parser.parse_file 로 텍스트 추출.
  4. artifacts 에 `kind='artifact'`, `type='uploaded_doc'` 행 삽입:
       - domains: ['documents']
       - title: 원본 파일명 (확장자 제외)
       - content: 추출 텍스트 (DB 에 전량 저장)
       - metadata: {storage_path, mime_type, size_bytes, original_name, parsed_len}
  5. activity_logs 에 artifact_created 기록 + embedding 인덱싱.
  6. { data: { artifact_id, title, size_bytes, parsed_len, preview }, meta: {} }.

storage_path 는 bucket 내부 경로 (bucket prefix 제외).
사후 분석(_doc_review) 은 `POST /api/reviews` 별도 호출.
"""

from __future__ import annotations

import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.agents._artifact import pick_documents_parent
from app.core.doc_parser import parse_file
from app.core.supabase import get_supabase
from app.models.schemas import UploadDocumentResponse

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

_BUCKET = "documents-uploads"
_MAX_BYTES = 20 * 1024 * 1024  # 20MB


def _mime_for(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "pdf":  "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc":  "application/msword",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
        "png":  "image/png",
        "webp": "image/webp",
        "bmp":  "image/bmp",
        "tiff": "image/tiff",
        "gif":  "image/gif",
    }.get(ext, "application/octet-stream")


def _safe_name(name: str) -> str:
    # 경로 구분자만 제거. 한글은 DB 메타데이터에 원본 그대로 보관.
    return os.path.basename(name or "document")[:180]


def _storage_key_for(account_id: str, filename: str) -> str:
    """Supabase Storage 키는 ASCII 만 허용되므로 UUID + 확장자로만 구성.

    원본 파일명은 metadata.original_name 에 별도 보관.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    # 확장자도 ASCII + 안전 문자로 제한
    ext = "".join(ch for ch in ext if ch.isalnum())[:10] or "bin"
    return f"{account_id}/{uuid.uuid4().hex}.{ext}"


def _title_of(filename: str) -> str:
    base = os.path.basename(filename or "")
    stem = base.rsplit(".", 1)[0] if "." in base else base
    return stem[:180] or "업로드 문서"


@router.post("/document", response_model=UploadDocumentResponse)
async def upload_document(
    account_id: str = Form(...),
    file: UploadFile = File(...),
    original_name: Optional[str] = Form(None),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"파일 크기가 {_MAX_BYTES // 1024 // 1024}MB 를 초과합니다.")

    disp_name = _safe_name(original_name or file.filename or "document")
    content_text = await parse_file(raw, disp_name)  # 실패 시 HTTPException

    # Storage 업로드 — 키는 ASCII 만 허용되므로 UUID + 확장자로만 구성
    storage_path = _storage_key_for(account_id, disp_name)
    sb = get_supabase()
    try:
        sb.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=raw,
            file_options={"content-type": _mime_for(disp_name), "upsert": "false"},
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Storage 업로드 실패: {str(exc)[:200]}")

    title = _title_of(disp_name)
    metadata = {
        "storage_path":  storage_path,
        "bucket":        _BUCKET,
        "mime_type":     _mime_for(disp_name),
        "size_bytes":    len(raw),
        "original_name": disp_name,
        "parsed_len":    len(content_text),
    }

    payload = {
        "account_id": account_id,
        "domains":    ["documents"],
        "kind":       "artifact",
        "type":       "uploaded_doc",
        "title":      title,
        "content":    content_text,
        "status":     "active",
        "metadata":   metadata,
    }
    try:
        result = sb.table("artifacts").insert(payload).execute()
    except Exception as exc:
        # 업로드된 파일 롤백
        try:
            sb.storage.from_(_BUCKET).remove([storage_path])
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"artifact 저장 실패: {str(exc)[:200]}")

    if not result.data:
        raise HTTPException(status_code=500, detail="artifact 저장 결과가 비었습니다.")
    artifact_id = result.data[0]["id"]

    # documents 서브허브(없으면 메인 허브)로 contains 연결 — 캔버스에서 parents 가 보이도록
    hub_id = pick_documents_parent(
        sb,
        account_id,
        prefer_keywords=("업로드", "계약", "contract", "upload"),
    )
    if hub_id:
        try:
            sb.table("artifact_edges").insert({
                "account_id": account_id,
                "parent_id":  hub_id,
                "child_id":   artifact_id,
                "relation":   "contains",
            }).execute()
        except Exception:
            pass

    # activity_logs + embedding (best-effort)
    try:
        sb.table("activity_logs").insert({
            "account_id":  account_id,
            "type":        "artifact_created",
            "domain":      "documents",
            "title":       title,
            "description": f"문서 업로드: {disp_name} ({len(raw)//1024} KB)",
            "metadata":    {"artifact_id": artifact_id, **metadata},
        }).execute()
    except Exception:
        pass

    try:
        from app.rag.embedder import index_artifact
        await index_artifact(account_id, "documents", artifact_id, f"{title}\n{content_text[:4000]}")
    except Exception:
        pass

    preview = content_text[:500]
    return UploadDocumentResponse(
        data={
            "artifact_id": artifact_id,
            "title":       title,
            "size_bytes":  len(raw),
            "parsed_len":  len(content_text),
            "preview":     preview,
            "storage_path": storage_path,
        }
    )
