-- 013_marketing_subhubs.sql
-- Marketing 서브허브 5개 확정: Social, Blog, Campaigns, Events, Reviews
--
-- 1. bootstrap_workspace 업데이트 — 신규 가입자에게 자동 생성
-- 2. 기존 계정 백필 — marketing 메인허브는 있으나 서브허브 없는 계정에 추가

-- ── 1. bootstrap_workspace 업데이트 ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bootstrap_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anchor_id  uuid;
  recruit_id uuid;
  market_id  uuid;
  sales_id   uuid;
  docs_id    uuid;
  -- marketing sub-hubs
  m_social    uuid;
  m_blog      uuid;
  m_campaigns uuid;
  m_events    uuid;
  m_reviews   uuid;
BEGIN
  INSERT INTO public.profiles(id) VALUES (new.id) ON CONFLICT DO NOTHING;

  INSERT INTO public.artifacts(account_id, kind, title, content)
    VALUES (new.id, 'anchor', 'Orchestrator', '오케스트레이터 트리거')
    RETURNING id INTO anchor_id;

  INSERT INTO public.artifacts(account_id, domains, kind, title, content)
    VALUES (new.id, ARRAY['recruitment'], 'domain', '채용 관리', 'Recruitment')
    RETURNING id INTO recruit_id;

  INSERT INTO public.artifacts(account_id, domains, kind, title, content)
    VALUES (new.id, ARRAY['marketing'], 'domain', '마케팅 관리', 'Marketing')
    RETURNING id INTO market_id;

  INSERT INTO public.artifacts(account_id, domains, kind, title, content)
    VALUES (new.id, ARRAY['sales'], 'domain', '매출 관리', 'Sales')
    RETURNING id INTO sales_id;

  INSERT INTO public.artifacts(account_id, domains, kind, title, content)
    VALUES (new.id, ARRAY['documents'], 'domain', '서류 관리', 'Documents')
    RETURNING id INTO docs_id;

  INSERT INTO public.artifact_edges(account_id, parent_id, child_id, relation) VALUES
    (new.id, anchor_id, recruit_id, 'contains'),
    (new.id, anchor_id, market_id,  'contains'),
    (new.id, anchor_id, sales_id,   'contains'),
    (new.id, anchor_id, docs_id,    'contains');

  -- Marketing 서브허브 5개
  INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
    VALUES (new.id, ARRAY['marketing'], 'domain', 'category', 'Social', 'SNS 홍보 — sns_post, product_post')
    RETURNING id INTO m_social;

  INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
    VALUES (new.id, ARRAY['marketing'], 'domain', 'category', 'Blog', '블로그 콘텐츠 — blog_post')
    RETURNING id INTO m_blog;

  INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
    VALUES (new.id, ARRAY['marketing'], 'domain', 'category', 'Campaigns', '광고 & 캠페인 — ad_copy, campaign')
    RETURNING id INTO m_campaigns;

  INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
    VALUES (new.id, ARRAY['marketing'], 'domain', 'category', 'Events', '이벤트 & 공지 — event_plan, notice, marketing_plan')
    RETURNING id INTO m_events;

  INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
    VALUES (new.id, ARRAY['marketing'], 'domain', 'category', 'Reviews', '고객 관리 — review_reply')
    RETURNING id INTO m_reviews;

  INSERT INTO public.artifact_edges(account_id, parent_id, child_id, relation) VALUES
    (new.id, market_id, m_social,    'contains'),
    (new.id, market_id, m_blog,      'contains'),
    (new.id, market_id, m_campaigns, 'contains'),
    (new.id, market_id, m_events,    'contains'),
    (new.id, market_id, m_reviews,   'contains');

  RETURN new;
END;
$$;

-- ── 2. 기존 계정 백필 ────────────────────────────────────────────────────────
-- marketing 메인허브는 있으나 서브허브(type='category')가 없는 계정에 추가

DO $$
DECLARE
  r          RECORD;
  market_id  uuid;
  m_social    uuid;
  m_blog      uuid;
  m_campaigns uuid;
  m_events    uuid;
  m_reviews   uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT a.account_id
    FROM public.artifacts a
    WHERE a.domains @> ARRAY['marketing']
      AND a.kind = 'domain'
      AND (a.type IS NULL OR a.type = '')
      AND NOT EXISTS (
        SELECT 1 FROM public.artifacts sub
        WHERE sub.account_id = a.account_id
          AND sub.domains @> ARRAY['marketing']
          AND sub.kind = 'domain'
          AND sub.type = 'category'
          AND sub.title IN ('Social','Blog','Campaigns','Events','Reviews')
      )
  LOOP
    -- 해당 계정의 marketing 메인허브 id 조회
    SELECT id INTO market_id
    FROM public.artifacts
    WHERE account_id = r.account_id
      AND domains @> ARRAY['marketing']
      AND kind = 'domain'
      AND (type IS NULL OR type = '')
    ORDER BY created_at
    LIMIT 1;

    IF market_id IS NULL THEN CONTINUE; END IF;

    INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
      VALUES (r.account_id, ARRAY['marketing'], 'domain', 'category', 'Social', 'SNS 홍보 — sns_post, product_post')
      RETURNING id INTO m_social;

    INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
      VALUES (r.account_id, ARRAY['marketing'], 'domain', 'category', 'Blog', '블로그 콘텐츠 — blog_post')
      RETURNING id INTO m_blog;

    INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
      VALUES (r.account_id, ARRAY['marketing'], 'domain', 'category', 'Campaigns', '광고 & 캠페인 — ad_copy, campaign')
      RETURNING id INTO m_campaigns;

    INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
      VALUES (r.account_id, ARRAY['marketing'], 'domain', 'category', 'Events', '이벤트 & 공지 — event_plan, notice, marketing_plan')
      RETURNING id INTO m_events;

    INSERT INTO public.artifacts(account_id, domains, kind, type, title, content)
      VALUES (r.account_id, ARRAY['marketing'], 'domain', 'category', 'Reviews', '고객 관리 — review_reply')
      RETURNING id INTO m_reviews;

    INSERT INTO public.artifact_edges(account_id, parent_id, child_id, relation) VALUES
      (r.account_id, market_id, m_social,    'contains'),
      (r.account_id, market_id, m_blog,      'contains'),
      (r.account_id, market_id, m_campaigns, 'contains'),
      (r.account_id, market_id, m_events,    'contains'),
      (r.account_id, market_id, m_reviews,   'contains');

  END LOOP;
END;
$$;
