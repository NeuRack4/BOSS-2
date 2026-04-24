-- ============================================================
-- 011_contract_knowledge.sql
-- 서류 검토 RAG 용 지식 테이블 3종 (law / pattern / acceptable)
--
-- 설계:
--   - law_contract_knowledge_chunks   : 법령 조문 (article + paragraph 2단계 계층)
--   - pattern_contract_knowledge_chunks : 위험 조항 패턴 (risk_level/pattern_name/contract_type 컬럼)
--   - acceptable_contract_knowledge_chunks : 관행 허용 조항 (clause_name/legal_basis/contract_type 컬럼)
--
--   각 테이블은 HNSW(m=16, ef=64) + trigram GIN + FTS GIN 3종 인덱스로
--   3-way RRF 하이브리드 검색(012 마이그레이션)을 지원한다.
--
--   BAAI/bge-m3 (1024dim) 임베딩 사용.
-- ============================================================

-- ── 1. law_contract_knowledge_chunks ────────────────────────────────────────
create table if not exists public.law_contract_knowledge_chunks (
  id             bigserial primary key,
  category       text not null,   -- 'labor' | 'lease' | 'service' | 'supply' | 'civil' | 'law'
  source         text not null,   -- 법령명
  chunk_index    int  not null default 0,
  chunk_type     text,            -- 'article' | 'paragraph'
  paragraph_no   int,
  paragraph_char text,
  parent_doc_id  bigint references public.law_contract_knowledge_chunks(id),
  content        text not null,
  embedding      vector(1024),
  metadata       jsonb,
  created_at     timestamptz default now()
);

create index if not exists law_ck_embedding_idx
  on public.law_contract_knowledge_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists law_ck_trgm_idx
  on public.law_contract_knowledge_chunks using gin (content gin_trgm_ops);

create index if not exists law_ck_fts_idx
  on public.law_contract_knowledge_chunks using gin (to_tsvector('simple', content));

-- ── 2. pattern_contract_knowledge_chunks ────────────────────────────────────
create table if not exists public.pattern_contract_knowledge_chunks (
  id             bigserial primary key,
  category       text not null,   -- 'labor' | 'lease' | 'service' | 'supply' | 'franchise' | 'partnership' | 'nda'
  source         text not null,   -- 파일명 (예: labor/risks.md)
  chunk_index    int  not null default 0,
  risk_level     text,            -- 'High' | 'Mid' | 'Low'
  pattern_name   text,
  contract_type  text,
  content        text not null,
  embedding      vector(1024),
  metadata       jsonb,
  created_at     timestamptz default now(),
  unique (source, chunk_index)
);

create index if not exists pattern_ck_embedding_idx
  on public.pattern_contract_knowledge_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists pattern_ck_trgm_idx
  on public.pattern_contract_knowledge_chunks using gin (content gin_trgm_ops);

create index if not exists pattern_ck_fts_idx
  on public.pattern_contract_knowledge_chunks using gin (to_tsvector('simple', content));

create index if not exists pattern_ck_filter_idx
  on public.pattern_contract_knowledge_chunks (risk_level, contract_type);

-- ── 3. acceptable_contract_knowledge_chunks ─────────────────────────────────
create table if not exists public.acceptable_contract_knowledge_chunks (
  id             bigserial primary key,
  category       text not null,
  source         text not null,
  chunk_index    int  not null default 0,
  clause_name    text,
  legal_basis    text,
  contract_type  text,
  content        text not null,
  embedding      vector(1024),
  metadata       jsonb,
  created_at     timestamptz default now(),
  unique (source, chunk_index)
);

create index if not exists acceptable_ck_embedding_idx
  on public.acceptable_contract_knowledge_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists acceptable_ck_trgm_idx
  on public.acceptable_contract_knowledge_chunks using gin (content gin_trgm_ops);

create index if not exists acceptable_ck_fts_idx
  on public.acceptable_contract_knowledge_chunks using gin (to_tsvector('simple', content));

create index if not exists acceptable_ck_filter_idx
  on public.acceptable_contract_knowledge_chunks (contract_type);

-- ── 4. RLS — 지식 베이스는 모든 인증 사용자가 읽을 수 있음 (public knowledge)
--     쓰기는 service_role 전용 (인제스트 스크립트)
alter table public.law_contract_knowledge_chunks        enable row level security;
alter table public.pattern_contract_knowledge_chunks    enable row level security;
alter table public.acceptable_contract_knowledge_chunks enable row level security;

create policy "law_ck_read"        on public.law_contract_knowledge_chunks        for select using (true);
create policy "pattern_ck_read"    on public.pattern_contract_knowledge_chunks    for select using (true);
create policy "acceptable_ck_read" on public.acceptable_contract_knowledge_chunks for select using (true);
