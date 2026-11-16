-- 0047 Day summaries (Task 14.1, Phase 14 "History the planner can reach").
--
-- day_digests: one short summary per person per local day (at most 120 words)
-- and the ids of the items it came from. Synced to the device, which only reads
-- it; only the service role writes. Built nightly at 03:10 local by
-- scheduler-tick from public.day_digest_source (one small AI call; a day with
-- nothing gets a fixed "Nothing recorded" and no call).
-- When an item that a summary came from changes (within 30 days), the summary is
-- marked stale and rebuilt the next night from sources, never patched.

create table public.day_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  digest text not null default '',
  item_ids uuid[] not null default '{}',
  stale boolean not null default false,
  built_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint day_digests_one_a_day unique (user_id, local_date)
);
create trigger set_server_updated_at before insert or update on public.day_digests
  for each row execute function public.set_server_updated_at();
create index day_digests_sync_idx on public.day_digests (user_id, server_updated_at);
create index day_digests_items_idx on public.day_digests using gin (item_ids);
alter table public.day_digests enable row level security;
create policy "own rows: select" on public.day_digests for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.day_digests from anon;
revoke insert, update, delete on public.day_digests from authenticated;
grant select on public.day_digests to authenticated;
alter publication supabase_realtime add table public.day_digests;

-- What happened on one local day, compact, with ids: captured, done, attended, missed.
create or replace function public.day_digest_source(p_user_id uuid, p_local_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := public.user_time_zone(p_user_id);
  v_from timestamptz := (p_local_date::timestamp) at time zone v_tz;
  v_to timestamptz := ((p_local_date + 1)::timestamp) at time zone v_tz;
begin
  return jsonb_build_object(
    'date', p_local_date,
    'weekday', to_char(p_local_date, 'FMDay'),
    'captured', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'type', i.type, 'title', left(i.title, 100)))
      from (select * from public.items i
             where i.user_id = p_user_id and i.deleted_at is null
               and i.created_at >= v_from and i.created_at < v_to
             order by i.created_at limit 30) i), '[]'::jsonb),
    'done', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', left(i.title, 100)))
      from (select * from public.items i
             where i.user_id = p_user_id and i.deleted_at is null and i.status = 'done'
               and i.completed_at >= v_from and i.completed_at < v_to
             order by i.completed_at limit 30) i), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', left(i.title, 100),
               'time', case when i.all_day then null else to_char(i.start_at at time zone v_tz, 'HH24:MI') end,
               'location', nullif(left(i.data ->> 'location', 60), '')))
      from (select * from public.items i
             where i.user_id = p_user_id and i.deleted_at is null and i.type = 'event'
               and i.status in ('open', 'done') and i.rrule is null
               and i.start_at >= v_from and i.start_at < v_to
             order by i.start_at limit 30) i), '[]'::jsonb),
    'missed', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', left(i.title, 100)))
      from (select * from public.items i
             where i.user_id = p_user_id and i.deleted_at is null and i.type = 'task'
               and i.status = 'open' and i.due_at >= v_from and i.due_at < v_to
             order by i.due_at limit 30) i), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.day_digest_source(uuid, date) from public, anon, authenticated;
grant execute on function public.day_digest_source(uuid, date) to service_role;

-- A change to an item a summary came from (within 30 days) marks that summary stale.
create or replace function public.item_day_digest_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.day_digests d set stale = true
   where d.user_id = new.user_id and not d.stale and new.id = any (d.item_ids)
     and d.local_date >= current_date - 30;
  return null;
end;
$$;
revoke all on function public.item_day_digest_stale() from public, anon, authenticated;

create trigger item_day_digest_stale
  after update of title, status, start_at, due_at, completed_at, deleted_at on public.items
  for each row execute function public.item_day_digest_stale();
