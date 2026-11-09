-- 0039 Follow-ups (Task 12.1, Phase 12 "Trust: every note counts").
--
-- When a note implies more work, sorting asks up to 3 specific questions with
-- quick answers. They live in follow_ups (owner-only, synced like ai_actions).
-- Devices change only status and answer (answer, dismiss); the sync push is an
-- upsert, so the owner may also insert their own rows.
--
-- apply_sort_batch v7 (copy of v6 from 0036) adds, in the same transaction:
-- - p_plan.follow_ups [{id, capture_id | note_id, item_id, question, options, round}]:
--   inserted only for a capture still unsorted or a note still there. item_id is
--   kept only when that item exists (it may be one inserted by this batch).
-- - p_plan.item_updates[].after.body: an update may set the item's body (an
--   answer's details added to the item it was about, Task 12.2), Undo-able.
-- The result gains follow_ups (a count) when any were asked.
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_id uuid,
  note_id uuid,
  item_id uuid,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  answer text,
  round integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger set_server_updated_at before insert or update on public.follow_ups
  for each row execute function public.set_server_updated_at();
create index follow_ups_sync_idx on public.follow_ups (user_id, server_updated_at);
create index follow_ups_capture_idx on public.follow_ups (capture_id);
alter table public.follow_ups enable row level security;
create policy "own rows: select" on public.follow_ups for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.follow_ups for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.follow_ups for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.follow_ups from anon;
revoke delete on public.follow_ups from authenticated;
grant select, insert, update on public.follow_ups to authenticated;

alter publication supabase_realtime add table public.follow_ups;

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
  v_notes uuid[];
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
  v_tidy jsonb;
  v_note jsonb;
  v_route jsonb;
  v_fu jsonb;
  v_follow_ups integer := 0;
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
  -- Notes in this batch that still exist (Task 11.0).
  select coalesce(array_agg(i.id), '{}') into v_notes
    from public.items i
    where i.user_id = p_user_id and i.deleted_at is null
      and i.id in (
        select (n ->> 'id')::uuid
        from jsonb_array_elements(coalesce(p_plan -> 'notes', '[]'::jsonb)) as n
      );

  for v_topic in select jsonb_array_elements_text(coalesce(p_plan -> 'new_topics', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.topics t
      where t.user_id = p_user_id and t.deleted_at is null and lower(t.name) = lower(v_topic)
    ) then
      insert into public.topics (user_id, name) values (p_user_id, v_topic);
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_plan -> 'items', '[]'::jsonb)) loop
    continue when not (
      coalesce((v_item ->> 'capture_id')::uuid = any (v_open || v_links), false)
      or coalesce((v_item ->> 'note_id')::uuid = any (v_notes), false)
    );

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

  for v_tidy in select * from jsonb_array_elements(coalesce(p_plan -> 'item_updates', '[]'::jsonb)) loop
    continue when not ((v_tidy ->> 'capture_id')::uuid = any (v_open));
    v_status := 'applied';
    v_reason := null;
    update public.items i set
        title = case when v_tidy -> 'after' ? 'title'
                  then coalesce(nullif(v_tidy -> 'after' ->> 'title', ''), i.title) else i.title end,
        status = case when v_tidy -> 'after' ? 'status'
                  then v_tidy -> 'after' ->> 'status' else i.status end,
        start_at = case when v_tidy -> 'after' ? 'start_at'
                  then (v_tidy -> 'after' ->> 'start_at')::timestamptz else i.start_at end,
        end_at = case when v_tidy -> 'after' ? 'end_at'
                  then (v_tidy -> 'after' ->> 'end_at')::timestamptz else i.end_at end,
        all_day = case when v_tidy -> 'after' ? 'all_day'
                  then (v_tidy -> 'after' ->> 'all_day')::boolean else i.all_day end,
        rrule = case when v_tidy -> 'after' ? 'rrule'
                  then v_tidy -> 'after' ->> 'rrule' else i.rrule end,
        -- An answer's details added to the item it was about (Task 12.2).
        body = case when v_tidy -> 'after' ? 'body'
                  then v_tidy -> 'after' ->> 'body' else i.body end,
        -- A reminder the same capture set on this event (Task 11.0 fix).
        data = case when jsonb_typeof(v_tidy -> 'after' -> 'data') = 'object'
                  then v_tidy -> 'after' -> 'data' else i.data end,
        updated_at = now()
      where i.user_id = p_user_id and i.id = (v_tidy ->> 'item_id')::uuid
        and i.deleted_at is null
        and i.updated_at = (v_tidy -> 'before' ->> 'updated_at')::timestamptz;
    if not found then
      v_status := 'proposed';
      v_reason := 'Changed meanwhile; check before applying';
    end if;
    insert into public.ai_actions (
      id, user_id, capture_id, kind, status, reason, summary, quote, confidence, payload,
      target_table, target_id, before, after
    ) values (
      coalesce((v_tidy ->> 'id')::uuid, gen_random_uuid()), p_user_id,
      (v_tidy ->> 'capture_id')::uuid, 'tidy_item', v_status, v_reason,
      coalesce(v_tidy ->> 'summary', ''), coalesce(v_tidy ->> 'quote', ''),
      (v_tidy ->> 'confidence')::real, '{}'::jsonb,
      'items', (v_tidy ->> 'item_id')::uuid,
      v_tidy -> 'before', v_tidy -> 'after'
    );
    v_actions := v_actions + 1;
  end loop;

  for v_act in select * from jsonb_array_elements(coalesce(p_plan -> 'actions', '[]'::jsonb)) loop
    continue when not (
      coalesce((v_act ->> 'capture_id')::uuid = any (v_open), false)
      or coalesce((v_act ->> 'note_id')::uuid = any (v_notes), false)
    );
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
      id, user_id, capture_id, note_id, kind, status, reason, summary, quote, confidence, payload,
      target_table, target_id, before, after
    ) values (
      coalesce((v_act ->> 'id')::uuid, gen_random_uuid()), p_user_id,
      (v_act ->> 'capture_id')::uuid, (v_act ->> 'note_id')::uuid,
      v_act ->> 'kind', v_status, v_reason,
      coalesce(v_act ->> 'summary', ''), coalesce(v_act ->> 'quote', ''),
      (v_act ->> 'confidence')::real, coalesce(v_act -> 'payload', '{}'::jsonb),
      v_act ->> 'target_table', (v_act ->> 'target_id')::uuid,
      v_act -> 'before', v_act -> 'after'
    );
    v_actions := v_actions + 1;
  end loop;

  -- Words the batch could not place went to the Workshop as a note (Task 11.2):
  -- the capture keeps that note's id and the reason, for its chip. Only for a
  -- capture still unsorted, and only once its note was inserted above.
  for v_route in select * from jsonb_array_elements(coalesce(p_plan -> 'workshop', '[]'::jsonb)) loop
    continue when not ((v_route ->> 'capture_id')::uuid = any (v_open));
    continue when not exists (
      select 1 from public.items i
      where i.user_id = p_user_id and i.id = (v_route ->> 'item_id')::uuid
        and i.capture_id = (v_route ->> 'capture_id')::uuid
    );
    update public.captures
      set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
            'workshop_item_id', v_route ->> 'item_id',
            'workshop_reason', coalesce(v_route ->> 'reason', 'unmapped'))
      where user_id = p_user_id and id = (v_route ->> 'capture_id')::uuid;
  end loop;

  -- Questions the batch asks about a note (Task 12.1): only for a capture still
  -- unsorted or a note still there; the item it is about must exist (or be null).
  for v_fu in select * from jsonb_array_elements(coalesce(p_plan -> 'follow_ups', '[]'::jsonb)) loop
    continue when not (
      coalesce((v_fu ->> 'capture_id')::uuid = any (v_open), false)
      or coalesce((v_fu ->> 'note_id')::uuid = any (v_notes), false)
    );
    insert into public.follow_ups (
      id, user_id, capture_id, note_id, item_id, question, options, round
    ) values (
      coalesce((v_fu ->> 'id')::uuid, gen_random_uuid()), p_user_id,
      (v_fu ->> 'capture_id')::uuid, (v_fu ->> 'note_id')::uuid,
      (select i.id from public.items i
        where i.user_id = p_user_id and i.id = (v_fu ->> 'item_id')::uuid),
      coalesce(v_fu ->> 'question', ''),
      coalesce(v_fu -> 'options', '[]'::jsonb),
      coalesce((v_fu ->> 'round')::integer, 1)
    );
    v_follow_ups := v_follow_ups + 1;
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

  -- Every note sent was looked at, whatever the answer (Task 11.0). Only the
  -- data keys change; the note's text and title are never touched. The stamp
  -- equals the item's new server_updated_at, so the stamp itself is not a change.
  for v_note in select * from jsonb_array_elements(coalesce(p_plan -> 'notes', '[]'::jsonb)) loop
    continue when not ((v_note ->> 'id')::uuid = any (v_notes));
    update public.items
      set data = data || jsonb_build_object(
            'ai_seen_at', now(),
            'ai_seen_len', coalesce((v_note ->> 'seen_len')::integer, 0),
            'ai_seen_hash', coalesce(v_note ->> 'seen_hash', ''))
            -- Words to plan that fit no item: the note goes to the Workshop (Task 11.2).
            || case when (v_note ->> 'workshop') = 'true'
                 then '{"workshop": true}'::jsonb else '{}'::jsonb end,
          updated_at = now()
      where user_id = p_user_id and id = (v_note ->> 'id')::uuid;
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'captures', coalesce(array_length(v_open, 1), 0),
    'links', coalesce(array_length(v_links, 1), 0),
    'actions', v_actions
  ) || case when v_follow_ups > 0
         then jsonb_build_object('follow_ups', v_follow_ups) else '{}'::jsonb end
    || case when coalesce(array_length(v_notes, 1), 0) > 0
         then jsonb_build_object('notes', array_length(v_notes, 1)) else '{}'::jsonb end;
end;
$$;

revoke all on function public.apply_sort_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_sort_batch(uuid, jsonb) to service_role;
