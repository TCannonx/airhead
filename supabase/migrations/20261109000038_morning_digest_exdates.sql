-- 0038 Morning digest honours single-occurrence changes (2026-11-09): a
-- repeating event's deleted or changed occurrences (data.exdates, Task 11.5)
-- now go to the brief with the series, so the brief no longer mentions an
-- occurrence that was deleted. A changed occurrence is its own one-off event
-- and already appears under 'events'. Same function as 0016 otherwise.

create or replace function public.morning_digest(p_user_id uuid, p_local_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := public.user_time_zone(p_user_id);
  v_day_start timestamptz := (p_local_date::timestamp) at time zone v_tz;
  v_week_end timestamptz := ((p_local_date + 8)::timestamp) at time zone v_tz;
  v_yesterday date := p_local_date - 1;
  v_out jsonb;
begin
  select jsonb_build_object(
    'date', p_local_date,
    'weekday', to_char(p_local_date, 'FMDay'),
    'time_zone', v_tz,

    -- Airhead events (not recurring) from today to 7 days ahead.
    'events', coalesce((
      select jsonb_agg(e order by e ->> 'date', coalesce(e ->> 'start', '')) from (
        select jsonb_build_object(
          'id', i.id,
          'title', left(i.title, 120),
          'date', (i.start_at at time zone v_tz)::date,
          'start', case when i.all_day then null else to_char(i.start_at at time zone v_tz, 'HH24:MI') end,
          'end', case when i.all_day or i.end_at is null then null else to_char(i.end_at at time zone v_tz, 'HH24:MI') end,
          'all_day', i.all_day,
          'calendar', coalesce(i.calendar, 'personal'),
          'location', nullif(left(i.data ->> 'location', 80), ''),
          'time_tbc', coalesce((i.data ->> 'time_tbc')::boolean, false)
        ) as e
        from public.items i
        where i.user_id = p_user_id and i.type = 'event' and i.status = 'open'
          and i.deleted_at is null and i.rrule is null and i.start_at is not null
          and i.start_at >= v_day_start and i.start_at < v_week_end
        order by i.start_at
        limit 60
      ) x), '[]'::jsonb),

    -- Recurring events: expanded by the function.
    'recurring', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', left(i.title, 120), 'start_at', i.start_at, 'end_at', i.end_at,
        'all_day', i.all_day, 'rrule', i.rrule, 'calendar', coalesce(i.calendar, 'personal'),
        'exdates', coalesce(i.data -> 'exdates', '[]'::jsonb)))
      from (select * from public.items i
             where i.user_id = p_user_id and i.type = 'event' and i.status = 'open'
               and i.deleted_at is null and i.rrule is not null and i.start_at is not null
             limit 40) i), '[]'::jsonb),

    -- Linked calendars (already one row per occurrence).
    'linked', coalesce((
      select jsonb_agg(x order by x ->> 'date', x ->> 'start') from (
        select jsonb_build_object(
          'title', left(e.title, 120),
          'date', case when e.all_day then (e.start_at at time zone 'UTC')::date
                       else (e.start_at at time zone v_tz)::date end,
          'start', case when e.all_day then null else to_char(e.start_at at time zone v_tz, 'HH24:MI') end,
          'end', case when e.all_day or e.end_at is null then null else to_char(e.end_at at time zone v_tz, 'HH24:MI') end,
          'calendar', f.name
        ) as x
        from public.external_events e
        join public.feeds f on f.id = e.feed_id and f.enabled and f.deleted_at is null
        where e.user_id = p_user_id and e.deleted_at is null
          and e.start_at >= v_day_start - interval '12 hours' and e.start_at < v_week_end
        order by e.start_at
        limit 40
      ) y), '[]'::jsonb),

    -- Open tasks: overdue and due first, then Top 3, then the rest by age.
    'tasks', coalesce((
      select jsonb_agg(t order by ord) from (
        select jsonb_build_object(
          'id', i.id,
          'title', left(i.title, 120),
          'due', case when i.due_at is null then null
                      else to_char(i.due_at at time zone v_tz, 'YYYY-MM-DD HH24:MI') end,
          'top3', i.top3_date = p_local_date,
          'carry_count', i.carry_count,
          'age_days', p_local_date - (i.created_at at time zone v_tz)::date
        ) as t,
        row_number() over (order by
          (i.due_at is not null and i.due_at < v_day_start + interval '1 day') desc,
          i.top3_date = p_local_date desc nulls last,
          i.carry_count desc,
          i.due_at nulls last,
          i.created_at) as ord
        from public.items i
        where i.user_id = p_user_id and i.type = 'task' and i.status = 'open' and i.deleted_at is null
        order by ord
        limit 60
      ) z), '[]'::jsonb),

    'yesterday', jsonb_build_object(
      'done', (select count(*) from public.items i
                where i.user_id = p_user_id and i.type = 'task' and i.status = 'done' and i.deleted_at is null
                  and (i.completed_at at time zone v_tz)::date = v_yesterday),
      'unfinished_top3', (select count(*) from public.items i
                where i.user_id = p_user_id and i.type = 'task' and i.status = 'open' and i.deleted_at is null
                  and i.top3_date = v_yesterday),
      'captured', (select count(*) from public.captures c
                where c.user_id = p_user_id and c.deleted_at is null
                  and (c.captured_at at time zone v_tz)::date = v_yesterday)
    ),

    'leave', coalesce((
      select jsonb_agg(jsonb_build_object('start', b.start_date, 'end', b.end_date, 'type', b.leave_type,
                                          'status', b.status, 'start_half', b.start_half, 'end_half', b.end_half))
      from public.leave_bookings b
      where b.user_id = p_user_id and b.deleted_at is null
        and b.end_date >= p_local_date and b.start_date <= p_local_date + 7), '[]'::jsonb),

    'work_days', coalesce((
      select jsonb_agg(jsonb_build_object('date', w.date, 'location', w.location))
      from public.work_days w
      where w.user_id = p_user_id and w.deleted_at is null
        and w.date between p_local_date and p_local_date + 7), '[]'::jsonb),

    'ideas', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'title', left(i.title, 120)))
      from (select * from public.items i
             where i.user_id = p_user_id and i.type = 'idea' and i.status = 'open' and i.deleted_at is null
             order by i.updated_at desc limit 10) i), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.morning_digest(uuid, date) from public, anon, authenticated;
grant execute on function public.morning_digest(uuid, date) to service_role;
