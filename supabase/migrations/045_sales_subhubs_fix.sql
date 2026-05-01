-- ============================================================
-- 045_sales_subhubs_fix.sql
-- Sales 서브허브 정비:
--   1) 한글 서브허브 → 영문 rename (수익→Revenue 등)
--   2) 영문+한글 중복 시 한글 archived 처리
--   3) ensure_standard_sub_hubs — Sales 4개 확정 (Revenue/Costs/Pricing/Reports)
--   4) 기존 계정 Revenue 서브허브 backfill
-- ============================================================

-- 1. 한글 sales 서브허브 → 영문 rename (중복 없을 때)
UPDATE public.artifacts
SET title = CASE title
  WHEN '수익'    THEN 'Revenue'
  WHEN '비용'    THEN 'Costs'
  WHEN '가격'    THEN 'Pricing'
  WHEN '가격 전략' THEN 'Pricing'
  WHEN '보고서'  THEN 'Reports'
END
WHERE kind = 'domain'
  AND type = 'category'
  AND 'sales' = ANY(domains)
  AND title IN ('수익', '비용', '가격', '가격 전략', '보고서')
  AND NOT EXISTS (
    SELECT 1 FROM public.artifacts b
    WHERE b.account_id = artifacts.account_id
      AND b.kind = 'domain'
      AND b.type = 'category'
      AND 'sales' = ANY(b.domains)
      AND b.title = CASE artifacts.title
        WHEN '수익'      THEN 'Revenue'
        WHEN '비용'      THEN 'Costs'
        WHEN '가격'      THEN 'Pricing'
        WHEN '가격 전략' THEN 'Pricing'
        WHEN '보고서'    THEN 'Reports'
      END
  );

-- 2. 영문 버전이 이미 있는 경우 한글 중복을 archived 처리
UPDATE public.artifacts
SET status = 'archived'
WHERE kind = 'domain'
  AND type = 'category'
  AND 'sales' = ANY(domains)
  AND title IN ('수익', '비용', '가격', '가격 전략', '보고서')
  AND status != 'archived';

-- 3. ensure_standard_sub_hubs 재정의
--    Sales: Revenue / Costs / Pricing / Reports (Customers 제외)
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
        ('sales',              'Revenue'),
        ('sales',              'Costs'),
        ('sales',              'Pricing'),
        ('sales',              'Reports'),
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
        AND a.status != 'archived'
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

-- 4. 기존 모든 계정에 Revenue 서브허브 backfill
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN SELECT id FROM public.profiles LOOP
    PERFORM public.ensure_standard_sub_hubs(p.id);
  END LOOP;
END $$;
