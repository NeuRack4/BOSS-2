-- ============================================================
-- 033_sales_records_source_pos.sql
-- sales_records.source 허용값에 'pos' 추가
-- Square POS 연동으로 저장되는 매출 데이터 지원
-- ============================================================

alter table public.sales_records
  drop constraint if exists sales_records_source_check;

alter table public.sales_records
  add constraint sales_records_source_check
  check (source = any(array['chat','ocr','csv','excel','pos']));
