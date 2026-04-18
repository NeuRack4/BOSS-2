-- cleanup_mock_data.sql
-- test@test.com 계정의 모든 mock 데이터 일괄 제거.
-- artifact_edges / evaluations / task_logs / chat_messages 는 ON DELETE CASCADE 로 자동 정리됨.
-- embeddings / memory_long 은 FK 없이 source_id 로 연결되므로 명시적으로 삭제.
--
-- 기준: 타이틀에 '[MOCK]' 프리픽스 + account_id 매칭.

do $$
declare
  acc uuid := '20fe9518-243d-49b8-8115-f99984396bb6';
begin
  -- 활동이력
  delete from public.activity_logs
   where account_id = acc and title like '[MOCK]%';

  -- 임베딩 (artifact 삭제 전 먼저 제거 — source_id FK 없음)
  delete from public.embeddings
   where account_id = acc
     and source_id in (
       select id from public.artifacts
        where account_id = acc and title like '[MOCK]%'
     );

  -- 장기 기억 (mock 시드는 content 기준이 없으므로 계정 전체는 건드리지 않음.
  -- 필요 시 수동으로 아래 주석 해제)
  -- delete from public.memory_long where account_id = acc;

  -- 스케쥴 (artifact cascade로 대부분 정리되지만 명시적으로 남은 것 제거)
  delete from public.schedules
   where account_id = acc
     and artifact_id in (
       select id from public.artifacts
        where account_id = acc and title like '[MOCK]%'
     );

  -- artifact 본체 (edges / evaluations 는 cascade)
  delete from public.artifacts
   where account_id = acc and title like '[MOCK]%';
end $$;
