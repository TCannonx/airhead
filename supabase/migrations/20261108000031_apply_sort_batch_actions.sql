-- apply_sort_batch v3 (Task 10.5): also applies AI actions (Phase 10).
-- Items keep the id the planner gave them (a reminder action can point at one).
-- Each entry of p_plan.actions for a capture still being sorted is written to
-- ai_actions; an applied one first changes its target in this transaction:
--   settings       merge "after" into settings.data.work, only if every key
--                  still has its "before" value;
--   leave_bookings insert the booking, unless leave now overlaps it;
--   items          set the moved columns (start_at, end_at, all_day, due_at,
--                  data), only if the updated_at of the item still matches
--                  "before" (the reminder trigger re-times its nudges).
-- Anything that changed meanwhile is stored as a proposal instead.
-- (v2 also applies summaries of saved web pages; unchanged here.)
create or replace function public.apply_sort_batch(p_user_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_link_ids uuid[];
  v_open uuid[];
  v_links uuid[];
  v_topic text;
  v_item jsonb;
  v_cap jsonb;
  v_upd jsonb;
  v_topic_ids uuid[];
  v_items integer := 0;
  v_act jsonb;
  v_status text;
  v_reason text;
  v_cur jsonb;
  v_key text;
  v_actions integer := 0;
begin
  select coalesce(array_agg((c ->> 'id')::uuid), '{}')
    into v_ids
    from jsonb_array_elements(coalesce(p_plan -> 'captures', '[]'::jsonb)) as c;
  select coalesce(array_agg(x::uuid), '{}')
    into v_link_ids
    from jsonb_array_elements_text(coalesce(p_plan -> 'link_captures', '[]'::jsonb)) as x;

  perform 1 from public.captures
    where user_id = p_user_id and (id = any (v_ids) or id = any (v_link_ids))
    for update;
  select coalesce(array_agg(id), '{}') into v_open
    from public.captures
    where user_id = p_user_id and id = any (v_ids) and status = 'unsorted' and deleted_at is null;
  select coalesce(array_agg(id), '{}') into v_links
    from public.captures
    where user_id = p_user_id and id = any (v_link_ids)
      and (payload ->> 'summary_pending') = 'true' and deleted_at is null;

  for v_topic in select jsonb_array_elements_text(coalesce(p_plan -> 'new_topics', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.topics t
      where t.user_id = p_user_id and t.deleted_at is null and lower(t.name) = lower(v_topic)
    ) then
      insert into public.topics (user_id, name) values (p_user_id, v_topic);
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_plan -> 'items', '[]'::jsonb)) loop
    continue when not ((v_item ->> 'capture_id')::uuid = any (v_open || v_links));

    select coalesce(array_agg(t.id), '{}') into v_topic_ids
      from public.topics t
      where t.user_id = p_user_id and t.deleted_at is null
        and lower(t.name) in (
          select lower(x) from jsonb_array_elements_text(coalesce(v_item -> 'topic_names', '[]'::jsonb)) as x
        );

    insert into public.items (
      id, user_id, capture_id, type, title, body, status, start_at, end_at, all_day, due_at,
      rrule, calendar, list_id, topic_ids, confidence, data
    ) values (
      coalesce((v_item ->> 'id')::uuid, gen_random_uuid()),
      p_user_id,
      (v_item ->> 'capture_id')::uuid,
      v_item ->> 'type',
      coalesce(v_item ->> 'title', ''),
      v_item ->> 'body',
      coalesce(v_item ->> 'status', 'open'),
      (v_item ->> 'start_at')::timestamptz,
      (v_item ->> 'end_at')::timestamptz,
      coalesce((v_item ->> 'all_day')::boolean, false),
      (v_item ->> 'due_at')::timestamptz,
      v_item ->> 'rrule',
      v_item ->> 'calendar',
      (v_item ->> 'list_id')::uuid,
      v_topic_ids,
      (v_item ->> 'confidence')::real,
      coalesce(v_item -> 'data', '{}'::jsonb)
    );
    v_items := v_items + 1;
  end loop;

  for v_act in select * from jsonb_array_elements(coalesce(p_plan -> 'actions', '[]'::jsonb)) loop
    continue when not ((v_act ->> 'capture_id')::uuid = any (v_open));
    v_status := v_act ->> 'status';
    v_reason := v_act ->> 'reason';

    if v_status = 'applied' and v_act ->> 'target_table' = 'settings' then
      select coalesce(s.data -> 'work', '{}'::jsonb) into v_cur
        from public.settings s where s.user_id = p_user_id for update;
      v_cur := coalesce(v_cur, '{}'::jsonb);
      for v_key in select jsonb_object_keys(coalesce(v_act -> 'before', '{}'::jsonb)) loop
        if (v_cur -> v_key) is distinct from nullif(v_act -> 'before' -> v_key, 'null'::jsonb) then
          v_status := 'proposed';
          v_reason := 'Changed meanwhile; check before applying';
        end if;
      end loop;
      if v_status = 'applied' then
        insert into public.settings (id, user_id, data)
          values (p_user_id, p_user_id, jsonb_build_object('work', v_act -> 'after'))
          on conflict (user_id) do update
            set data = jsonb_set(
                  coalesce(public.settings.data, '{}'::jsonb), '{work}',
                  coalesce(public.settings.data -> 'work', '{}'::jsonb) || (v_act -> 'after')),
                updated_at = now();
      end if;

    elsif v_status = 'applied' and v_act ->> 'target_table' = 'leave_bookings' then
      if exists (
        select 1 from public.leave_bookings b
        where b.user_id = p_user_id and b.deleted_at is null
          and b.start_date <= (v_act -> 'after' ->> 'end_date')::date
          and b.end_date >= (v_act -> 'after' ->> 'start_date')::date
      ) then
        v_status := 'proposed';
        v_reason := 'Overlaps leave booked meanwhile';
      else
        insert into public.leave_bookings (
          id, user_id, start_date, end_date, start_half, end_half, leave_type, status, days, capture_id
        ) values (
          (v_act ->> 'target_id')::uuid, p_user_id,
          (v_act -> 'after' ->> 'start_date')::date,
          (v_act -> 'after' ->> 'end_date')::date,
          coalesce((v_act -> 'after' ->> 'start_half')::boolean, false),
          coalesce((v_act -> 'after' ->> 'end_half')::boolean, false),
          coalesce(v_act -> 'after' ->> 'leave_type', 'annual'),
          coalesce(v_act -> 'after' ->> 'status', 'planned'),
          (v_act -> 'after' ->> 'days')::numeric,
          (v_act ->> 'capture_id')::uuid
        );
      end if;

    elsif v_status = 'applied' and v_act ->> 'target_table' = 'items'
          and coalesce(v_act -> 'before', '{}'::jsonb) ? 'updated_at' then
      -- An existing item: only if nobody touched it since the plan was made.
      -- (A reminder on an item new in this batch is already in its insert.)
      update public.items i set
          start_at = case when v_act -> 'after' ? 'start_at'
                       then (v_act -> 'after' ->> 'start_at')::timestamptz else i.start_at end,
          end_at = case when v_act -> 'after' ? 'end_at'
                       then (v_act -> 'after' ->> 'end_at')::timestamptz else i.end_at end,
          all_day = case when v_act -> 'after' ? 'all_day'
                       then (v_act -> 'after' ->> 'all_day')::boolean else i.all_day end,
          due_at = case when v_act -> 'after' ? 'due_at'
                       then (v_act -> 'after' ->> 'due_at')::timestamptz else i.due_at end,
          data = case when v_act -> 'after' ? 'data' then v_act -> 'after' -> 'data' else i.data end,
          updated_at = now()
        where i.user_id = p_user_id and i.id = (v_act ->> 'target_id')::uuid
          and i.deleted_at is null and i.status = 'open'
          and i.updated_at = (v_act -> 'before' ->> 'updated_at')::timestamptz;
      if not found then
        v_status := 'proposed';
        v_reason := 'Changed meanwhile; check before applying';
      end if;
    end if;

    insert into public.ai_actions (
      id, user_id, capture_id, kind, status, reason, summary, quote, confidence, payload,
      target_table, target_id, before, after
    ) values (
      coalesce((v_act ->> 'id')::uuid, gen_random_uuid()), p_user_id,
      (v_act ->> 'capture_id')::uuid, v_act ->> 'kind', v_status, v_reason,
      coalesce(v_act ->> 'summary', ''), coalesce(v_act ->> 'quote', ''),
      (v_act ->> 'confidence')::real, coalesce(v_act -> 'payload', '{}'::jsonb),
      v_act ->> 'target_table', (v_act ->> 'target_id')::uuid,
      v_act -> 'before', v_act -> 'after'
    );
    v_actions := v_actions + 1;
  end loop;

  for v_cap in select * from jsonb_array_elements(coalesce(p_plan -> 'captures', '[]'::jsonb)) loop
    update public.captures
      set status = v_cap ->> 'status',
          sorted_at = case when v_cap ->> 'status' in ('sorted', 'needs_review') then now() end
      where user_id = p_user_id and id = (v_cap ->> 'id')::uuid and id = any (v_open);
  end loop;

  for v_upd in select * from jsonb_array_elements(coalesce(p_plan -> 'reading_updates', '[]'::jsonb)) loop
    continue when not ((v_upd ->> 'capture_id')::uuid = any (v_links));
    select coalesce(array_agg(t.id), '{}') into v_topic_ids
      from public.topics t
      where t.user_id = p_user_id and t.deleted_at is null
        and lower(t.name) in (
          select lower(x) from jsonb_array_elements_text(coalesce(v_upd -> 'topic_names', '[]'::jsonb)) as x
        );
    update public.items
      set data = data || jsonb_build_object('summary', v_upd -> 'summary', 'key_points', v_upd -> 'key_points'),
          topic_ids = (select coalesce(array_agg(distinct x), '{}') from unnest(topic_ids || v_topic_ids) as x)
      where user_id = p_user_id and capture_id = (v_upd ->> 'capture_id')::uuid
        and type = 'reading' and deleted_at is null;
  end loop;

  -- Summarised (or skipped by the model): the page text is no longer kept.
  update public.captures
    set payload = (payload - 'article_text') || '{"summary_pending": false}'::jsonb
    where user_id = p_user_id and id = any (v_links);

  return jsonb_build_object(
    'items', v_items,
    'captures', coalesce(array_length(v_open, 1), 0),
    'links', coalesce(array_length(v_links, 1), 0),
    'actions', v_actions
  );
end;
$$;

revoke all on function public.apply_sort_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_sort_batch(uuid, jsonb) to service_role;
