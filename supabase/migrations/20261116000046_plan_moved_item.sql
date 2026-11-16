-- 0046 A moved item drops its stale AI timings (fix after Task 13.6).
--
-- When an event or task's timing changes (start, end, due, all day, repeat) or
-- it is closed or deleted, its pending AI plan nudges were worked out for the
-- old time; they are cancelled at once, and the plan queue (0042) writes the
-- defaults for the new time within a minute. The planner improves on them at
-- its next run. The owner's own nudges (source 'user') are never touched.
-- upsert_plan_nudge v3: a default yields only to a *pending* AI or owner nudge,
-- so it can take the place of a cancelled AI one.

create or replace function public.item_plan_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type in ('event', 'task') then
    if tg_op = 'UPDATE' and (
         new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at
         or new.due_at is distinct from old.due_at or new.all_day is distinct from old.all_day
         or new.rrule is distinct from old.rrule or new.status is distinct from old.status
         or new.deleted_at is distinct from old.deleted_at) then
      update public.nudges set status = 'cancelled'
       where user_id = new.user_id and item_id = new.id and status = 'pending'
         and source = 'ai' and dedupe_key like 'plan:%';
    end if;
    perform public.refresh_plan_nudges(new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.item_plan_queue() from public, anon, authenticated;

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
  v_status text;
begin
  select source, status into v_source, v_status
    from public.nudges where user_id = p_user_id and dedupe_key = p_key;
  if p_source = 'default' and v_source in ('ai', 'user') and v_status = 'pending' then
    return;
  end if;
  if p_source <> 'user' and v_source = 'user' and v_status = 'pending' then
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
          -- A cancelled AI nudge taken over by a default; a dismissed one stays dismissed.
          when public.nudges.status = 'cancelled' and public.nudges.source <> excluded.source
            then 'pending'
          else public.nudges.status end,
        sent_at = case
          when public.nudges.send_at <> excluded.send_at then null
          else public.nudges.sent_at end;
end;
$$;
revoke all on function public.upsert_plan_nudge(uuid, text, text, uuid, timestamptz, text, text,
  text, text, text, text, uuid) from public, anon, authenticated;
