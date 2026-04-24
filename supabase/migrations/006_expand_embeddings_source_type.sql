-- 006_expand_embeddings_source_type.sql
-- 검색 기능(전체 노드 인덱싱) 지원을 위한 embeddings 테이블 확장.
--   1) source_type CHECK 확장: schedule / log / hub 추가
--   2) source_id 유니크 인덱스 (upsert 안전성)
--   3) upsert_embedding RPC: 인서트 + FTS 자동 생성

-- 1) CHECK 제약 확장
alter table public.embeddings drop constraint if exists embeddings_source_type_check;
alter table public.embeddings add constraint embeddings_source_type_check
  check (source_type = any (array[
    'recruitment','marketing','sales','documents',
    'memory','document',
    'schedule','log','hub'
  ]));

-- 2) source_id 유니크 (한 artifact당 임베딩 1개)
create unique index if not exists embeddings_source_id_uniq
  on public.embeddings(source_id);

-- 3) upsert 헬퍼: content → fts 자동 변환 + on conflict 갱신.
--    runtime index_artifact 와 backfill 스크립트 모두 이 함수 사용.
create or replace function public.upsert_embedding(
  p_account_id  uuid,
  p_source_type text,
  p_source_id   uuid,
  p_content     text,
  p_embedding   vector
) returns void
language plpgsql
as $$
begin
  insert into public.embeddings (account_id, source_type, source_id, content, embedding, fts)
  values (p_account_id, p_source_type, p_source_id, p_content, p_embedding,
          to_tsvector('simple', p_content))
  on conflict (source_id) do update
     set source_type = excluded.source_type,
         content     = excluded.content,
         embedding   = excluded.embedding,
         fts         = excluded.fts;
end;
$$;
