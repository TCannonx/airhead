-- 0054 Re-plan on change (Task 15.3).
--
-- plan_queue rows now outlive the defaults: the tick writes defaults at once
-- (defaults_done = true) and, when the planner is on, sends items that have
-- been quiet for 5 minutes to plan-day mode 'replan' (at most 10 items a run,
-- 6 runs a day), then removes them. The queue also records why an item was
-- queued: changed (any edit, 0042), snoozed (nudge_outcome) or missed (a
-- reminder ignored for 12 hours).

alter table public.plan_queue add column defaults_done boolean not null default false;
create index plan_queue_replan_idx on public.plan_queue (queued_at) where defaults_done;

-- Queues an item for defaults and re-planning, with the reason.
create or replace function public.queue_plan(p_item_id uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.plan_queue (item_id, user_id, reason)
  select i.id, i.user_id, p_reason from public.items i
   where i.id = p_item_id and i.type in ('event', 'task')
  on conflict (item_id) do update
    set queued_at = now(), reason = excluded.reason, defaults_done = false;
$$;
revoke all on function public.queue_plan(uuid, text) from public, anon, authenticated;

-- 0042's entry point, now through queue_plan (a change starts the debounce again).
create or replace function public.refresh_plan_nudges(p_item_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.queue_plan(p_item_id, 'changed');
$$;
revoke all on function public.refresh_plan_nudges(uuid) from public, anon, authenticated;

create or replace function public.nudge_outcome(
  p_nudge_id uuid, p_outcome text, p_snooze_to timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n public.nudges%rowtype;
  v_new uuid;
begin
  select * into v_n from public.nudges where id = p_nudge_id and user_id = (select auth.uid());
  if not found then
    raise exception 'nudge not found' using errcode = 'P0002';
  end if;
  if p_outcome not in ('acted', 'snoozed', 'dismissed') then
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  if p_outcome = 'snoozed' and (p_snooze_to is null or p_snooze_to <= now()) then
    raise exception 'snooze needs a time in the future' using errcode = '22023';
  end if;

  update public.nudges
     set outcome = p_outcome,
         outcome_at = now(),
         snoozed_to = case when p_outcome = 'snoozed' then p_snooze_to end,
         status = case when status = 'pending' then 'cancelled' else status end
   where id = v_n.id;

  if p_outcome = 'snoozed' then
    insert into public.nudges (user_id, kind, item_id, send_at, title, body, url, dedupe_key,
                               reason, source, delivery)
    values (v_n.user_id, v_n.kind, v_n.item_id, p_snooze_to, v_n.title, v_n.body, v_n.url,
            'snooze:' || v_n.id, 'You snoozed it to this time', 'user', 'push')
    on conflict (user_id, dedupe_key) do update
      set send_at = excluded.send_at, status = 'pending', sent_at = null, deleted_at = null,
          outcome = null, outcome_at = null, snoozed_to = null
    returning id into v_new;
  end if;
  -- A snooze asks the planner to look at the item again (Task 15.3).
  if p_outcome = 'snoozed' and v_n.item_id is not null then
    perform public.queue_plan(v_n.item_id, 'snoozed');
  end if;
  return jsonb_build_object('ok', true, 'snooze_id', v_new);
end;
$$;
revoke all on function public.nudge_outcome(uuid, text, timestamptz) from public, anon;
grant execute on function public.nudge_outcome(uuid, text, timestamptz) to authenticated;


create or replace function public.mark_ignored_nudges()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
  v_n integer := 0;
begin
  for v_item in
    update public.nudges
       set outcome = 'ignored', outcome_at = now()
     where status = 'sent' and outcome is null and sent_at < now() - interval '12 hours'
       and sent_at > now() - interval '7 days'
       and kind in ('prepare', 'leave', 'do', 'follow_up', 'reading')
    returning item_id
  loop
    v_n := v_n + 1;
    -- A missed reminder asks the planner to look at the item again (Task 15.3).
    if v_item is not null then
      perform public.queue_plan(v_item, 'missed');
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.mark_ignored_nudges() from public, anon, authenticated;
