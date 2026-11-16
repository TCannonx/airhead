-- 0041 Plan tables and nudge columns (Task 13.2, Phase 13 "The planner").
-- Spec: docs/superpowers/specs/2026-11-16-ai-brain.md section 3.
--
-- item_plans: one plan per item (when to surface it, effort, needs, prep,
--   reading slot, reason, confidence, default or ai). Synced to the device,
--   which only reads it; only the service role writes (as nudges and external_events).
-- plan_runs: one row per planner run (evening, morning, replan, weekly,
--   learning, defaults). Not synced; the owner reads it through plan_runs_daily.
-- nudges: reason, source, delivery, plan_run_id and the outcome columns; new
--   kinds prepare, leave, do, follow_up, reading. Additive only.

create table public.item_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null,
  surface_at timestamptz,
  effort_minutes integer check (effort_minutes is null or effort_minutes between 0 and 10080),
  needs jsonb not null default '[]'::jsonb,
  prep jsonb not null default '[]'::jsonb,
  reading_slot text check (reading_slot is null
    or reading_slot in ('commute', 'lunch', 'evening', 'weekend')),
  reason text not null default '',
  confidence numeric check (confidence is null or confidence between 0 and 1),
  source text not null default 'default' check (source in ('default', 'ai')),
  plan_run_id uuid,
  planned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint item_plans_item unique (item_id)
);
create trigger set_server_updated_at before insert or update on public.item_plans
  for each row execute function public.set_server_updated_at();
create index item_plans_sync_idx on public.item_plans (user_id, server_updated_at);
alter table public.item_plans enable row level security;
create policy "own rows: select" on public.item_plans for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.item_plans from anon;
revoke insert, update, delete on public.item_plans from authenticated;
grant select on public.item_plans to authenticated;
alter publication supabase_realtime add table public.item_plans;

create table public.plan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('evening', 'morning', 'replan', 'weekly', 'learning', 'defaults')),
  local_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'ok', 'failed', 'cap_reached', 'skipped')),
  items_considered integer not null default 0,
  nudges_written integer not null default 0,
  lookups_used integer not null default 0,
  cost_eur numeric not null default 0,
  error text,
  summary jsonb not null default '{}'::jsonb
);
-- An evening or morning run happens once per user per local day.
create unique index plan_runs_once_a_day on public.plan_runs (user_id, kind, local_date)
  where kind in ('evening', 'morning');
create index plan_runs_user_date_idx on public.plan_runs (user_id, local_date);
alter table public.plan_runs enable row level security;
create policy "own rows: select" on public.plan_runs for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.plan_runs from anon;
revoke insert, update, delete on public.plan_runs from authenticated;
grant select on public.plan_runs to authenticated;

-- Insights reads one row per day and run kind (Task 17.4 builds on it).
create view public.plan_runs_daily with (security_invoker = true) as
  select user_id, local_date, kind,
         count(*)::integer as runs,
         count(*) filter (where status = 'ok')::integer as ok_runs,
         count(*) filter (where status = 'cap_reached')::integer as capped_runs,
         sum(nudges_written)::integer as nudges_written,
         sum(lookups_used)::integer as lookups_used,
         sum(cost_eur) as cost_eur
    from public.plan_runs
   group by user_id, local_date, kind;
revoke all on public.plan_runs_daily from anon;
grant select on public.plan_runs_daily to authenticated;

alter table public.nudges
  add column reason text,
  add column source text not null default 'rule' check (source in ('rule', 'default', 'ai', 'user')),
  add column delivery text not null default 'push' check (delivery in ('push', 'digest')),
  add column plan_run_id uuid,
  add column outcome text check (outcome is null or outcome in ('acted', 'snoozed', 'dismissed', 'ignored')),
  add column outcome_at timestamptz,
  add column snoozed_to timestamptz;

-- Superset of 0028's kinds.
alter table public.nudges drop constraint nudges_kind_check;
alter table public.nudges add constraint nudges_kind_check check (kind in (
  'event_reminder', 'task_due', 'prep', 'checklist', 'evening_review', 'leave_runout',
  'slip', 'check_time', 'summary', 'test', 'morning_brief', 'weekly_review', 'scout',
  'prepare', 'leave', 'do', 'follow_up', 'reading'));

-- Devices now mirror nudges (pull-only) to show "Why now?" (Task 13.8).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nudges') then
    alter publication supabase_realtime add table public.nudges;
  end if;
end;
$$;
