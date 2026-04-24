-- ============================================================
-- 035_match_sales_embeddings.sql
-- Sales RAG 검색용 벡터 유사도 함수
-- embed_model: BAAI/bge-m3 → vector(1024)
-- ============================================================

create or replace function match_sales_embeddings(
  query_embedding vector(1024),
  match_account_id uuid,
  match_count int default 5
)
returns table (content text, similarity float)
language sql stable
as $$
  select
    content,
    1 - (embedding <=> query_embedding) as similarity
  from embeddings
  where account_id = match_account_id
    and source_type = 'sales'
  order by embedding <=> query_embedding
  limit match_count;
$$;
