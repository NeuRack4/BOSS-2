-- 040_admin_flag.sql
-- profiles 테이블에 is_admin 플래그 추가.
-- 기본값 false. DB에서 직접 UPDATE로 권한 부여.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
