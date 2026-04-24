-- ============================================================
-- 029_menus.sql
-- Sales 메뉴 마스터 테이블
--
-- menus — 계정별 메뉴 목록 (이름/카테고리/판매가/원가/활성여부)
-- ============================================================

create table public.menus (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  category    text not null default '기타',
  price       integer not null default 0 check (price >= 0),
  cost_price  integer not null default 0 check (cost_price >= 0),
  is_active   boolean not null default true,
  memo        text not null default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(account_id, name)
);

alter table public.menus enable row level security;

create policy "users can manage own menus"
  on public.menus for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

create index idx_menus_account
  on public.menus(account_id, is_active, category);
