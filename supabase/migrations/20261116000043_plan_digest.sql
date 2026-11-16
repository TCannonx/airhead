-- 0043 Planner digest (Task 13.5): the raw rows the evening planner needs for
-- the 7 days after p_local_date (the evening's own date). Shaping, repeating
-- occurrences, the "needs lead time" filter and the 60-item cap are in code
-- (supabase/functions/plan-day/digest.ts), as with morning_digest.

create or replace function public.plan_digest(p_user_id uuid, p_local_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := public.user_time_zone(p_user_id);
  v_from timestamptz := ((p_local_date + 1)::timestamp) at time zone v_tz;
  v_to timestamptz := ((p_local_date + 8)::timestamp) at time zone v_tz;
  v_out jsonb;
begin
  with plans as (
    select p.item_id, p.surface_at, p.effort_minutes, p.prep, p.reason, p.source
      from public.item_plans p
     where p.user_id = p_user_id and p.deleted_at is null
  ), wanted as (
    -- One-off events and tasks in the window, and every open repeating event.
    select i.* from public.items i
     where i.user_id = p_user_id and i.status = 'open' and i.deleted_at is null
       and ((i.type = 'event' and i.start_at is not null
              and (i.rrule is not null or (i.start_at >= v_from and i.start_at < v_to)))
         or (i.type = 'task' and ((i.due_at >= v_from and i.due_at < v_to)
              or exists (select 1 from plans p where p.item_id = i.id
                          and p.surface_at >= v_from and p.surface_at < v_to))))
     order by coalesce(i.start_at, i.due_at)
     limit 200
  )
  select jsonb_build_object(
    'date', p_local_date,
    'time_zone', v_tz,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'type', w.type, 'title', left(w.title, 120),
        'start_at', w.start_at, 'end_at', w.end_at, 'due_at', w.due_at,
        'all_day', w.all_day, 'rrule', w.rrule,
        'exdates', coalesce(w.data -> 'exdates', '[]'::jsonb),
        'location', nullif(left(w.data ->> 'location', 80), ''),
        'travel_minutes', case when jsonb_typeof(w.data -> 'travel_minutes') = 'number'
                               then (w.data ->> 'travel_minutes')::numeric end,
        'plan', (select jsonb_build_object('surface_at', p.surface_at, 'effort_minutes', p.effort_minutes,
                                           'prep', p.prep, 'reason', p.reason, 'source', p.source)
                   from plans p where p.item_id = w.id)))
      from wanted w), '[]'::jsonb),
    'linked', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', left(e.title, 120),
               'start_at', e.start_at, 'end_at', e.end_at, 'all_day', e.all_day) order by e.start_at)
      from (select e.* from public.external_events e
              join public.feeds f on f.id = e.feed_id and f.enabled and f.deleted_at is null
             where e.user_id = p_user_id and e.deleted_at is null
               and e.start_at >= v_from - interval '12 hours' and e.start_at < v_to
             order by e.start_at limit 60) e), '[]'::jsonb),
    'nudges', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', n.item_id, 'kind', n.kind, 'send_at', n.send_at,
               'source', n.source, 'dedupe_key', n.dedupe_key) order by n.send_at)
      from (select n.* from public.nudges n
             where n.user_id = p_user_id and n.status = 'pending' and n.deleted_at is null
               and n.item_id is not null and n.send_at < v_to
             order by n.send_at limit 200) n), '[]'::jsonb),
    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('start', b.start_date, 'end', b.end_date,
               'start_half', b.start_half, 'end_half', b.end_half))
      from public.leave_bookings b
      where b.user_id = p_user_id and b.deleted_at is null
        and b.end_date >= p_local_date + 1 and b.start_date <= p_local_date + 7), '[]'::jsonb),
    'work_days', coalesce((
      select jsonb_agg(jsonb_build_object('date', w.date, 'location', w.location))
      from public.work_days w
      where w.user_id = p_user_id and w.deleted_at is null
        and w.date between p_local_date + 1 and p_local_date + 7), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.plan_digest(uuid, date) from public, anon, authenticated;
grant execute on function public.plan_digest(uuid, date) to service_role;
