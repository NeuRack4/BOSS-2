-- profiles 테이블에 아바타 URL 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
