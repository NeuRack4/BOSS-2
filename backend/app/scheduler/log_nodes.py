"""schedule 실행 결과를 kind='log' artifact 노드로 캔버스에 남기는 헬퍼.

Seed 의 log 노드 형태:
  kind='log', type='run', status='success'|'failed'
  content — 한 줄 요약 (예: 'HTTP 200 OK — 정상 실행', '실행 실패: ...')
  domains — parent schedule 의 domains 복사
  metadata.executed_at
artifact_edges: parent=schedule, child=log, relation='logged_from'
"""

from datetime import datetime


def create_log_node(sb, schedule_artifact: dict, *, status: str, content: str, executed_at: datetime) -> str | None:
    parent_id = schedule_artifact.get("id")
    account_id = schedule_artifact.get("account_id")
    if not parent_id or not account_id:
        return None

    base_title = schedule_artifact.get("title") or "schedule run"
    title = f"{base_title} — 실행 {executed_at.strftime('%m-%d %H:%M')}"

    ins = (
        sb.table("artifacts")
        .insert(
            {
                "account_id": account_id,
                "domains": schedule_artifact.get("domains") or [],
                "kind": "log",
                "type": "run",
                "title": title[:255],
                "content": content[:500],
                "status": status,
                "metadata": {"executed_at": executed_at.isoformat()},
            }
        )
        .execute()
    )
    log_row = (ins.data or [{}])[0]
    log_id = log_row.get("id")
    if not log_id:
        return None

    sb.table("artifact_edges").insert(
        {"parent_id": parent_id, "child_id": log_id, "relation": "logged_from"}
    ).execute()
    return log_id
