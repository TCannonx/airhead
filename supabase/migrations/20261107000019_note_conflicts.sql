-- 0019 Note conflict copies on the server (Task 6.2). A device that was offline
-- pushes its edit before it pulls, so the server must also refuse to let an
-- older edit from another device overwrite a newer version: it keeps the
-- server's version and saves the incoming text as a new "conflicted copy" note.
-- Writing is never thrown away. Runs before the version bump (trigger order).

create or replace function public.note_conflict_copy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_copy uuid;
  v_label text;
begin
  if new.writer_device is not distinct from old.writer_device
     or new.base_version >= old.version
     or new.doc = old.doc then
    return new;
  end if;

  v_copy := gen_random_uuid();
  v_label := ' (conflicted copy, '
    || to_char(now() at time zone public.user_time_zone(old.user_id), 'DD Mon HH24:MI') || ')';
  insert into public.items (id, user_id, type, title, data, status, calendar, topic_ids)
  select v_copy, i.user_id, i.type, left(i.title, 200) || v_label, i.data, i.status, i.calendar, i.topic_ids
    from public.items i where i.id = old.id;
  if not found then
    insert into public.items (id, user_id, type, title, data)
    values (v_copy, old.user_id, 'note', 'Note' || v_label, jsonb_build_object('doc_kind', new.kind));
  end if;
  insert into public.note_docs (id, user_id, kind, doc, base_version, writer_device, summary)
  values (v_copy, old.user_id, new.kind, new.doc, 0, new.writer_device, null);

  -- Keep the server's version of the original note.
  return old;
end;
$$;

revoke all on function public.note_conflict_copy() from public, anon, authenticated;

-- Trigger names fire in alphabetical order: this one ("a…") runs before the
-- version bump and the server_updated_at stamp.
create trigger a_note_conflict_copy before update on public.note_docs
  for each row execute function public.note_conflict_copy();
