-- seed_mock_data.sql
-- test@test.com (account_id: 20fe9518-243d-49b8-8115-f99984396bb6) 계정에 mock 노드 시드.
-- 다층 DAG + cross-domain 시연용. cleanup_mock_data.sql로 일괄 제거 가능.
-- 모든 타이틀은 '[MOCK]' 프리픽스 유지 → 정리 기준으로 사용.

do $$
declare
  acc uuid := '20fe9518-243d-49b8-8115-f99984396bb6';
  anchor_id uuid;
  recruit_id uuid; market_id uuid; sales_id uuid; docs_id uuid;

  r_post uuid; r_iv uuid; r_screen uuid;
  r_post_sched uuid; r_post_log uuid;

  m_insta uuid; m_blog uuid; m_ad uuid; m_email uuid;
  m_insta_sched uuid; m_insta_v2 uuid; m_combined uuid;

  s_report uuid; s_pricing uuid; s_report_sched uuid;

  d_contract uuid; d_invoice uuid; d_sop uuid; d_handbook uuid; d_tax uuid;
  d_contract_v2 uuid;

  -- cross-domain 자식
  onboarding_id uuid; roi_id uuid;
begin
  -- 1) anchor + 4 domains
  insert into public.artifacts(account_id, kind, title, content)
    values (acc, 'anchor', '[MOCK] Orchestrator', '오케스트레이터 트리거') returning id into anchor_id;
  insert into public.artifacts(account_id, domains, kind, title, content) values
    (acc, array['recruitment'], 'domain', '[MOCK] 채용 관리', 'Recruitment') returning id into recruit_id;
  insert into public.artifacts(account_id, domains, kind, title, content) values
    (acc, array['marketing'],   'domain', '[MOCK] 마케팅 관리', 'Marketing')  returning id into market_id;
  insert into public.artifacts(account_id, domains, kind, title, content) values
    (acc, array['sales'],       'domain', '[MOCK] 매출 관리',   'Sales')      returning id into sales_id;
  insert into public.artifacts(account_id, domains, kind, title, content) values
    (acc, array['documents'],   'domain', '[MOCK] 서류 관리',   'Documents')  returning id into docs_id;

  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, anchor_id, recruit_id, 'contains'),
    (acc, anchor_id, market_id,  'contains'),
    (acc, anchor_id, sales_id,   'contains'),
    (acc, anchor_id, docs_id,    'contains');

  -- 2) recruitment
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['recruitment'], 'artifact', 'job_posting',         '[MOCK] 주말 카페 알바 채용 공고',     '오전 10시-오후 6시, 시급 11,000원...', 'active') returning id into r_post;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['recruitment'], 'artifact', 'interview_questions', '[MOCK] 신입 바리스타 면접 질문 세트', '1. 손님 응대 경험 / 2. 메뉴 학습 속도...', 'draft') returning id into r_iv;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['recruitment'], 'artifact', 'candidate_screening', '[MOCK] 지원자 1차 스크리닝 기준',     '경력 6개월 이상, 주말 근무 가능...',     'paused') returning id into r_screen;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, recruit_id, r_post, 'contains'),
    (acc, recruit_id, r_iv,   'contains'),
    (acc, recruit_id, r_screen,'contains');

  insert into public.artifacts(account_id, domains, kind, type, title, content, status, metadata) values
    (acc, array['recruitment'], 'schedule', 'cron', '[MOCK] 공고 매일 09:00 게시', '매일 오전 9시 자동 게시', 'active',
     '{"cron":"0 9 * * *","next_run":"2026-04-19T09:00:00Z"}') returning id into r_post_sched;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status, metadata) values
    (acc, array['recruitment'], 'log', 'run', '[MOCK] 게시 성공', 'HTTP 200, 게시 ID #4421', 'success',
     '{"executed_at":"2026-04-18T09:00:01Z"}') returning id into r_post_log;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, r_post, r_post_sched, 'scheduled_by'),
    (acc, r_post_sched, r_post_log, 'logged_from');

  -- 3) marketing
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['marketing'], 'artifact', 'instagram_post', '[MOCK] 5월 신메뉴 인스타 게시물',     '시즌 한정 망고 라떼 출시!',                 'active') returning id into m_insta;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['marketing'], 'artifact', 'blog_draft',     '[MOCK] 카페 창업 1년 후기 블로그',    '소상공인의 1년 매출 성장 스토리...',         'draft')  returning id into m_blog;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['marketing'], 'artifact', 'ad_campaign',    '[MOCK] 네이버 검색 광고 5월 캠페인',   '키워드: 강남 카페, CPC 800원...',            'active') returning id into m_ad;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['marketing'], 'artifact', 'email_blast',    '[MOCK] 단골 고객 쿠폰 메일',           '단골 50명 대상 20% 할인 쿠폰...',            'paused') returning id into m_email;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, market_id, m_insta, 'contains'),
    (acc, market_id, m_blog,  'contains'),
    (acc, market_id, m_ad,    'contains'),
    (acc, market_id, m_email, 'contains');

  insert into public.artifacts(account_id, domains, kind, type, title, content, status, metadata) values
    (acc, array['marketing'], 'schedule', 'cron', '[MOCK] 인스타 매주 금 18:00 발행', '매주 금요일 저녁 6시 자동 발행', 'active',
     '{"cron":"0 18 * * 5"}') returning id into m_insta_sched;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values (acc, m_insta, m_insta_sched, 'scheduled_by');

  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['marketing'], 'artifact', 'instagram_post', '[MOCK] 5월 신메뉴 인스타 v2 (할인쿠폰)',
     '망고 라떼 + 1+1 쿠폰 코드 추가', 'draft') returning id into m_insta_v2;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values (acc, m_insta, m_insta_v2, 'revises');

  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['marketing'], 'artifact', 'campaign_report', '[MOCK] 5월 통합 캠페인 성과 보고서',
     '검색광고 ROAS 3.2x + 쿠폰 메일 전환율 14% 합산', 'active') returning id into m_combined;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, m_ad,    m_combined, 'derives_from'),
    (acc, m_email, m_combined, 'derives_from');

  -- 4) sales
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['sales'], 'artifact', 'weekly_report',    '[MOCK] 4월 3주차 매출 리포트', '총매출 8,420,000원, 객단가 12,300원...', 'active') returning id into s_report;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['sales'], 'artifact', 'pricing_strategy', '[MOCK] 신메뉴 가격 책정안',     '망고 라떼 6,500원 / 마진율 62%...',       'draft')  returning id into s_pricing;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, sales_id, s_report,  'contains'),
    (acc, sales_id, s_pricing, 'contains');

  insert into public.artifacts(account_id, domains, kind, type, title, content, status, metadata) values
    (acc, array['sales'], 'schedule', 'cron', '[MOCK] 매주 월 08:00 자동 리포트', '매주 월요일 아침 8시 주간 매출 자동 집계', 'active', '{"cron":"0 8 * * 1"}') returning id into s_report_sched;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values (acc, s_report, s_report_sched, 'scheduled_by');

  -- 5) documents
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['documents'], 'artifact', 'contract',          '[MOCK] 알바생 표준 근로계약서',  '2026년 표준 근로계약서 템플릿...',  'active') returning id into d_contract;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['documents'], 'artifact', 'invoice_template',  '[MOCK] 거래처 세금계산서 양식',  '공급자/공급받는자 항목 포함...',     'draft')  returning id into d_invoice;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['documents'], 'artifact', 'sop',               '[MOCK] 매장 오픈/마감 SOP',       '오픈 8:30 체크리스트 12개 항목...',  'active') returning id into d_sop;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['documents'], 'artifact', 'employee_handbook', '[MOCK] 직원 핸드북 v2',           '근무 규칙, 휴가 정책, 복장 규정...', 'draft')  returning id into d_handbook;
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['documents'], 'artifact', 'tax_filing',        '[MOCK] 1분기 부가세 신고 자료',  '매출세액 / 매입세액 정리...',         'paused') returning id into d_tax;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, docs_id, d_contract, 'contains'),
    (acc, docs_id, d_invoice,  'contains'),
    (acc, docs_id, d_sop,      'contains'),
    (acc, docs_id, d_handbook, 'contains'),
    (acc, docs_id, d_tax,      'contains');

  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['documents'], 'artifact', 'contract', '[MOCK] 알바생 근로계약서 v2 (시급 인상 반영)', '시급 11,500원 / 주휴수당 명시', 'draft') returning id into d_contract_v2;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values (acc, d_contract, d_contract_v2, 'revises');

  -- 6) cross-domain 자식 노드들
  -- 채용 공고 + 근로계약서 → 신규 직원 온보딩 패키지
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['recruitment','documents'], 'artifact', 'onboarding_package',
     '[MOCK] 신규 직원 온보딩 패키지',
     '주말 알바 공고 + 근로계약서 묶음. 첫 출근 전 자동 발송.', 'active') returning id into onboarding_id;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, r_post,     onboarding_id, 'derives_from'),
    (acc, d_contract, onboarding_id, 'derives_from');

  -- 마케팅 캠페인 보고서 + 매출 리포트 → ROI 통합 분석
  insert into public.artifacts(account_id, domains, kind, type, title, content, status) values
    (acc, array['marketing','sales'], 'artifact', 'roi_report',
     '[MOCK] 5월 마케팅 ROI 통합 분석',
     '광고/이메일 캠페인 비용 대비 매출 증가분 비교', 'draft') returning id into roi_id;
  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (acc, m_combined, roi_id, 'derives_from'),
    (acc, s_report,   roi_id, 'derives_from');

  insert into public.activity_logs(account_id, type, domain, title, description) values
    (acc, 'artifact_created', 'recruitment', '[MOCK] 채용 공고 생성',     '주말 알바 공고 초안 생성됨'),
    (acc, 'agent_run',        'marketing',   '[MOCK] 인스타 포스트 발행', '5월 신메뉴 게시물 자동 발행'),
    (acc, 'artifact_created', 'sales',       '[MOCK] 주간 리포트 생성',   '4월 3주차 매출 자동 집계'),
    (acc, 'artifact_created', 'documents',   '[MOCK] 근로계약서 등록',    '표준 양식 업로드');
end $$;
