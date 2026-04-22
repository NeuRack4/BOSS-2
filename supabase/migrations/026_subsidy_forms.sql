-- 026_subsidy_forms.sql
-- subsidy_programs 에 form_files 컬럼 추가 (첨부파일 Storage 링크 목록)
-- Storage bucket 'subsidy-forms' 는 대시보드에서 수동 생성 완료

ALTER TABLE public.subsidy_programs
  ADD COLUMN IF NOT EXISTS form_files JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.subsidy_programs.form_files IS
  '[{filename, file_type, storage_path, storage_url}] — 기업마당 첨부 HWP/PDF/DOCX';
