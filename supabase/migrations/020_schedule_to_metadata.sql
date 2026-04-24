-- 020_schedule_to_metadata.sql
-- Deprecate kind='schedule' artifacts — fold cron/next_run/executed_at into the
-- parent artifact's metadata as schedule_enabled + schedule_status + schedule_*.
--
-- Steps
--   1. For every `scheduled_by` edge (parent=target artifact, child=schedule node),
--      merge schedule.metadata and schedule.status into the parent's metadata.
--   2. Re-point `logged_from` edges whose parent was a schedule → parent's parent.
--   3. Delete kind='schedule' artifacts (CASCADE clears scheduled_by edges).
--   4. Drop 'schedule' from the kind CHECK constraint.

BEGIN;

-- 1. Merge schedule metadata into parent artifact
UPDATE public.artifacts AS parent
SET metadata = COALESCE(parent.metadata, '{}'::jsonb)
               || jsonb_build_object(
                    'schedule_enabled', true,
                    'schedule_status',  sched.status,
                    'cron',             COALESCE(sched.metadata->>'cron',       parent.metadata->>'cron'),
                    'next_run',         COALESCE(sched.metadata->>'next_run',   parent.metadata->>'next_run'),
                    'executed_at',      COALESCE(sched.metadata->>'executed_at', parent.metadata->>'executed_at')
                  )
FROM public.artifact_edges AS e
JOIN public.artifacts       AS sched ON sched.id = e.child_id AND sched.kind = 'schedule'
WHERE e.relation = 'scheduled_by'
  AND parent.id = e.parent_id;

-- 2. Re-point logged_from edges from schedule nodes to their parents.
--    If the target (parent's parent, child_id, 'logged_from') already exists we
--    drop the duplicate instead of forcing a UNIQUE violation.
WITH mapping AS (
  SELECT
    sched.id            AS schedule_id,
    sb.parent_id        AS target_parent_id,
    sched.account_id    AS account_id
  FROM public.artifacts AS sched
  JOIN public.artifact_edges AS sb
    ON sb.child_id = sched.id AND sb.relation = 'scheduled_by'
  WHERE sched.kind = 'schedule'
),
candidates AS (
  SELECT
    le.id               AS edge_id,
    le.child_id         AS log_id,
    m.target_parent_id  AS new_parent_id
  FROM public.artifact_edges le
  JOIN mapping m ON m.schedule_id = le.parent_id
  WHERE le.relation = 'logged_from'
),
to_delete AS (
  SELECT c.edge_id
  FROM candidates c
  JOIN public.artifact_edges existing
    ON existing.parent_id = c.new_parent_id
   AND existing.child_id  = c.log_id
   AND existing.relation  = 'logged_from'
),
to_update AS (
  SELECT c.edge_id, c.new_parent_id
  FROM candidates c
  WHERE c.edge_id NOT IN (SELECT edge_id FROM to_delete)
)
, del AS (
  DELETE FROM public.artifact_edges
  WHERE id IN (SELECT edge_id FROM to_delete)
  RETURNING id
)
UPDATE public.artifact_edges e
SET parent_id = u.new_parent_id
FROM to_update u
WHERE e.id = u.edge_id;

-- 3. Delete schedule artifacts (CASCADE removes scheduled_by edges + any embeddings row)
DELETE FROM public.embeddings
WHERE source_id IN (SELECT id FROM public.artifacts WHERE kind = 'schedule');

DELETE FROM public.artifacts WHERE kind = 'schedule';

-- 4. Drop 'schedule' from kind CHECK constraint
ALTER TABLE public.artifacts DROP CONSTRAINT IF EXISTS artifacts_kind_check;
ALTER TABLE public.artifacts ADD  CONSTRAINT artifacts_kind_check
  CHECK (kind = ANY (ARRAY['anchor'::text, 'domain'::text, 'artifact'::text, 'log'::text]));

COMMIT;
