"""서류 공정성 분석 엔드포인트.

POST /api/reviews
  body: ReviewRequest { account_id, doc_artifact_id, user_role, contract_subtype, doc_type }

분석 실행 + 저장 + 엣지 연결 로직은 전부 `_doc_review.dispatch_review` 로 위임.
이 라우터는 입력 검증 + 예외 → HTTP 매핑만 담당.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.agents._doc_review import InvalidDocumentError, dispatch_review
from app.models.schemas import ReviewRequest, ReviewResponse

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reviews", tags=["reviews"])

_VALID_ROLES = ("갑", "을", "미지정")
_VALID_DOC_TYPES = ("계약서", "제안서", "기타")


@router.post("", response_model=ReviewResponse)
async def create_review(req: ReviewRequest):
    user_role = req.user_role if req.user_role in _VALID_ROLES else "미지정"
    doc_type = req.doc_type if req.doc_type in _VALID_DOC_TYPES else "계약서"

    try:
        result = await dispatch_review(
            account_id=req.account_id,
            doc_artifact_id=req.doc_artifact_id,
            user_role=user_role,              # type: ignore[arg-type]
            doc_type=doc_type,                # type: ignore[arg-type]
            contract_subtype=req.contract_subtype,
        )
    except InvalidDocumentError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.exception("review failed")
        raise HTTPException(status_code=500, detail=f"분석 중 오류: {str(e)[:200]}")

    return ReviewResponse(data=result)
