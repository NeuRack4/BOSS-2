-- 009_profile_last_seen.sql
-- profiles.last_seen_at: 로그인 브리핑 트리거용 "직전 접속 시각".
-- 프론트가 로그인 성공 직후 /api/auth/session/touch 를 호출하면
-- 백엔드가 이전 값으로 briefing 조건을 판정한 뒤 now() 로 갱신한다.
--
-- 조건: (now - last_seen_at >= 8h) OR (이전 접속 이후 auto-run 실패 ≥1건)

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- 기존 RLS 정책은 select/update 만 있고 insert 없음.
-- bootstrap_workspace 트리거가 auth.users 생성 시 row 를 넣어주므로 insert 정책은 불필요.
