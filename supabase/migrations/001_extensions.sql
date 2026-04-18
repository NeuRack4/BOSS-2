-- 001_extensions.sql
-- 필수 PostgreSQL 확장 활성화
-- - pgcrypto: gen_random_uuid()
-- - uuid-ossp: UUID 생성 유틸 (호환성 목적)
-- - vector: pgvector (BAAI/bge-m3, 1024dim)
-- - pg_trgm: 하이브리드 검색의 BM25 근사용 FTS 보조

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists vector;
create extension if not exists pg_trgm;
