-- ============================================================
-- 030_sales_timeslot.sql
-- sales_records 시간대 추적 컬럼 추가
--
-- time_slot: 오전(06-12) / 오후(12-18) / 저녁(18-24) / null=미입력
-- ============================================================

alter table public.sales_records
  add column if not exists time_slot text
    check (time_slot is null or time_slot = any(array['오전','오후','저녁']));

comment on column public.sales_records.time_slot is
  '판매 시간대: 오전(06-12) / 오후(12-18) / 저녁(18-24) / null=미입력';
