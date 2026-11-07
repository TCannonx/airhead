-- 0028 Scout (Task 8.9): a log of every Scout run (server-written, synced to
-- devices read-only so the queries can be shown) and the suggestion cards it
-- makes (synced both ways: devices accept or dismiss them).

create table public.scout_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger text not null check (trigger in ('weekly', 'manual')),
  -- The exact web search queries sent (interests and city only).
  queries jsonb not null default '[]'::jsonb,
  searches integer not null default 0,
  cards integer not null default 0,
  cost_eur numeric(10, 6) not null default 0,
  status text not null default 'ok' check (status in ('ok', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger set_server_updated_at before insert or update on public.scout_runs
  for each row execute function public.set_server_updated_at();
create index scout_runs_sync_idx on public.scout_runs (user_id, server_updated_at);
alter table public.scout_runs enable row level security;
create policy "own rows: select" on public.scout_runs for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.scout_runs from anon;
revoke insert, update, delete on public.scout_runs from authenticated;
grant select on public.scout_runs to authenticated;

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid,
  kind text not null check (kind in ('follow_up', 'prep', 'routine', 'stalled_idea', 'free_time', 'web')),
  title text not null,
  body text,
  source_url text,
  -- What accepting creates: { type: 'task' | 'event', title, due_at?, start_at?, end_at?, all_day? }
  proposed jsonb,
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger set_server_updated_at before insert or update on public.suggestions
  for each row execute function public.set_server_updated_at();
create index suggestions_sync_idx on public.suggestions (user_id, server_updated_at);
alter table public.suggestions enable row level security;
create policy "own rows: select" on public.suggestions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.suggestions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.suggestions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.suggestions for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.suggestions from anon;
grant select, insert, update, delete on public.suggestions to authenticated;

alter publication supabase_realtime add table public.scout_runs;
alter publication supabase_realtime add table public.suggestions;

-- Scout's "N ideas for you" notification is a nudge kind of its own.
alter table public.nudges drop constraint nudges_kind_check;
alter table public.nudges add constraint nudges_kind_check check (kind in (
  'event_reminder', 'task_due', 'prep', 'checklist', 'evening_review', 'leave_runout',
  'slip', 'check_time', 'summary', 'test', 'morning_brief', 'weekly_review', 'scout'));
