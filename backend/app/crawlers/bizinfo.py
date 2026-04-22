"""
기업마당 공공 API 크롤러 (https://www.bizinfo.go.kr)

2026-04 확인 사항:
  - 인증 키 파라미터: `crtfcKey`
  - 응답 루트: `jsonArray`
  - 페이징 파라미터 무시됨 → `searchCnt` 하나로 전량 취득
  - 기간 필드: `reqstBeginEndDe` 단일 문자열
      "2026-04-06 ~ 2026-04-27"  |  "2020.01.01 ~ 2026.12.31"
      "예산 소진시까지" | "추후 공지" | "차수별 상이" 등
  - 마감된 공고는 API 가 드랍 → 현재 스냅샷만 확보 가능
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional
from urllib.parse import urlparse

import httpx

from app.core.config import settings

_BASE_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"
_NATIONAL_MARKERS = (
    "전국", "중소벤처기업부", "중기부", "소진공", "소상공인시장진흥공단",
    "창업진흥원", "기술보증", "신용보증", "중소기업", "TIPS",
)
_SEOUL_MARKERS = ("서울", "마포", "SBA", "서울창업", "서울경제진흥원")
_OTHER_REGION_KEYWORDS = (
    "부산", "대구", "인천", "광주", "대전", "울산", "경기", "강원",
    "충북", "충남", "전북", "전남", "경북", "경남", "제주", "세종",
    "경상북도", "경상남도", "전라북도", "전라남도", "충청북도", "충청남도",
    "강원도", "경기도", "제주특별자치도", "세종특별자치시",
    "부산광역시", "대구광역시", "인천광역시", "광주광역시",
    "대전광역시", "울산광역시",
    "수원", "안양", "성남", "용인", "고양", "화성", "부천", "남양주",
    "안산", "평택", "파주", "김포", "광명", "시흥", "하남", "의정부",
    "구리", "양주", "포천", "춘천", "원주", "강릉", "속초", "청주",
    "천안", "아산", "당진", "전주", "군산", "익산", "정읍", "목포",
    "여수", "순천", "나주", "포항", "경주", "안동", "구미", "영주",
    "김천", "상주", "창원", "김해", "진주", "거제", "통영", "양산",
)

_DATE_RE = re.compile(r"(\d{4})[-.](\d{1,2})[-.](\d{1,2})")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

_ATTACH_EXTS = (".hwp", ".pdf", ".docx", ".doc")
_RE_FILEDOWN = re.compile(r'href="(/cmm/fms/fileDown\.do\?[^"]+)"')
_RE_EXTSN = re.compile(r'data-extsn="([^"]+)"')
_RE_FILEBLANK = re.compile(r"fileBlank\('([^']+)'\s*\+\s*'/'\s*\+\s*'([^']+)'")

_CONTENT_TYPES = {
    "hwp": "application/x-hwp",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword",
}


async def fetch_snapshot(search_count: int = 2000) -> list[dict]:
    """기업마당 현재 활성 공고 전량 원본 조회."""
    params = {
        "crtfcKey": settings.bizinfo_api_key,
        "dataType": "json",
        "searchCnt": search_count,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(_BASE_URL, params=params)
        response.raise_for_status()
        data = response.json()
    return data.get("jsonArray", []) or []


async def fetch_all_programs() -> list[dict]:
    """기업마당 전체 공고 조회 + 파싱 (카테고리 필터 없음)."""
    raw = await fetch_snapshot()
    parsed = [_parse_program_detail(it) for it in raw]
    return [p for p in parsed if p.get("external_id")]


async def fetch_attachments(detail_url: str) -> list[dict]:
    """
    기업마당 공고 상세 페이지에서 첨부파일 목록을 수집한다.
    Returns: [{"filename": str, "file_type": str, "download_url": str}, ...]
    """
    if not detail_url:
        return []

    base = _base_origin(detail_url)
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(
                detail_url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; BOSS-crawler/1.0)"},
            )
            resp.raise_for_status()
            html = resp.text
    except Exception:
        return []

    download_hrefs = _RE_FILEDOWN.findall(html)
    ext_values = _RE_EXTSN.findall(html)
    fileblank_matches = _RE_FILEBLANK.findall(html)

    results: list[dict] = []
    seen: set[str] = set()

    for i, href in enumerate(download_hrefs):
        file_type = ext_values[i] if i < len(ext_values) else "unknown"
        if file_type not in ("hwp", "pdf", "docx"):
            continue

        download_url = base + href
        if download_url in seen:
            continue
        seen.add(download_url)

        if i < len(fileblank_matches):
            _, raw_fname = fileblank_matches[i]
            filename = raw_fname.strip()
        else:
            filename = f"신청서.{file_type}"

        results.append({
            "filename": filename,
            "file_type": file_type,
            "download_url": download_url,
        })

    return results


async def download_attachment(download_url: str) -> Optional[bytes]:
    """첨부파일을 바이트로 다운로드. 실패 시 None 반환."""
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(
                download_url,
                headers={"User-Agent": "Mozilla/5.0 (compatible; BOSS-crawler/1.0)"},
            )
            resp.raise_for_status()
            return resp.content
    except Exception:
        return None


def content_type_for(file_type: str) -> str:
    return _CONTENT_TYPES.get(file_type, "application/octet-stream")


def _base_origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _parse_program_detail(item: dict) -> dict:
    period_raw = (item.get("reqstBeginEndDe") or "").strip()
    start_dt, end_dt = _parse_period(period_raw)
    has_period = start_dt is not None and end_dt is not None
    is_ongoing = bool(period_raw) and not has_period
    title = (item.get("pblancNm") or "").strip()
    description = _strip_html(item.get("bsnsSumryCn") or "")

    return {
        "external_id": str(item.get("pblancId") or "").strip(),
        "title": title,
        "organization": (item.get("excInsttNm") or item.get("jrsdInsttNm") or "").strip() or None,
        "region": _infer_region(title, item),
        "program_kind": item.get("pldirSportRealmLclasCodeNm") or None,
        "sub_kind": item.get("pldirSportRealmMlsfcCodeNm") or None,
        "target": item.get("trgetNm") or None,
        "start_date": start_dt.isoformat() if start_dt else None,
        "end_date": end_dt.isoformat() if end_dt else None,
        "period_raw": period_raw or None,
        "is_ongoing": is_ongoing,
        "description": description or None,
        "detail_url": item.get("pblancUrl") or None,
        "external_url": item.get("rceptEngnHmpgUrl") or None,
        "hashtags": item.get("hashtags") or None,
        "raw": item,
    }


def _parse_period(raw: str) -> tuple[Optional[date], Optional[date]]:
    if not raw:
        return (None, None)
    matches = _DATE_RE.findall(raw)
    if len(matches) < 2:
        return (None, None)
    try:
        start = date(int(matches[0][0]), int(matches[0][1]), int(matches[0][2]))
        end = date(int(matches[1][0]), int(matches[1][1]), int(matches[1][2]))
        if end < start:
            return (None, None)
        return (start, end)
    except ValueError:
        return (None, None)


def _strip_html(html: str) -> str:
    if not html:
        return ""
    text = _HTML_TAG_RE.sub(" ", html)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
    )
    return _WS_RE.sub(" ", text).strip()


def _infer_region(title: str, item: dict) -> Optional[str]:
    blob = " ".join((title, item.get("jrsdInsttNm") or "", item.get("excInsttNm") or ""))
    if "마포" in blob:
        return "마포구"
    if any(m in blob for m in _SEOUL_MARKERS):
        return "서울"
    return "전국"
