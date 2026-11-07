-- 0009 Calendar, work and leave, sharing, notifications (Task 4.1; the plan's "0004").
--
-- Synced both ways (device writes, standard own-rows RLS): series, feeds, work_days,
-- leave_bookings. Synced to devices read-only (only server functions write):
-- external_events. Server-only (owner may read, functions write): nudges, job_runs.

create table public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  calendar text not null default 'personal' check (calendar in ('personal', 'us')),
  colour text,
  source_kind text not null default 'manual' check (source_kind in ('manual', 'import')),
  -- Storage path of the original import file: <user_id>/series/<id>/<name>
  source_path text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- us_out / me_out: published feeds (only the SHA-256 of the token is stored, hex).
-- linked_in: a calendar someone shares with me (its secret iCal URL).
create table public.feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('us_out', 'me_out', 'linked_in')),
  name text not null default '',
  colour text,
  token_hash text check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  url text,
  enabled boolean not null default true,
  -- e.g. { "location_sharing": "full" | "working" | "none" }
  settings jsonb not null default '{}'::jsonb,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint feeds_out_has_token check (kind = 'linked_in' or token_hash is not null),
  constraint feeds_in_has_url check (kind <> 'linked_in' or url is not null)
);
create unique index feeds_token_hash_idx on public.feeds (token_hash) where token_hash is not null;

-- One row per occurrence of a linked calendar's events (recurrences expanded).
create table public.external_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feed_id uuid not null references public.feeds (id) on delete cascade,
  -- iCal UID plus the occurrence's recurrence id/start: stable across fetches.
  occurrence_key text not null,
  title text not null default '',
  location text,
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint external_events_unique unique (feed_id, occurrence_key)
);

-- A day's work location when it differs from the weekly pattern. Devices use a
-- deterministic id per (user, date), so two devices never create two rows.
create table public.work_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  location text not null check (location in ('wfh', 'office', 'client', 'travel', 'off')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint work_days_unique unique (user_id, date)
);

create table public.leave_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  -- Half days: the first day starts at midday / the last day ends at midday.
  start_half boolean not null default false,
  end_half boolean not null default false,
  -- Key of a leave type in settings.data.work.leave_types ('annual', 'sick', ...).
  leave_type text not null default 'annual',
  status text not null default 'planned'
    check (status in ('planned', 'requested', 'approved', 'taken')),
  share_us boolean not null default false,
  -- Working days deducted, as computed on the device when saved (cached for SQL jobs).
  days numeric(5, 1),
  note text,
  capture_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint leave_bookings_range check (end_date >= start_date)
);

create table public.nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('event_reminder', 'task_due', 'prep', 'checklist',
    'evening_review', 'leave_runout', 'slip', 'check_time', 'summary', 'test')),
  item_id uuid,
  send_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'cancelled', 'bundled', 'failed')),
  title text not null,
  body text,
  -- In-app path opened on tap, e.g. /library/<id> or /review.
  url text,
  -- Generated nudges carry a key so re-generation updates instead of duplicating.
  dedupe_key text,
  sent_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint nudges_dedupe unique (user_id, dedupe_key)
);
create index nudges_due_idx on public.nudges (send_at) where status = 'pending';

-- Per-user local-date jobs (evening review, checklists, ...) run at most once a day.
create table public.job_runs (
  user_id uuid not null references auth.users (id) on delete cascade,
  job text not null,
  local_date date not null,
  ran_at timestamptz not null default now(),
  primary key (user_id, job, local_date)
);

-- Shared setup ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['series', 'feeds', 'external_events', 'work_days',
                           'leave_bookings', 'nudges'] loop
    execute format(
      'create trigger set_server_updated_at before insert or update on public.%I
         for each row execute function public.set_server_updated_at()', t);
    execute format('create index %I on public.%I (user_id, server_updated_at)', t || '_sync_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;

  -- Device-written tables: full own-rows access.
  foreach t in array array['series', 'feeds', 'work_days', 'leave_bookings'] loop
    execute format(
      'create policy "own rows: insert" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: update" on public.%I for update to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: delete" on public.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;

  -- Server-written tables: the owner may only read.
  foreach t in array array['external_events', 'nudges'] loop
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  foreach t in array array['series', 'feeds', 'external_events', 'work_days', 'leave_bookings'] loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end;
$$;

alter table public.job_runs enable row level security;
create policy "own rows: select" on public.job_runs for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.job_runs from anon;
revoke insert, update, delete on public.job_runs from authenticated;
grant select on public.job_runs to authenticated;

-- Claims a job for a user's local date; true only for the first caller.
create or replace function public.claim_job(p_user_id uuid, p_job text, p_local_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_runs (user_id, job, local_date) values (p_user_id, p_job, p_local_date)
  on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.claim_job(uuid, text, date) from public, anon, authenticated;

-- The nightly purge covers the new tables; job_runs older than 90 days go too.
create or replace function public.purge_soft_deleted()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  foreach t in array array['settings', 'devices', 'capture_tokens', 'captures', 'items',
                           'lists', 'topics', 'corrections', 'memory_facts', 'learned_rules',
                           'series', 'feeds', 'external_events', 'work_days', 'leave_bookings',
                           'nudges'] loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - interval ''30 days''', t);
  end loop;
  delete from public.job_runs where local_date < current_date - 90;
end;
$$;
