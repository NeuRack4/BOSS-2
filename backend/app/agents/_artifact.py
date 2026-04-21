"""공용 artifact 저장 헬퍼 — 4개 도메인 에이전트가 공유.

[ARTIFACT] 블록 스키마:
  type:              허용 타입 중 하나 (필수)
  title:             간결한 제목 (필수)
  start_date:        기간성 artifact 시작일 YYYY-MM-DD (선택)
  end_date:          기간성 artifact 종료일 YYYY-MM-DD (선택)
  due_date:          마감성 artifact 마감일 YYYY-MM-DD (start/end 와 택일, 선택)
  due_label:         마감의 종류 라벨 — '계약 만료', '납품기한', '공지 게시일' 등 (선택)
  sub_domain:        도메인 카테고리 서브허브 title 정확 일치 (선택, 없으면 edge skip)

도메인별 확장 키는 에이전트가 `extra_meta_keys` 로 주입 (예: documents 의 contract_subtype).
"""
import contextvars
import re
from datetime import date

from app.core.supabase import get_supabase

# 요청 단위(async task)로 가장 먼저 저장된 artifact_id를 추적.
# 채팅 응답 후 캔버스 포커스 이동에 사용.
_focus_artifact_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_focus_artifact_id", default=None
)


def record_artifact_for_focus(artifact_id: str) -> None:
    """저장된 artifact_id를 포커스 대상으로 등록. 첫 번째 저장만 기록(부모 우선)."""
    if _focus_artifact_id.get() is None:
        _focus_artifact_id.set(artifact_id)


def get_focus_artifact_id() -> str | None:
    return _focus_artifact_id.get()


def clear_focus_artifact_id() -> None:
    _focus_artifact_id.set(None)

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


def pick_sub_hub_id(
    sb,
    account_id: str,
    domain: str,
    *,
    prefer_keywords: tuple[str, ...] = (),
) -> str | None:
    """해당 domain 의 서브허브 중 가장 적합한 것의 id 를 반환.

    prefer_keywords 가 주어지면 title 에 keyword 가 포함된 첫 서브허브를 우선.
    매치 없으면 첫 서브허브. 서브허브가 하나도 없으면 자동 복구 (ensure_standard_sub_hubs)
    후 재조회. 그래도 없으면 None.
    """
    def _query() -> list[dict]:
        return (
            sb.table("artifacts")
            .select("id,title,domains")
            .eq("account_id", account_id)
            .eq("kind", "domain")
            .eq("type", "category")
            .execute()
            .data
            or []
        )

    rows = _query()
    candidates = [r for r in rows if domain in (r.get("domains") or [])]
    if not candidates:
        # 자가 복구 — 014 마이그레이션 이전 가입자 등 서브허브가 누락된 계정 대비.
        try:
            sb.rpc("ensure_standard_sub_hubs", {"account_id": account_id}).execute()
        except Exception:
            pass
        rows = _query()
        candidates = [r for r in rows if domain in (r.get("domains") or [])]
        if not candidates:
            return None
    if prefer_keywords:
        low = [(c, (c.get("title") or "").casefold()) for c in candidates]
        for kw in prefer_keywords:
            kw_low = kw.casefold()
            for c, t in low:
                if kw_low in t:
                    return c["id"]
    return candidates[0]["id"]


def pick_main_hub_id(sb, account_id: str, domain: str) -> str | None:
    """도메인 메인 허브(type 비어있거나 'main') id.

    bootstrap_workspace 이 서브허브까진 만들지 않는 계정 대비용 폴백.
    """
    rows = (
        sb.table("artifacts")
        .select("id,title,type,domains")
        .eq("account_id", account_id)
        .eq("kind", "domain")
        .execute()
        .data
        or []
    )
    for r in rows:
        t = (r.get("type") or "").strip()
        if t == "category":
            continue
        if domain in (r.get("domains") or []):
            return r["id"]
    return None


def pick_documents_parent(
    sb,
    account_id: str,
    *,
    prefer_keywords: tuple[str, ...] = (),
) -> str | None:
    """documents 의 contains 부모 후보: 서브허브 > 메인 허브."""
    return (
        pick_sub_hub_id(sb, account_id, "documents", prefer_keywords=prefer_keywords)
        or pick_main_hub_id(sb, account_id, "documents")
    )


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
    extra_meta_keys: tuple[str, ...] = (),
    subtype_whitelist: dict[str, tuple[str, ...]] | None = None,
    type_to_subhub: dict[str, str] | None = None,
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

        # 도메인별 자유 메타데이터 (due_label / contract_subtype / delivery_note 등)
        wl = subtype_whitelist or {}
        for k in extra_meta_keys:
            raw = (parsed.get(k) or "").strip()
            if not raw:
                continue
            allowed = wl.get(k)
            if allowed and raw not in allowed:
                continue
            metadata[k] = raw[:200]

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
        record_artifact_for_focus(artifact_id)

        # 서브허브 지정 → 정확히 매칭. 없으면 도메인 메인 허브로 폴백.
        # 어떤 경우든 contains 엣지를 반드시 생성해 캔버스에 위치가 잡히도록 한다.
        sub_domain_name = (parsed.get("sub_domain") or "").strip()
        # LLM이 sub_domain을 빠뜨렸으면 type_to_subhub 매핑으로 보완
        if not sub_domain_name and type_to_subhub:
            sub_domain_name = type_to_subhub.get(artifact_type, "")
        hub_id: str | None = None
        if sub_domain_name:
            hub_id = _find_sub_hub_id(sb, account_id, domain, sub_domain_name)
        if not hub_id:
            hub_id = pick_sub_hub_id(sb, account_id, domain) or pick_main_hub_id(sb, account_id, domain)
        if hub_id:
            try:
                sb.table("artifact_edges").insert(
                    {
                        "account_id": account_id,
                        "parent_id":  hub_id,
                        "child_id":   artifact_id,
                        "relation":   "contains",
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

        try:
            from app.memory.long_term import log_artifact_to_memory
            await log_artifact_to_memory(account_id, domain, artifact_type, title)
        except Exception:
            pass

        return artifact_id
    except Exception:
        return None
