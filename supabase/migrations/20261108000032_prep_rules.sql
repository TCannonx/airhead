-- 0032 Prep rules: "when a barber appointment is booked, remind me to bring
-- €20 cash". A rule lives in settings.data.work.prep_rules:
--   { "id": "<text>", "match": ["barber", "haircut"], "reminder": "Bring €20 cash",
--     "minutes_before": 720 }
-- Every open, timed, one-off event whose title contains any match word gets a
-- 'prep' nudge `minutes_before` its start (key prep:<rule id>:<item id>).
-- Kept in step when an event is added or changed, and for every future event
-- when the rules change. AI sorting adds rules with the add_prep_rule action.

alter table public.ai_actions drop constraint if exists ai_actions_kind_check;
alter table public.ai_actions add constraint ai_actions_kind_check
  check (kind in ('set_leave_remaining', 'set_leave_used', 'book_leave',
    'update_work_setting', 'set_reminder', 'reschedule_item', 'add_prep_rule'));

create or replace function public.refresh_prep_nudges(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
  v_rules jsonb;
  v_rule jsonb;
  v_word text;
  v_hit boolean;
  v_key text;
  v_keys text[] := '{}';
  v_minutes integer;
  v_tz text;
begin
  select * into v_item from public.items where id = p_item_id;
  if not found then
    return;
  end if;

  if v_item.type = 'event' and v_item.status = 'open' and v_item.deleted_at is null
     and v_item.start_at is not null and v_item.rrule is null then
    select coalesce(s.data -> 'work' -> 'prep_rules', '[]'::jsonb) into v_rules
      from public.settings s where s.user_id = v_item.user_id;
    v_tz := public.user_time_zone(v_item.user_id);
    for v_rule in select * from jsonb_array_elements(coalesce(v_rules, '[]'::jsonb)) loop
      continue when jsonb_typeof(v_rule -> 'match') <> 'array' or coalesce(v_rule ->> 'id', '') = '';
      v_hit := false;
      for v_word in select jsonb_array_elements_text(v_rule -> 'match') loop
        if length(trim(v_word)) >= 2
           and position(lower(trim(v_word)) in lower(v_item.title)) > 0 then
          v_hit := true;
        end if;
      end loop;
      continue when not v_hit;
      v_minutes := least(greatest(coalesce((v_rule ->> 'minutes_before')::integer, 720), 0), 10080);
      v_key := 'prep:' || (v_rule ->> 'id') || ':' || v_item.id;
      v_keys := v_keys || v_key;
      perform public.upsert_nudge(
        v_item.user_id, v_key, 'prep', v_item.id,
        v_item.start_at - make_interval(mins => v_minutes),
        left(coalesce(v_rule ->> 'reminder', 'Get ready'), 120),
        v_item.title || ' · ' || to_char(v_item.start_at at time zone v_tz, 'Dy DD Mon HH24:MI'),
        '/calendar');
    end loop;
  end if;

  -- Rules that no longer match (or were removed), or an event no longer due.
  update public.nudges set status = 'cancelled'
   where user_id = v_item.user_id and item_id = v_item.id and kind = 'prep'
     and dedupe_key like 'prep:%' and status = 'pending'
     and not (dedupe_key = any (v_keys));
end;
$$;
revoke all on function public.refresh_prep_nudges(uuid) from public, anon, authenticated;

create or replace function public.item_prep_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_prep_nudges(new.id);
  return new;
end;
$$;
revoke all on function public.item_prep_rules() from public, anon, authenticated;

create trigger item_prep_rules
  after insert or update of type, title, status, start_at, rrule, deleted_at
  on public.items
  for each row execute function public.item_prep_rules();

-- Rules changed: refresh every future event of that person.
create or replace function public.settings_prep_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_op = 'UPDATE'
     and (old.data -> 'work' -> 'prep_rules') is not distinct from (new.data -> 'work' -> 'prep_rules') then
    return new;
  end if;
  for v_id in
    select i.id from public.items i
     where i.user_id = new.user_id and i.type = 'event' and i.deleted_at is null
       and i.start_at > now()
  loop
    perform public.refresh_prep_nudges(v_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.settings_prep_rules() from public, anon, authenticated;

create trigger settings_prep_rules
  after insert or update of data on public.settings
  for each row execute function public.settings_prep_rules();
