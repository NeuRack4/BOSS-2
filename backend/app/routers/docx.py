from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from app.agents._docx_builder import build_docx

router = APIRouter(prefix="/api/docx", tags=["docx"])

_FILENAMES = {
    "business_registration": "사업자등록_신청서.docx",
    "mail_order_registration": "통신판매업_신고서.docx",
    "purchase_safety_exempt": "구매안전서비스_비적용대상_확인서.docx",
}


class AdminDocxRequest(BaseModel):
    account_id: str
    doc_type: str = "business_registration"
    fields: dict[str, str]


@router.post("/business-registration")
async def generate_admin_docx(body: AdminDocxRequest):
    docx_bytes = build_docx(body.fields, doc_type=body.doc_type)
    filename = _FILENAMES.get(body.doc_type, "신청서.docx")
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": (
                "attachment; filename*=UTF-8''" + quote(filename, safe="")
            ),
            "Content-Length": str(len(docx_bytes)),
        },
    )
