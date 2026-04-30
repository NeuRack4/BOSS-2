-- artifact 없이 독립적으로 메모 생성 가능하도록 artifact_id nullable 허용
ALTER TABLE public.memos ALTER COLUMN artifact_id DROP NOT NULL;
