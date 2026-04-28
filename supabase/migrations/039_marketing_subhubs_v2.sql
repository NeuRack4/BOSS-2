-- ============================================================
-- 039_marketing_subhubs_v2.sql
-- Marketing 서브허브를 4개로 재편:
--   Social / Blog / YouTube Shorts / 성과 분석
-- (Campaigns, Events, Reviews 는 칸반에서 숨김 — 기존 아티팩트 보존)
-- ============================================================

-- 1. 기존 계정에 YouTube Shorts / 성과 분석 서브허브 추가 (idempotent)
DO $$
DECLARE
  r         RECORD;
  main_id   UUID;
  new_id    UUID;
BEGIN
  FOR r IN
    SELECT DISTINCT account_id
    FROM public.artifacts
    WHERE kind = 'domain'
      AND type = 'category'
      AND 'marketing' = ANY(domains)
  LOOP
    -- 마케팅 메인허브 id
    SELECT id INTO main_id
    FROM public.artifacts
    WHERE account_id = r.account_id
      AND kind = 'domain'
      AND 'marketing' = ANY(domains)
      AND (type IS NULL OR type <> 'category')
    LIMIT 1;

    -- YouTube Shorts 추가
    IF NOT EXISTS (
      SELECT 1 FROM public.artifacts
      WHERE account_id = r.account_id
        AND kind = 'domain' AND type = 'category'
        AND title = 'YouTube Shorts'
        AND 'marketing' = ANY(domains)
    ) THEN
      INSERT INTO public.artifacts(account_id, domains, kind, type, title, content, status)
      VALUES (r.account_id, ARRAY['marketing'], 'domain', 'category',
              'YouTube Shorts', 'YouTube Shorts 콘텐츠', 'active')
      RETURNING id INTO new_id;

      IF main_id IS NOT NULL THEN
        INSERT INTO public.artifact_edges(account_id, parent_id, child_id, relation)
        VALUES (r.account_id, main_id, new_id, 'contains');
      END IF;
    END IF;

    -- 성과 분석 추가
    IF NOT EXISTS (
      SELECT 1 FROM public.artifacts
      WHERE account_id = r.account_id
        AND kind = 'domain' AND type = 'category'
        AND title = '성과 분석'
        AND 'marketing' = ANY(domains)
    ) THEN
      INSERT INTO public.artifacts(account_id, domains, kind, type, title, content, status)
      VALUES (r.account_id, ARRAY['marketing'], 'domain', 'category',
              '성과 분석', '성과 분석 리포트', 'active')
      RETURNING id INTO new_id;

      IF main_id IS NOT NULL THEN
        INSERT INTO public.artifact_edges(account_id, parent_id, child_id, relation)
        VALUES (r.account_id, main_id, new_id, 'contains');
      END IF;
    END IF;
  END LOOP;
END $$;


-- 2. ensure_standard_sub_hubs 함수 갱신 — 새 가입자용 표준 목록 반영
CREATE OR REPLACE FUNCTION public.ensure_standard_sub_hubs(p_account UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  spec        RECORD;
  main_hub_id UUID;
  sub_hub_id  UUID;
BEGIN
  FOR spec IN
    WITH defs(domain, title) AS (
      VALUES
        ('recruitment'::text, 'Job_posting'),
        ('recruitment',        'Interviews'),
        ('recruitment',        'Onboarding'),
        ('recruitment',        'Evaluations'),
        ('documents',          'Contracts'),
        ('documents',          'Tax&HR'),
        ('documents',          'Legal'),
        ('documents',          'Operations'),
        ('sales',              'Reports'),
        ('sales',              'Customers'),
        ('sales',              'Pricing'),
        ('sales',              'Costs'),
        -- marketing: 4개로 재편
        ('marketing',          'Social'),
        ('marketing',          'Blog'),
        ('marketing',          'YouTube Shorts'),
        ('marketing',          '성과 분석')
    )
    SELECT * FROM defs
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.artifacts a
      WHERE a.account_id = p_account
        AND a.kind = 'domain'
        AND a.type = 'category'
        AND a.title = spec.title
        AND spec.domain = ANY(a.domains)
    ) THEN
      CONTINUE;
    END IF;

    SELECT id INTO main_hub_id
    FROM public.artifacts
    WHERE account_id = p_account
      AND kind = 'domain'
      AND (type IS NULL OR type = '' OR type <> 'category')
      AND spec.domain = ANY(domains)
    LIMIT 1;

    IF main_hub_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.artifacts(account_id, domains, kind, type, title, content, status)
    VALUES (p_account, ARRAY[spec.domain], 'domain', 'category', spec.title, '', 'active')
    RETURNING id INTO sub_hub_id;

    INSERT INTO public.artifact_edges(account_id, parent_id, child_id, relation)
    VALUES (p_account, main_hub_id, sub_hub_id, 'contains');
  END LOOP;
END;
$$;
