-- 003_indexes.sql
-- 쿼리 패턴 기반 인덱스.
-- pgvector는 ivfflat(vector_cosine_ops, lists=100)로 충분 (1M row 미만 규모).
-- FTS는 tsvector GIN 인덱스로 plainto_tsquery('simple', ...) 매칭에 사용.

-- artifacts: account 기준 필터 + kind 필터 + domains 배열 검색
create index artifacts_account_id_idx        on public.artifacts (account_id);
create index artifacts_account_id_kind_idx   on public.artifacts (account_id, kind);
create index artifacts_domains_idx           on public.artifacts using gin (domains);

-- artifact_edges: parent/child 각각 조회, account 필터
create index artifact_edges_account_id_idx   on public.artifact_edges (account_id);
create index artifact_edges_parent_id_idx    on public.artifact_edges (parent_id);
create index artifact_edges_child_id_idx     on public.artifact_edges (child_id);

-- embeddings: 벡터 유사도 + FTS
create index embeddings_embedding_idx        on public.embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index embeddings_fts_idx              on public.embeddings using gin (fts);

-- memory_long: 벡터 유사도
create index memory_long_embedding_idx       on public.memory_long using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- evaluations: account/artifact 각각 조회
create index evaluations_account_id_idx      on public.evaluations (account_id);
create index evaluations_artifact_id_idx     on public.evaluations (artifact_id);

-- chat_sessions: 사이드바 리스팅 (최근 대화 순)
create index idx_chat_sessions_account_updated on public.chat_sessions (account_id, updated_at desc);

-- chat_messages: 세션 타임라인
create index idx_chat_messages_session_created on public.chat_messages (session_id, created_at);
