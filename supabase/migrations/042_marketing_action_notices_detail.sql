-- marketing_action_notices 상세 컬럼 추가
alter table marketing_action_notices
  add column if not exists target   text,
  add column if not exists idea     text,
  add column if not exists steps    jsonb,
  add column if not exists expected text,
  add column if not exists why      text;
