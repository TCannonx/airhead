-- Applies one sort-batch plan atomically: creates missing topics, inserts the
-- items, and updates the captures. Only captures that are STILL unsorted are
-- touched (a capture edited, sorted or deleted meanwhile on a device is left
-- alone). Called by the sort-batch Edge Function with the service role.
create or replace function public.apply_sort_batch(p_user_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_open uuid[];
  v_topic text;
  v_item jsonb;
  v_cap jsonb;
  v_topic_ids uuid[];
  v_items integer := 0;
begin
  select coalesce(array_agg((c ->> 'id')::uuid), '{}')
    into v_ids
    from jsonb_array_elements(coalesce(p_plan -> 'captures', '[]'::jsonb)) as c;

  -- Lock the captures we are about to sort, then keep only the unsorted ones.
  perform 1 from public.captures
    where user_id = p_user_id and id = any (v_ids)
    for update;
  select coalesce(array_agg(id), '{}')
    into v_open
    from public.captures
    where user_id = p_user_id and id = any (v_ids)
      and status = 'unsorted' and deleted_at is null;

  for v_topic in select jsonb_array_elements_text(coalesce(p_plan -> 'new_topics', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.topics t
      where t.user_id = p_user_id and t.deleted_at is null and lower(t.name) = lower(v_topic)
    ) then
      insert into public.topics (user_id, name) values (p_user_id, v_topic);
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_plan -> 'items', '[]'::jsonb)) loop
    continue when not ((v_item ->> 'capture_id')::uuid = any (v_open));

    select coalesce(array_agg(t.id), '{}')
      into v_topic_ids
      from public.topics t
      where t.user_id = p_user_id and t.deleted_at is null
        and lower(t.name) in (
          select lower(x) from jsonb_array_elements_text(coalesce(v_item -> 'topic_names', '[]'::jsonb)) as x
        );

    insert into public.items (
      user_id, capture_id, type, title, body, status, start_at, end_at, all_day, due_at,
      rrule, calendar, list_id, topic_ids, confidence, data
    ) values (
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

  for v_cap in select * from jsonb_array_elements(coalesce(p_plan -> 'captures', '[]'::jsonb)) loop
    update public.captures
      set status = v_cap ->> 'status',
          sorted_at = case when v_cap ->> 'status' in ('sorted', 'needs_review') then now() end
      where user_id = p_user_id and id = (v_cap ->> 'id')::uuid and id = any (v_open);
  end loop;

  return jsonb_build_object('items', v_items, 'captures', coalesce(array_length(v_open, 1), 0));
end;
$$;

revoke all on function public.apply_sort_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_sort_batch(uuid, jsonb) to service_role;
