"""공용 artifact 저장 헬퍼 — 4개 도메인 에이전트가 공유.

[ARTIFACT] 블록 스키마:
  type:         허용 타입 중 하나 (필수)
  title:        간결한 제목 (필수)
  start_date:   기간성 artifact 시작일 YYYY-MM-DD (선택)
  end_date:     기간성 artifact 종료일 YYYY-MM-DD (선택)
  due_date:     마감성 artifact 마감일 YYYY-MM-DD (start/end 와 택일, 선택)
  sub_domain:   도메인 카테고리 서브허브 title 정확 일치 (선택, 없으면 edge skip)
"""
import re
from datetime import date

from app.core.supabase import get_supabase

_ARTIFACT_BLOCK_RE = re.compile(r"\[ARTIFACT\](.*?)\[/ARTIFACT\]", re.DOTALL)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_block(reply: str) -> dict[str, str] | None:
    m = _ARTIFACT_BLOCK_RE.search(reply)
    if not m:
        return None
    out: dict[str, str] = {}
    for line in m.group(1).strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out or None


def _clean_content(reply: str) -> str:
    return _ARTIFACT_BLOCK_RE.sub("", reply).strip()


def _valid_date(raw: str) -> str | None:
    s = (raw or "").strip()
    if not _DATE_RE.match(s):
        return None
    try:
        date.fromisoformat(s)
        return s
    except ValueError:
        return None


def today_context() -> str:
    return f"[오늘 날짜] {date.today().isoformat()}"


def list_sub_hub_titles(account_id: str, domain: str) -> list[str]:
    sb = get_supabase()
    rows = (
        sb.table("artifacts")
        .select("title,domains")
        .eq("account_id", account_id)
        .eq("kind", "domain")
        .eq("type", "category")
        .execute()
        .data
        or []
    )
    out: list[str] = []
    for r in rows:
        if domain in (r.get("domains") or []):
            t = (r.get("title") or "").strip()
            if t:
                out.append(t)
    return out


def _find_sub_hub_id(sb, account_id: str, domain: str, title: str) -> str | None:
    needle = title.strip().casefold()
    if not needle:
        return None
    rows = (
        sb.table("artifacts")
        .select("id,title,domains")
        .eq("account_id", account_id)
        .eq("kind", "domain")
        .eq("type", "category")
        .execute()
        .data
        or []
    )
    for r in rows:
        if domain not in (r.get("domains") or []):
            continue
        if (r.get("title") or "").strip().casefold() == needle:
            return r["id"]
    return None


async def save_artifact_from_reply(
    account_id: str,
    domain: str,
    reply: str,
    *,
    default_title: str,
    valid_types: tuple[str, ...],
) -> str | None:
    if "[ARTIFACT]" not in reply:
        return None
    try:
        parsed = _parse_block(reply)
        if not parsed:
            return None

        artifact_type = parsed.get("type", "").strip()
        if artifact_type not in valid_types:
            artifact_type = valid_types[0] if valid_types else "note"

        title = (parsed.get("title") or "").strip() or default_title
        content = _clean_content(reply)

        metadata: dict = {}
        for k in ("start_date", "end_date", "due_date"):
            v = _valid_date(parsed.get(k, ""))
            if v:
                metadata[k] = v

        sb = get_supabase()
        payload: dict = {
            "account_id": account_id,
            "domains": [domain],
            "kind": "artifact",
            "type": artifact_type,
            "title": title,
            "content": content,
            "status": "draft",
        }
        if metadata:
            payload["metadata"] = metadata

        result = sb.table("artifacts").insert(payload).execute()
        if not result.data:
            return None
        artifact_id = result.data[0]["id"]

        sub_domain_name = (parsed.get("sub_domain") or "").strip()
        if sub_domain_name:
            hub_id = _find_sub_hub_id(sb, account_id, domain, sub_domain_name)
            if hub_id:
                try:
                    sb.table("artifact_edges").insert(
                        {
                            "parent_id": hub_id,
                            "child_id": artifact_id,
                            "relation": "contains",
                        }
                    ).execute()
                except Exception:
                    pass

        try:
            sb.table("activity_logs").insert(
                {
                    "account_id": account_id,
                    "type": "artifact_created",
                    "domain": domain,
                    "title": title,
                    "description": f"{artifact_type} 생성됨",
                    "metadata": {"artifact_id": artifact_id},
                }
            ).execute()
        except Exception:
            pass

        try:
            from app.rag.embedder import index_artifact

            await index_artifact(account_id, domain, artifact_id, f"{title}\n{content}")
        except Exception:
            pass

        return artifact_id
    except Exception:
        return None
