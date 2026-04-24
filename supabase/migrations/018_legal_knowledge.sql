-- ============================================================
-- 018_legal_knowledge.sql
-- Legal 서브허브 (Documents > Legal) RAG 지식 테이블.
--
-- 목적: 소상공인이 겪는 다양한 법률 영역 (노동·임대차·공정거래·개인정보·
--       상법·민법·프랜차이즈·전자상거래·식품위생·세법 등) 을 통합한
--       단일 테이블로 운영. 계약서 검토용 `law_contract_knowledge_chunks`
--       와 목적이 다르므로 별도 테이블로 둔다.
--
-- 청킹: 2단계 계층 (011 과 동일)
--   article 청크  : 조문 전체
--   paragraph 청크: 항 단위
--
-- BAAI/bge-m3 (1024dim) 임베딩.
-- ============================================================

create table if not exists public.legal_knowledge_chunks (
  id             bigserial primary key,
  domain         text not null,   -- 'labor' | 'lease' | 'privacy' | 'fair_trade' |
                                  -- 'consumer' | 'franchise' | 'ecommerce' |
                                  -- 'tax' | 'food_hygiene' | 'smb' | 'civil' |
                                  -- 'commercial' | 'criminal' | 'other'
  source         text not null,   -- 법령명
  chunk_index    int  not null default 0,
  chunk_type     text,            -- 'article' | 'paragraph'
  article_no     text,            -- '제7조'
  article_title  text,
  paragraph_no   int,
  paragraph_char text,
  parent_doc_id  bigint references public.legal_knowledge_chunks(id),
  content        text not null,
  embedding      vector(1024),
  metadata       jsonb,
  created_at     timestamptz default now(),
  unique (source, chunk_type, article_no, paragraph_no)
);

create index if not exists legal_kc_embedding_idx
  on public.legal_knowledge_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists legal_kc_trgm_idx
  on public.legal_knowledge_chunks using gin (content gin_trgm_ops);

create index if not exists legal_kc_fts_idx
  on public.legal_knowledge_chunks using gin (to_tsvector('simple', content));

create index if not exists legal_kc_domain_idx
  on public.legal_knowledge_chunks (domain);

-- RLS — 지식 베이스는 모든 인증 사용자가 읽을 수 있음 (public knowledge).
-- 쓰기는 service_role 전용 (인제스트 스크립트).
alter table public.legal_knowledge_chunks enable row level security;

create policy "legal_kc_read" on public.legal_knowledge_chunks for select using (true);
