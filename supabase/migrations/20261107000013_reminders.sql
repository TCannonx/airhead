-- 0013 Reminder generation (Task 4.12). A trigger on items keeps each item's
-- nudges in step once the item has synced:
--   event reminder   N minutes before (settings.data.notifications.event_reminder_minutes,
--                    default 30; per event: items.data.reminder_minutes, a number or "none")
--   task reminder    at the task's due time
--   time-TBC check   10:00 local, 7 days before an all-day event marked time_tbc
-- Completing, dropping or deleting an item cancels its pending nudges. Recurring
-- events are left to the scheduler, which plans their next occurrences (4.13).
-- Quiet hours, caps and per-type switches are applied when sending (4.13).

create or replace function public.user_time_zone(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.data ->> 'time_zone' from public.settings s where s.id = p_user_id),
    'Europe/Dublin');
$$;
revoke all on function public.user_time_zone(uuid) from public, anon, authenticated;

/** Creates or moves a nudge by key; a moved one is armed again. */
create or replace function public.upsert_nudge(
  p_user_id uuid, p_key text, p_kind text, p_item_id uuid, p_send_at timestamptz,
  p_title text, p_body text, p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_send_at <= now() then
    -- Too late to remind: drop a pending one rather than send it late.
    update public.nudges set status = 'cancelled'
     where user_id = p_user_id and dedupe_key = p_key and status = 'pending';
    return;
  end if;
  insert into public.nudges (user_id, kind, item_id, send_at, title, body, url, dedupe_key)
  values (p_user_id, p_kind, p_item_id, p_send_at, p_title, p_body, p_url, p_key)
  on conflict (user_id, dedupe_key) do update
    set send_at = excluded.send_at,
        title = excluded.title,
        body = excluded.body,
        url = excluded.url,
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
revoke all on function public.upsert_nudge(uuid, text, text, uuid, timestamptz, text, text, text)
  from public, anon, authenticated;

create or replace function public.cancel_nudge(p_user_id uuid, p_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.nudges set status = 'cancelled'
   where user_id = p_user_id and dedupe_key = p_key and status = 'pending';
$$;
revoke all on function public.cancel_nudge(uuid, text) from public, anon, authenticated;

create or replace function public.item_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text := public.user_time_zone(new.user_id);
  v_default integer;
  v_minutes integer;
  v_raw text;
  v_live boolean := new.deleted_at is null and new.status = 'open';
  v_where text := nullif(trim(coalesce(new.data ->> 'location', '')), '');
begin
  -- Event reminder ---------------------------------------------------------------
  if new.type = 'event' and v_live and new.start_at is not null and not new.all_day
     and new.rrule is null then
    select coalesce((s.data -> 'notifications' ->> 'event_reminder_minutes')::integer, 30)
      into v_default from public.settings s where s.id = new.user_id;
    v_default := coalesce(v_default, 30);
    v_raw := new.data ->> 'reminder_minutes';
    if v_raw = 'none' then
      perform public.cancel_nudge(new.user_id, 'event:' || new.id);
    else
      v_minutes := case when v_raw ~ '^\d{1,4}$' then v_raw::integer else v_default end;
      perform public.upsert_nudge(
        new.user_id, 'event:' || new.id, 'event_reminder', new.id,
        new.start_at - make_interval(mins => v_minutes),
        new.title,
        case when v_minutes = 0 then 'Now' else 'In ' || v_minutes || ' min' end
          || ' · ' || to_char(new.start_at at time zone v_tz, 'HH24:MI')
          || coalesce(' · ' || v_where, ''),
        '/calendar');
    end if;
  else
    perform public.cancel_nudge(new.user_id, 'event:' || new.id);
  end if;

  -- "Check the time" for an all-day time-TBC event ----------------------------------
  if new.type = 'event' and v_live and new.all_day and new.start_at is not null
     and coalesce((new.data ->> 'time_tbc')::boolean, false) then
    perform public.upsert_nudge(
      new.user_id, 'tbc:' || new.id, 'check_time', new.id,
      (((new.start_at at time zone v_tz)::date - 7) + time '10:00') at time zone v_tz,
      'Time confirmed yet? ' || new.title,
      'On ' || to_char(new.start_at at time zone v_tz, 'Dy DD Mon') || ': check the time and add it.',
      '/calendar');
  else
    perform public.cancel_nudge(new.user_id, 'tbc:' || new.id);
  end if;

  -- Task reminder at the due time --------------------------------------------------------
  if new.type = 'task' and v_live and new.due_at is not null then
    perform public.upsert_nudge(
      new.user_id, 'task:' || new.id, 'task_due', new.id, new.due_at,
      'Due: ' || new.title,
      to_char(new.due_at at time zone v_tz, 'HH24:MI'),
      '/library/item/' || new.id);
  else
    perform public.cancel_nudge(new.user_id, 'task:' || new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.item_reminders() from public, anon, authenticated;

create trigger item_reminders
  after insert or update of type, title, data, status, start_at, end_at, all_day, rrule, due_at, deleted_at
  on public.items
  for each row execute function public.item_reminders();
