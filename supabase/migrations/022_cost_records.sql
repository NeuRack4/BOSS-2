-- ============================================================
-- 022_cost_records.sql
-- Sales 도메인 비용 데이터 테이블
--
-- 1) cost_records  — 비용 입력 전용 트랜잭션 테이블
-- ============================================================

-- ------------------------------------------------------------
-- 1. cost_records 테이블
-- ------------------------------------------------------------
create table public.cost_records (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references auth.users(id) on delete cascade,
  recorded_date date not null,
  item_name     text not null,
  category      text not null default '기타'
                  check (category = any(array['재료비','인건비','임대료','공과금','마케팅','기타'])),
  amount        integer not null check (amount >= 0),
  memo          text not null default '',
  source        text not null default 'chat'
                  check (source = any(array['chat','ocr','manual'])),
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz default now()
);

alter table public.cost_records enable row level security;

create policy "users can manage own cost_records"
  on public.cost_records for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

-- 날짜별 조회/집계 인덱스
create index idx_cost_records_account_date
  on public.cost_records(account_id, recorded_date desc);
