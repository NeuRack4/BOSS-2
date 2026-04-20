"""파일 업로드 엔드포인트.

POST /api/uploads/document
  multipart/form-data:
    files:          UploadFile (1개 이상, 반복 허용)      # ← v1.2 멀티 업로드
    account_id:     str
    original_name:  str (deprecated — files 멀티 업로드에선 무시)
    user_declared_type: str = "auto"
        one of: auto | contract | proposal | estimate | notice | checklist | guide |
                receipt | invoice | tax | id | other

동작 (파일별):
  1. 크기 검증 (< 20MB) · 텍스트 추출 (`doc_parser.parse_file`)
  2. Supabase Storage 업로드 → `uploaded_doc` artifact 저장
  3. 자동 분류 (`_doc_classify.classify_document`) + 유저 선언 비교
     - 충돌 감지 시 `metadata.needs_confirmation = true` + `suggested_category` 기록
  4. documents 서브허브에 contains 엣지 연결
  5. activity_logs + embedding (best-effort)

응답:
  { data: { items: [...], summary: {...} }, meta: {} }
  items[i] = {artifact_id, title, size_bytes, parsed_len, preview, storage_path, classification, needs_confirmation}

PATCH /api/uploads/document/{artifact_id}/classification
  body: {category, doc_type}
  → metadata.classification 갱신 + needs_confirmation 해제.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.agents._artifact import pick_documents_parent
from app.agents._doc_classify import (
    CATEGORY_LABELS,
    Category,
    classify_document,
    detect_conflict,
    resolve_user_declared_type,
)
from app.core.doc_parser import parse_file
from app.core.supabase import get_supabase
from app.models.schemas import UploadDocumentResponse

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

_BUCKET = "documents-uploads"
_MAX_BYTES = 20 * 1024 * 1024  # 20MB

# artifact 노드까지 만들 카테고리 — 담당 에이전트가 준비된 것만.
# 그 외 (receipt/invoice/tax/id/other) 는 Storage 에만 저장하고 노드는 생성하지 않는다.
# 담당 에이전트(sales 등)가 준비되면 그때 확장한다.
_NODE_CATEGORIES: set[str] = {"documents"}


def _mime_for(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "pdf":  "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc":  "application/msword",
        "txt":  "text/plain",
        "rtf":  "application/rtf",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "csv":  "text/csv",
        "jpg":  "image/jpeg",
        "jpeg": "image/jpeg",
        "png":  "image/png",
        "webp": "image/webp",
        "bmp":  "image/bmp",
        "tiff": "image/tiff",
        "gif":  "image/gif",
        "heic": "image/heic",
        "heif": "image/heif",
    }.get(ext, "application/octet-stream")


def _safe_name(name: str) -> str:
    return os.path.basename(name or "document")[:180]


def _storage_key_for(account_id: str, filename: str) -> str:
    """Storage 키는 ASCII 만. UUID + 확장자만 사용, 원본은 metadata 에 보관."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    ext = "".join(ch for ch in ext if ch.isalnum())[:10] or "bin"
    return f"{account_id}/{uuid.uuid4().hex}.{ext}"


def _title_of(filename: str) -> str:
    base = os.path.basename(filename or "")
    stem = base.rsplit(".", 1)[0] if "." in base else base
    return stem[:180] or "업로드 문서"


async def _process_single(
    account_id: str,
    file: UploadFile,
    user_declared_type: str,
) -> dict:
    """파일 1개 업로드 파이프라인. 실패 시 HTTPException 을 호출자로 propagate.

    반환: items[i] 에 들어갈 dict.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"파일 크기가 {_MAX_BYTES // 1024 // 1024}MB 를 초과합니다.")

    disp_name = _safe_name(file.filename or "document")
    content_text = await parse_file(raw, disp_name)

    # 자동 분류 + 유저 선언 비교
    auto = await classify_document(content_text, disp_name)
    declared = resolve_user_declared_type(user_declared_type)
    conflict = detect_conflict(auto, declared)
    # final_category 는 유저 선언이 있으면 유저 값 우선 (충돌 여부는 플래그로 따로)
    if declared is not None:
        final_category: Category = declared[0]
        final_doc_type: str = declared[1]
    else:
        final_category = auto.category
        final_doc_type = auto.doc_type

    # Storage 업로드
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
    classification_meta = {
        "category":        final_category,
        "doc_type":        final_doc_type,
        "user_declared":   user_declared_type or "auto",
        "auto":            auto.to_dict(),
    }
    metadata = {
        "storage_path":        storage_path,
        "bucket":              _BUCKET,
        "mime_type":           _mime_for(disp_name),
        "size_bytes":          len(raw),
        "original_name":       disp_name,
        "parsed_len":          len(content_text),
        "classification":      classification_meta,
        "needs_confirmation":  conflict,
    }
    if conflict:
        metadata["suggested_category"] = auto.category
        metadata["suggested_doc_type"] = auto.doc_type

    # 노드를 만들지 않는 카테고리 — Storage 에는 남기고 여기서 리턴.
    # (conflict 인 경우는 사용자가 CHOICES 로 재분류할 수 있으므로 노드를 만든다.)
    if not conflict and final_category not in _NODE_CATEGORIES:
        log.info(
            "upload skip-node: account=%s category=%s filename=%s",
            account_id, final_category, disp_name,
        )
        return {
            "artifact_id":        None,
            "title":              title,
            "size_bytes":         len(raw),
            "parsed_len":         len(content_text),
            "preview":            content_text[:500],
            "storage_path":       storage_path,
            "classification":     classification_meta,
            "needs_confirmation": False,
            "final_category":     final_category,
            "node_created":       False,
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
        try:
            sb.storage.from_(_BUCKET).remove([storage_path])
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"artifact 저장 실패: {str(exc)[:200]}")

    if not result.data:
        raise HTTPException(status_code=500, detail="artifact 저장 결과가 비었습니다.")
    artifact_id = result.data[0]["id"]

    # documents 서브허브 연결 (best-effort)
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

    # activity_logs
    try:
        sb.table("activity_logs").insert({
            "account_id":  account_id,
            "type":        "artifact_created",
            "domain":      "documents",
            "title":       title,
            "description": f"문서 업로드: {disp_name} ({len(raw)//1024} KB, {CATEGORY_LABELS.get(final_category, final_category)})",
            "metadata":    {"artifact_id": artifact_id, **metadata},
        }).execute()
    except Exception:
        pass

    # 임베딩
    try:
        from app.rag.embedder import index_artifact
        await index_artifact(account_id, "documents", artifact_id, f"{title}\n{content_text[:4000]}")
    except Exception:
        pass

    return {
        "artifact_id":        artifact_id,
        "title":              title,
        "size_bytes":         len(raw),
        "parsed_len":         len(content_text),
        "preview":            content_text[:500],
        "storage_path":       storage_path,
        "classification":     classification_meta,
        "needs_confirmation": conflict,
        "final_category":     final_category,
    }


@router.post("/document", response_model=UploadDocumentResponse)
async def upload_document(
    account_id: str = Form(...),
    files: List[UploadFile] = File(...),
    user_declared_type: str = Form("auto"),
    # 하위 호환: 기존 단일 파일 + original_name 파라미터 (무시해도 동작).
    original_name: Optional[str] = Form(None),  # noqa: ARG001
):
    if not files:
        raise HTTPException(status_code=400, detail="업로드된 파일이 없습니다.")

    items: list[dict] = []
    errors: list[dict] = []
    for f in files:
        try:
            item = await _process_single(account_id, f, user_declared_type)
            items.append(item)
        except HTTPException as e:
            errors.append({"filename": f.filename, "status_code": e.status_code, "detail": e.detail})
            log.warning("upload item failed: %s — %s", f.filename, e.detail)
        except Exception as e:
            errors.append({"filename": f.filename, "status_code": 500, "detail": str(e)[:200]})
            log.exception("upload item crashed")

    if not items:
        # 하나도 성공 못 함 → 첫 에러를 HTTPException 으로 돌려줌
        first = errors[0] if errors else {"status_code": 500, "detail": "업로드 실패"}
        raise HTTPException(status_code=first.get("status_code", 500), detail=first.get("detail", "업로드 실패"))

    # 프론트 단일 파일 호환: 첫 아이템의 필드를 data 루트에도 복제 (legacy clients).
    # 노드가 만들어진 아이템을 우선 선택 (skip-node 건만 있으면 그걸 그대로 사용).
    first = next((it for it in items if it.get("artifact_id")), items[0])
    data: dict = {
        "items":              items,
        "summary":            {
            "total":               len(items) + len(errors),
            "succeeded":           len(items),
            "failed":              len(errors),
            "needs_confirmation":  sum(1 for it in items if it.get("needs_confirmation")),
            "nodes_created":       sum(1 for it in items if it.get("artifact_id")),
        },
        "errors":             errors,
        # ↓ legacy (단일 업로드) 호환 필드
        "artifact_id":        first.get("artifact_id"),
        "title":              first.get("title"),
        "size_bytes":         first.get("size_bytes"),
        "parsed_len":         first.get("parsed_len"),
        "preview":            first.get("preview"),
        "storage_path":       first.get("storage_path"),
        "classification":     first.get("classification"),
        "needs_confirmation": first.get("needs_confirmation", False),
        "final_category":     first.get("final_category"),
    }
    return UploadDocumentResponse(data=data)


class ClassificationPatch(BaseModel):
    category: Category
    doc_type: str | None = None


@router.patch("/document/{artifact_id}/classification", response_model=UploadDocumentResponse)
async def patch_classification(artifact_id: str, body: ClassificationPatch, account_id: str):
    """유저가 충돌을 해소하거나 분류를 재지정할 때 호출.

    `metadata.classification.category` 를 갱신하고 `needs_confirmation` 을 해제한다.
    """
    sb = get_supabase()
    rows = (
        sb.table("artifacts")
        .select("id,metadata,account_id")
        .eq("id", artifact_id)
        .eq("account_id", account_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(status_code=404, detail="artifact 를 찾을 수 없습니다.")
    meta = rows[0].get("metadata") or {}
    classification = meta.get("classification") or {}
    classification["category"] = body.category
    classification["doc_type"] = body.doc_type or classification.get("doc_type") or CATEGORY_LABELS.get(body.category, body.category)
    classification["user_declared"] = body.category  # 유저 최종 확정이라는 의미
    meta["classification"] = classification
    meta["needs_confirmation"] = False
    meta.pop("suggested_category", None)
    meta.pop("suggested_doc_type", None)

    try:
        sb.table("artifacts").update({"metadata": meta}).eq("id", artifact_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"classification 갱신 실패: {str(exc)[:200]}")

    return UploadDocumentResponse(data={
        "artifact_id":        artifact_id,
        "classification":     classification,
        "needs_confirmation": False,
        "final_category":     body.category,
    })
