-- 023_chat_messages_speaker.sql
-- 각 assistant 메시지를 생성한 주체(orchestrator / recruitment / marketing / sales / documents)를 추적.
-- 복수 도메인 병렬 dispatch 인 경우 배열에 모두 담는다 (예: ['recruitment','marketing']).
-- user / system 메시지는 null.

alter table public.chat_messages
  add column if not exists speaker text[] default null;

comment on column public.chat_messages.speaker is
  'Which agent(s) produced this assistant message. Values: orchestrator | recruitment | marketing | sales | documents. Null for user/system messages.';
