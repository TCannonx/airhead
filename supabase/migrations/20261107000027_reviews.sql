-- 0027 Weekly reviews (Task 8.3): one per person per week (Monday start),
-- written by the server (weekly-review), synced to devices read-only like
-- briefs. `digest` is the week in a paragraph, read by later briefs and
-- reviews (Task 8.5).

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  -- ok = written by the AI; fallback = numbers only (AI failed or capped).
  status text not null check (status in ('ok', 'fallback')),
  -- { themes, wins, slipped, suggestions, tidy: [...], auto_done: [...], facts: [...], ai, stats }
  content jsonb not null default '{}'::jsonb,
  digest text,
  cost_eur numeric(10, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint reviews_one_per_week unique (user_id, week_start)
);

create trigger set_server_updated_at before insert or update on public.reviews
  for each row execute function public.set_server_updated_at();
create index reviews_sync_idx on public.reviews (user_id, server_updated_at);

alter table public.reviews enable row level security;
create policy "own rows: select" on public.reviews for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.reviews from anon;
revoke insert, update, delete on public.reviews from authenticated;
grant select on public.reviews to authenticated;

alter publication supabase_realtime add table public.reviews;

-- The "weekly review ready" notification is a nudge kind of its own.
alter table public.nudges drop constraint nudges_kind_check;
alter table public.nudges add constraint nudges_kind_check check (kind in (
  'event_reminder', 'task_due', 'prep', 'checklist', 'evening_review', 'leave_runout',
  'slip', 'check_time', 'summary', 'test', 'morning_brief', 'weekly_review'));
