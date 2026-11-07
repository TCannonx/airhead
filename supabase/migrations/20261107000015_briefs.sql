-- 0015 Morning briefs (Task 5.1): one per person per local day, written by the
-- server (morning-brief), synced to devices read-only like external_events.

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  -- ok = written by the AI; fallback = the code-built list (AI failed or capped).
  status text not null check (status in ('ok', 'fallback')),
  -- { reflection, top3: [{item_id, title, why, minutes, slot}], also_today: [item_id], prep: [...] }
  content jsonb not null default '{}'::jsonb,
  model text,
  cost_eur numeric(10, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint briefs_one_per_day unique (user_id, local_date)
);

create trigger set_server_updated_at before insert or update on public.briefs
  for each row execute function public.set_server_updated_at();
create index briefs_sync_idx on public.briefs (user_id, server_updated_at);

alter table public.briefs enable row level security;
create policy "own rows: select" on public.briefs for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.briefs from anon;
revoke insert, update, delete on public.briefs from authenticated;
grant select on public.briefs to authenticated;

alter publication supabase_realtime add table public.briefs;

-- Keep briefs for a year; the purge also covers soft-deleted ones.
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
                           'nudges', 'briefs'] loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - interval ''30 days''', t);
  end loop;
  delete from public.job_runs where local_date < current_date - 90;
  delete from public.briefs where local_date < current_date - 366;
end;
$$;
