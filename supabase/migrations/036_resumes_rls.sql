alter table public.resumes enable row level security;

create policy "users can manage own resumes"
  on public.resumes for all
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);
