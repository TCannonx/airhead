-- 0025 Weekly digest (Task 8.1): the week's numbers for the weekly review and
-- Patterns, computed in SQL for free, as compact JSON. Titles only, capped
-- lists, in the person's time zone. The week runs Monday to Sunday.

create or replace function public.weekly_digest(p_user_id uuid, p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text := public.user_time_zone(p_user_id);
  v_start timestamptz := (p_week_start::timestamp) at time zone v_tz;
  v_end timestamptz := ((p_week_start + 7)::timestamp) at time zone v_tz;
  v_out jsonb;
begin
  select jsonb_build_object(
    'week_start', p_week_start,
    'week_end', p_week_start + 6,
    'time_zone', v_tz,

    'tasks', jsonb_build_object(
      -- Due this week (or added this week with no date), and how many were done.
      'due', (select count(*) from public.items i
               where i.user_id = p_user_id and i.type = 'task' and i.deleted_at is null
                 and i.due_at >= v_start and i.due_at < v_end),
      'done', (select count(*) from public.items i
                where i.user_id = p_user_id and i.type = 'task' and i.deleted_at is null
                  and i.completed_at >= v_start and i.completed_at < v_end),
      'done_on_time', (select count(*) from public.items i
                where i.user_id = p_user_id and i.type = 'task' and i.deleted_at is null
                  and i.completed_at >= v_start and i.completed_at < v_end
                  and (i.due_at is null or i.completed_at <= i.due_at + interval '1 day')),
      'added', (select count(*) from public.items i
                 where i.user_id = p_user_id and i.type = 'task' and i.deleted_at is null
                   and i.created_at >= v_start and i.created_at < v_end),
      'carried', (select count(*) from public.items i
                   where i.user_id = p_user_id and i.type = 'task' and i.deleted_at is null
                     and i.status = 'open' and i.carry_count > 0
                     and i.due_at < v_end)
    ),

    -- Open tasks that were due this week and slipped, most carried first.
    'slipped', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', i.id, 'title', left(i.title, 120), 'carried', i.carry_count) as x
          from public.items i
         where i.user_id = p_user_id and i.type = 'task' and i.status = 'open'
           and i.deleted_at is null and i.due_at >= v_start and i.due_at < v_end
         order by i.carry_count desc, i.due_at
         limit 15) s), '[]'::jsonb),

    -- Topics whose tasks slip most (open and overdue at week end).
    'slipping_topics', coalesce((
      select jsonb_agg(jsonb_build_object('topic', t.name, 'count', n) order by n desc) from (
        select tp.topic_id, count(*) as n
          from public.items i, unnest(i.topic_ids) as tp(topic_id)
         where i.user_id = p_user_id and i.type = 'task' and i.status = 'open'
           and i.deleted_at is null and i.due_at < v_end
         group by tp.topic_id
         order by n desc
         limit 5) c
      join public.topics t on t.id = c.topic_id), '[]'::jsonb),

    'captures', (select count(*) from public.captures c
                  where c.user_id = p_user_id and c.deleted_at is null
                    and c.captured_at >= v_start and c.captured_at < v_end),

    -- 24 counts each, local hours 0–23.
    'capture_hours', (select jsonb_agg(coalesce(n, 0) order by h) from generate_series(0, 23) h
      left join (select extract(hour from c.captured_at at time zone v_tz)::int as hr, count(*) as n
                   from public.captures c
                  where c.user_id = p_user_id and c.deleted_at is null
                    and c.captured_at >= v_start and c.captured_at < v_end
                  group by 1) x on x.hr = h),
    'completion_hours', (select jsonb_agg(coalesce(n, 0) order by h) from generate_series(0, 23) h
      left join (select extract(hour from i.completed_at at time zone v_tz)::int as hr, count(*) as n
                   from public.items i
                  where i.user_id = p_user_id and i.type = 'task' and i.deleted_at is null
                    and i.completed_at >= v_start and i.completed_at < v_end
                  group by 1) x on x.hr = h),
    -- Monday first, 7 counts.
    'completion_weekdays', (select jsonb_agg(coalesce(n, 0) order by d) from generate_series(1, 7) d
      left join (select extract(isodow from i.completed_at at time zone v_tz)::int as dw, count(*) as n
                   from public.items i
                  where i.user_id = p_user_id and i.type = 'task' and i.deleted_at is null
                    and i.completed_at >= v_start and i.completed_at < v_end
                  group by 1) x on x.dw = d),

    -- Ideas that captures kept coming back to this week.
    'returning_ideas', coalesce((
      select jsonb_agg(jsonb_build_object('id', idea.id, 'title', left(idea.title, 120), 'returns', n) order by n desc)
        from (select (i.data ->> 'related_idea_id')::uuid as idea_id, count(*) as n
                from public.items i
               where i.user_id = p_user_id and i.deleted_at is null
                 and i.data ? 'related_idea_id'
                 and i.created_at >= v_start and i.created_at < v_end
               group by 1
               order by n desc
               limit 5) r
        join public.items idea on idea.id = r.idea_id and idea.user_id = p_user_id), '[]'::jsonb),

    'ideas_added', (select count(*) from public.items i
                     where i.user_id = p_user_id and i.type = 'idea' and i.deleted_at is null
                       and i.created_at >= v_start and i.created_at < v_end),

    'notifications', jsonb_build_object(
      'sent', (select count(*) from public.nudges n
                where n.user_id = p_user_id and n.status = 'sent'
                  and n.sent_at >= v_start and n.sent_at < v_end),
      'bundled', (select count(*) from public.nudges n
                   where n.user_id = p_user_id and n.status = 'bundled'
                     and n.send_at >= v_start and n.send_at < v_end)
    ),

    'ai', jsonb_build_object(
      'cost_eur', (select coalesce(round(sum(u.cost_eur)::numeric, 4), 0) from public.ai_usage u
                    where u.user_id = p_user_id and u.created_at >= v_start and u.created_at < v_end),
      'calls', (select count(*) from public.ai_usage u
                 where u.user_id = p_user_id and u.created_at >= v_start and u.created_at < v_end),
      'by_task', coalesce((
        select jsonb_agg(jsonb_build_object('task', task, 'cost_eur', cost) order by cost desc) from (
          select u.task, round(sum(u.cost_eur)::numeric, 4) as cost from public.ai_usage u
           where u.user_id = p_user_id and u.created_at >= v_start and u.created_at < v_end
           group by u.task) t), '[]'::jsonb)
    )
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.weekly_digest(uuid, date) from public, anon, authenticated;
grant execute on function public.weekly_digest(uuid, date) to service_role;
