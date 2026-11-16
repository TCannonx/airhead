-- 0044 Apply the evening plan (Task 13.6), in one transaction.
--
-- p_payload (built and checked by plan-day/validate.ts):
--   items[]        { item_id, surface_at, effort_minutes, needs, prep, reason, confidence }
--   nudges[]       { key, kind, item_id, send_at, title, body, url, reason, delivery }
--   occurrences[]  { item_id, date }: earlier AI nudges for these that the plan
--                  no longer contains are cancelled; defaults and the owner's stay
--   cost_eur, summary
-- Items and nudges are only written for the run owner's own items. Returns the
-- number of nudges written. Running it twice gives the same result.

-- upsert_plan_nudge v2: nothing but the owner's own choice replaces a 'user' nudge.
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
begin
  select source into v_source from public.nudges where user_id = p_user_id and dedupe_key = p_key;
  if p_source = 'default' and v_source in ('ai', 'user') then
    return;
  end if;
  if p_source <> 'user' and v_source = 'user' then
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
          else public.nudges.status end,
        sent_at = case
          when public.nudges.send_at <> excluded.send_at then null
          else public.nudges.sent_at end;
end;
$$;
revoke all on function public.upsert_plan_nudge(uuid, text, text, uuid, timestamptz, text, text,
  text, text, text, text, uuid) from public, anon, authenticated;

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
                                   reason, confidence, source, plan_run_id, planned_at)
    values (v_user, (v_item ->> 'item_id')::uuid, (v_item ->> 'surface_at')::timestamptz,
            (v_item ->> 'effort_minutes')::integer,
            coalesce(v_item -> 'needs', '[]'::jsonb), coalesce(v_item -> 'prep', '[]'::jsonb),
            coalesce(v_item ->> 'reason', ''), (v_item ->> 'confidence')::numeric,
            'ai', p_run_id, now())
    on conflict (item_id) do update
      set surface_at = excluded.surface_at,
          effort_minutes = excluded.effort_minutes,
          needs = excluded.needs,
          prep = excluded.prep,
          reason = excluded.reason,
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
