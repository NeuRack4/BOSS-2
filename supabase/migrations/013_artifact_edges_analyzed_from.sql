-- ============================================================
-- 013_artifact_edges_analyzed_from.sql
-- artifact_edges.relation CHECK 제약에 'analyzed_from' 추가 (v0.8.x 공정성 분석)
-- ============================================================

alter table public.artifact_edges
  drop constraint if exists artifact_edges_relation_check;

alter table public.artifact_edges
  add constraint artifact_edges_relation_check
  check (relation = any (array[
    'contains'::text,
    'derives_from'::text,
    'scheduled_by'::text,
    'revises'::text,
    'logged_from'::text,
    'analyzed_from'::text
  ]));
