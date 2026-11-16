-- 0056 Reading slots (Task 16.7): apply_plan v2 stores item_plans.reading_slot
-- (commute, lunch, evening, weekend) for reading items the planner suggests.
-- Otherwise the same as 0044.

create or replace function public.apply_plan(p_run_id uuid, p_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_item jsonb;
  v_n jsonb;
  v_occ jsonb;
  v_keys text[] := '{}';
  v_written integer := 0;
begin
  select user_id into v_user from public.plan_runs where id = p_run_id;
  if v_user is null then
    raise exception 'unknown plan run %', p_run_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) loop
    continue when not exists (select 1 from public.items i
                               where i.id = (v_item ->> 'item_id')::uuid and i.user_id = v_user);
    insert into public.item_plans (user_id, item_id, surface_at, effort_minutes, needs, prep,
                                   reason, confidence, source, plan_run_id, planned_at, reading_slot)
    values (v_user, (v_item ->> 'item_id')::uuid, (v_item ->> 'surface_at')::timestamptz,
            (v_item ->> 'effort_minutes')::integer,
            coalesce(v_item -> 'needs', '[]'::jsonb), coalesce(v_item -> 'prep', '[]'::jsonb),
            coalesce(v_item ->> 'reason', ''), (v_item ->> 'confidence')::numeric,
            'ai', p_run_id, now(),
            case when v_item ->> 'reading_slot' in ('commute', 'lunch', 'evening', 'weekend')
                 then v_item ->> 'reading_slot' end)
    on conflict (item_id) do update
      set surface_at = excluded.surface_at,
          effort_minutes = excluded.effort_minutes,
          needs = excluded.needs,
          prep = excluded.prep,
          reason = excluded.reason,
          reading_slot = excluded.reading_slot,
          confidence = excluded.confidence,
          source = 'ai',
          plan_run_id = excluded.plan_run_id,
          planned_at = excluded.planned_at,
          updated_at = now(),
          deleted_at = null
      where public.item_plans.user_id = v_user;
  end loop;

  for v_n in select * from jsonb_array_elements(coalesce(p_payload -> 'nudges', '[]'::jsonb)) loop
    continue when not exists (select 1 from public.items i
                               where i.id = (v_n ->> 'item_id')::uuid and i.user_id = v_user);
    continue when (v_n ->> 'key') not like 'plan:%';
    v_keys := v_keys || (v_n ->> 'key');
    perform public.upsert_plan_nudge(
      v_user, v_n ->> 'key', v_n ->> 'kind', (v_n ->> 'item_id')::uuid,
      (v_n ->> 'send_at')::timestamptz, v_n ->> 'title', v_n ->> 'body', v_n ->> 'url',
      v_n ->> 'reason', 'ai', coalesce(v_n ->> 'delivery', 'push'), p_run_id);
    v_written := v_written + 1;
  end loop;

  -- Earlier AI nudges for the planned occurrences that this plan dropped.
  for v_occ in select * from jsonb_array_elements(coalesce(p_payload -> 'occurrences', '[]'::jsonb)) loop
    update public.nudges n set status = 'cancelled'
     where n.user_id = v_user and n.status = 'pending' and n.source = 'ai'
       and n.item_id = (v_occ ->> 'item_id')::uuid
       and n.dedupe_key like 'plan:%:' || (v_occ ->> 'item_id') || ':' || (v_occ ->> 'date')
       and not (n.dedupe_key = any (v_keys));
  end loop;

  update public.plan_runs
     set status = 'ok',
         finished_at = now(),
         items_considered = coalesce((p_payload -> 'summary' ->> 'items_considered')::integer, 0),
         nudges_written = v_written,
         cost_eur = coalesce((p_payload ->> 'cost_eur')::numeric, 0),
         summary = coalesce(p_payload -> 'summary', '{}'::jsonb)
   where id = p_run_id;
  return v_written;
end;
$$;
revoke all on function public.apply_plan(uuid, jsonb) from public, anon, authenticated;
