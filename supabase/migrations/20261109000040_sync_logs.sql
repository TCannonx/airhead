-- 0040 Sync diary from devices (2026-11-09): each device sends a short log
-- of its sync runs (engine start/stop, run start/ok/error, stage reached,
-- abandoned runs) so a sync that goes quiet on a phone can be diagnosed from
-- the server, without asking the owner what the screen says.
-- Devices may only add their own rows; nobody reads them through the API
-- (the service role does, for support). Kept for 14 days.

create table public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  user_agent text,
  build text,
  entries jsonb not null default '[]'::jsonb
    check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) <= 200)
);
create index sync_logs_user_recent_idx on public.sync_logs (user_id, created_at desc);

alter table public.sync_logs enable row level security;
revoke all on public.sync_logs from public, anon, authenticated;
grant insert on public.sync_logs to authenticated;

create policy "own rows: insert" on public.sync_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

select cron.schedule(
  'sync-logs-cleanup',
  '17 3 * * *',
  $$delete from public.sync_logs where created_at < now() - interval '14 days'$$
);
