-- 0035 AI over every note (Task 11.0).
-- Typed notes, meeting notes and ideas the person changed since the AI last
-- looked join the sorting batch (at most 5). A note's "last look" is
-- items.data.ai_seen_at; it counts as changed when the item or its document
-- was written on the server after that (server_updated_at, the server's own
-- clock). Items made from notes, condensed or archived notes and notes from
-- captures (already sorted) are left out, and so are notes untouched for 30
-- days, so switching this on does not look at years of old notes.
--
-- Cost guard: a note rides along with a batch that runs anyway (new captures,
-- Sort now). On its own it makes the person due only once its last change is
-- 30 minutes old, so typing in a note never triggers a call every 5 minutes.
--
-- apply_sort_batch v5: items and actions found in a note (note_id set,
-- capture_id null) are applied like a capture's while the note exists; every
-- note sent is stamped with ai_seen_at (plus the length and hash of the text
-- seen) whatever the answer; a tidy-up may carry data (a reminder set on the
-- tidied event, Task 11.1 follow-up). The batch digest is a memory fact with
-- source 'digest'.

alter table public.memory_facts add column if not exists source text;
comment on column public.memory_facts.source is
  'Where a fact came from when not a capture: ''digest'' for a sorting batch digest (Task 11.0).';

create or replace function public.add_memory_facts(p_user_id uuid, p_facts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact jsonb;
  v_added integer := 0;
begin
  for v_fact in select * from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb)) loop
    continue when coalesce(trim(v_fact ->> 'text'), '') = '';
    continue when exists (
      select 1 from public.memory_facts f
      where f.user_id = p_user_id and f.deleted_at is null
        and lower(trim(f.text)) = lower(trim(v_fact ->> 'text'))
    );
    insert into public.memory_facts (user_id, text, category, status, source_capture_id, source)
    values (
      p_user_id,
      trim(v_fact ->> 'text'),
      v_fact ->> 'category',
      case when v_fact ->> 'category' = 'everyday' then 'active' else 'pending_approval' end,
      (v_fact ->> 'source_capture_id')::uuid,
      nullif(v_fact ->> 'source', '')
    );
    v_added := v_added + 1;
  end loop;
  return v_added;
end;
$$;
revoke all on function public.add_memory_facts(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_memory_facts(uuid, jsonb) to service_role;

-- Notes waiting for the AI: one person's (p_user) or everyone's (null).
create or replace function public.notes_waiting_for_ai(p_user uuid default null)
returns table (user_id uuid, id uuid, changed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.user_id, n.id, n.changed_at
  from (
    select i.user_id, i.id, i.type, i.title, i.body, i.data, d.doc,
           greatest(i.server_updated_at, coalesce(d.server_updated_at, i.server_updated_at)) as changed_at
    from public.items i
    left join public.note_docs d
      on d.id = i.id and d.user_id = i.user_id and d.deleted_at is null
    where (p_user is null or i.user_id = p_user)
      and i.deleted_at is null
      and i.capture_id is null
      and i.status in ('open', 'done')
      and (i.type in ('note', 'meeting', 'idea') or i.data ? 'doc_kind')
      and coalesce(i.data ->> 'doc_kind', 'typed') = 'typed'
      and not (i.data ? 'from_note_id')
      and not (i.data ? 'condensed_from')
      and coalesce(i.data ->> 'archived', 'false') <> 'true'
  ) n
  where n.changed_at > now() - interval '30 days'
    and n.changed_at > coalesce((n.data ->> 'ai_seen_at')::timestamptz, '-infinity'::timestamptz)
    -- Something to read: a typed document with text, a body, or an idea's title.
    and (
      (n.doc is not null
        and trim(regexp_replace(coalesce(n.doc ->> 'html', ''), '<[^>]*>', '', 'g')) <> '')
      or (n.doc is null and (coalesce(trim(n.body), '') <> '' or n.type = 'idea'))
    );
$$;
revoke all on function public.notes_waiting_for_ai(uuid) from public, anon, authenticated;

-- The notes one batch looks at: the longest-waiting first.
create or replace function public.notes_for_sorting(p_user uuid, p_limit integer default 5)
returns table (id uuid, type text, title text, body text, data jsonb, doc jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.type, i.title, i.body, i.data, d.doc
  from public.notes_waiting_for_ai(p_user) w
  join public.items i on i.id = w.id
  left join public.note_docs d on d.id = i.id and d.deleted_at is null
  order by w.changed_at asc
  limit greatest(0, least(coalesce(p_limit, 5), 20));
$$;
revoke all on function public.notes_for_sorting(uuid, integer) from public, anon, authenticated;
grant execute on function public.notes_for_sorting(uuid, integer) to service_role;

-- Due at the 5-minute check: captures as in 0033, or a changed note whose last
-- change is at least 30 minutes old.
create or replace function public.users_due_now()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select d.user_id from public.users_due_for_sorting(20, 2) d
  union
  select w.user_id from public.notes_waiting_for_ai(null) w
  where w.changed_at <= now() - interval '30 minutes';
$$;
revoke all on function public.users_due_now() from public, anon, authenticated;

alter table public.ai_actions add column if not exists note_id uuid;
comment on column public.ai_actions.note_id is
  'The note this action was found in (Task 11.0); capture_id is null then.';

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
            'ai_seen_hash', coalesce(v_note ->> 'seen_hash', '')),
          updated_at = now()
      where user_id = p_user_id and id = (v_note ->> 'id')::uuid;
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'captures', coalesce(array_length(v_open, 1), 0),
    'links', coalesce(array_length(v_links, 1), 0),
    'actions', v_actions
  ) || case when coalesce(array_length(v_notes, 1), 0) > 0
         then jsonb_build_object('notes', array_length(v_notes, 1)) else '{}'::jsonb end;
end;
$$;

revoke all on function public.apply_sort_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_sort_batch(uuid, jsonb) to service_role;
