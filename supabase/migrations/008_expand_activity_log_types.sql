-- 008_expand_activity_log_types.sql
-- activity_logs.type check 제약을 스케쥴러 이벤트까지 확장.
-- 기존: 'artifact_created' | 'agent_run'
-- 추가: 'schedule_run'    — 스케쥴 실행 완료/실패 이벤트 (kind=schedule artifact 기준)
--       'schedule_notify' — 일회성 artifact 시작일/마감일 알림 (D-0, D-1)

alter table public.activity_logs
  drop constraint if exists activity_logs_type_check;

alter table public.activity_logs
  add constraint activity_logs_type_check
  check (type = any (array[
    'artifact_created',
    'agent_run',
    'schedule_run',
    'schedule_notify'
  ]));
