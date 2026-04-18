-- 005_functions_triggers.sql
-- 트리거 함수, RAG 검색 함수, 연결된 트리거.
--
-- bootstrap_workspace: 신규 auth.user 가입 시 anchor + 4개 도메인 허브를 자동 생성.
-- touch_chat_session: 메시지 insert 시 해당 세션의 updated_at 갱신.
-- hybrid_search: pgvector + FTS를 RRF로 병합한 하이브리드 검색 (k=60 고정).
-- memory_search: 장기 기억 cosine 유사도 기반 recall.

-- ============================================================
-- Trigger Functions
-- ============================================================

create or replace function public.bootstrap_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  anchor_id  uuid;
  recruit_id uuid;
  market_id  uuid;
  sales_id   uuid;
  docs_id    uuid;
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;

  insert into public.artifacts(account_id, kind, title, content)
    values (new.id, 'anchor', 'Orchestrator', '오케스트레이터 트리거')
    returning id into anchor_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['recruitment'], 'domain', '채용 관리', 'Recruitment')
    returning id into recruit_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['marketing'], 'domain', '마케팅 관리', 'Marketing')
    returning id into market_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['sales'], 'domain', '매출 관리', 'Sales')
    returning id into sales_id;

  insert into public.artifacts(account_id, domains, kind, title, content)
    values (new.id, array['documents'], 'domain', '서류 관리', 'Documents')
    returning id into docs_id;

  insert into public.artifact_edges(account_id, parent_id, child_id, relation) values
    (new.id, anchor_id, recruit_id, 'contains'),
    (new.id, anchor_id, market_id,  'contains'),
    (new.id, anchor_id, sales_id,   'contains'),
    (new.id, anchor_id, docs_id,    'contains');

  return new;
end;
$$;

create or replace function public.touch_chat_session()
returns trigger
language plpgsql
as $$
begin
  update public.chat_sessions
     set updated_at = now()
   where id = new.session_id;
  return new;
end;
$$;

-- ============================================================
-- RAG Search Functions
-- ============================================================

create or replace function public.hybrid_search(
  p_account_id uuid,
  p_embedding  vector,
  p_query      text,
  p_limit      integer default 5
)
returns table (
  id          uuid,
  source_type text,
  source_id   uuid,
  content     text,
  rrf_score   double precision
)
language sql
stable
as $$
  with vector_ranked as (
    select id, source_type, source_id, content,
           row_number() over (order by embedding <=> p_embedding) as rank
    from public.embeddings
    where account_id = p_account_id
  ),
  fts_ranked as (
    select id, source_type, source_id, content,
           row_number() over (
             order by ts_rank(fts, plainto_tsquery('simple', p_query)) desc
           ) as rank
    from public.embeddings
    where account_id = p_account_id
      and fts @@ plainto_tsquery('simple', p_query)
  ),
  rrf as (
    select
      coalesce(v.id,          f.id)          as id,
      coalesce(v.source_type, f.source_type) as source_type,
      coalesce(v.source_id,   f.source_id)   as source_id,
      coalesce(v.content,     f.content)     as content,
      coalesce(1.0 / (60 + v.rank), 0)
      + coalesce(1.0 / (60 + f.rank), 0)     as rrf_score
    from vector_ranked v
    full outer join fts_ranked f on v.id = f.id
  )
  select *
  from rrf
  order by rrf_score desc
  limit p_limit;
$$;

create or replace function public.memory_search(
  p_account_id uuid,
  p_embedding  vector,
  p_limit      integer default 5
)
returns table (
  id         uuid,
  content    text,
  importance double precision,
  similarity double precision
)
language sql
stable
as $$
  select id, content, importance,
         1 - (embedding <=> p_embedding) as similarity
  from public.memory_long
  where account_id = p_account_id
  order by embedding <=> p_embedding
  limit p_limit;
$$;

-- ============================================================
-- Triggers
-- ============================================================

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.bootstrap_workspace();

drop trigger if exists trg_touch_chat_session on public.chat_messages;
create trigger trg_touch_chat_session
  after insert on public.chat_messages
  for each row execute function public.touch_chat_session();
