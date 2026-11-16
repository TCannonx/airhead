-- 0045 "Why now?" and snooze (Task 13.8).
--
-- public.nudge_outcome(nudge, outcome, snooze_to): the owner's answer to a
-- nudge, from the sheet a notification opens. acted / dismissed record the
-- outcome (and cancel it if it has not gone out yet); snoozed records the new
-- time and writes a new nudge with source 'user' (key snooze:<nudge id>), which
-- the planner and the defaults never overwrite. Owner only.
-- public.mark_ignored_nudges(): a nudge sent and untouched for 12 hours becomes
-- 'ignored' (called by the scheduler tick).

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
  return jsonb_build_object('ok', true, 'snooze_id', v_new);
end;
$$;
revoke all on function public.nudge_outcome(uuid, text, timestamptz) from public, anon;
grant execute on function public.nudge_outcome(uuid, text, timestamptz) to authenticated;

create or replace function public.mark_ignored_nudges()
returns integer
language sql
security definer
set search_path = ''
as $$
  with done as (
    update public.nudges
       set outcome = 'ignored', outcome_at = now()
     where status = 'sent' and outcome is null and sent_at < now() - interval '12 hours'
       and sent_at > now() - interval '7 days'
       and kind in ('prepare', 'leave', 'do', 'follow_up', 'reading')
    returning 1)
  select count(*)::integer from done;
$$;
revoke all on function public.mark_ignored_nudges() from public, anon, authenticated;
