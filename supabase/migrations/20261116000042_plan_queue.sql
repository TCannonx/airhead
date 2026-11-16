-- 0042 Defaults applied on save (Task 13.3).
--
-- A change to an event or task's timing, status or title queues it in
-- plan_queue (one row per item). scheduler-tick drains the queue every minute
-- and writes default nudges (code: _shared/plan/defaults.ts) through
-- upsert_plan_nudge, keyed plan:<kind>:<item id>:<local date>.
-- The owner's keyword prep rules (prep:<rule id>:<item id>) are untouched.

create table public.plan_queue (
  item_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Why it was queued: changed now; snoozed and missed come with re-plan (Task 15.3).
  reason text not null default 'changed' check (reason in ('changed', 'snoozed', 'missed')),
  queued_at timestamptz not null default now()
);
create index plan_queue_queued_idx on public.plan_queue (queued_at);
alter table public.plan_queue enable row level security;
-- No policies: only the service role reads or writes the queue.
revoke all on public.plan_queue from anon, authenticated;

-- Queues an item for default timings (also callable by hand to refresh one item).
create or replace function public.refresh_plan_nudges(p_item_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.plan_queue (item_id, user_id)
  select i.id, i.user_id from public.items i
   where i.id = p_item_id and i.type in ('event', 'task')
  on conflict (item_id) do update set queued_at = now(), reason = 'changed';
$$;
revoke all on function public.refresh_plan_nudges(uuid) from public, anon, authenticated;

create or replace function public.item_plan_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type in ('event', 'task') then
    perform public.refresh_plan_nudges(new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.item_plan_queue() from public, anon, authenticated;

create trigger item_plan_queue
  after insert or update of start_at, end_at, due_at, all_day, rrule, status, deleted_at, title, data
  on public.items
  for each row execute function public.item_plan_queue();

-- Writes a planner nudge. A 'default' never replaces an 'ai' or 'user' nudge
-- with the same key; a time already past cancels a pending one instead
-- (as upsert_nudge does).
create or replace function public.upsert_plan_nudge(
  p_user_id uuid, p_key text, p_kind text, p_item_id uuid, p_send_at timestamptz,
  p_title text, p_body text, p_url text, p_reason text, p_source text,
  p_delivery text default 'push', p_plan_run_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text;
begin
  select source into v_source from public.nudges where user_id = p_user_id and dedupe_key = p_key;
  if p_source = 'default' and v_source in ('ai', 'user') then
    return;
  end if;
  if p_send_at <= now() then
    update public.nudges set status = 'cancelled'
     where user_id = p_user_id and dedupe_key = p_key and status = 'pending';
    return;
  end if;
  insert into public.nudges (user_id, kind, item_id, send_at, title, body, url, dedupe_key,
                             reason, source, delivery, plan_run_id)
  values (p_user_id, p_kind, p_item_id, p_send_at, p_title, p_body, p_url, p_key,
          p_reason, p_source, p_delivery, p_plan_run_id)
  on conflict (user_id, dedupe_key) do update
    set kind = excluded.kind,
        send_at = excluded.send_at,
        title = excluded.title,
        body = excluded.body,
        url = excluded.url,
        reason = excluded.reason,
        source = excluded.source,
        delivery = excluded.delivery,
        plan_run_id = excluded.plan_run_id,
        deleted_at = null,
        status = case
          when public.nudges.status = 'pending' then 'pending'
          when public.nudges.send_at <> excluded.send_at then 'pending'
          else public.nudges.status end,
        sent_at = case
          when public.nudges.send_at <> excluded.send_at then null
          else public.nudges.sent_at end;
end;
$$;
revoke all on function public.upsert_plan_nudge(uuid, text, text, uuid, timestamptz, text, text,
  text, text, text, text, uuid) from public, anon, authenticated;

-- The tick also drains the plan queue, so it runs when the queue has work even
-- if nobody has a notification device (copy of 0014 with that one change).
create or replace function public.dispatch_scheduler_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return false;
  end if;
  if not exists (select 1 from public.devices
                  where receives_notifications and push_subscription is not null and deleted_at is null)
     and not exists (select 1 from public.plan_queue) then
    return false;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/scheduler-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  return true;
end;
$$;
revoke all on function public.dispatch_scheduler_tick() from public, anon, authenticated;
