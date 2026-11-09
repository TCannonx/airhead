-- Tests for migration 0035: AI over every note (Task 11.0).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'd@example.test', 'authenticated', 'authenticated');

-- Back-date writes: the trigger would stamp them with now().
alter table public.items disable trigger set_server_updated_at;
alter table public.note_docs disable trigger set_server_updated_at;

insert into public.items (id, user_id, capture_id, type, title, data, server_updated_at) values
  -- A: a typed note last changed 40 minutes ago, never seen: due.
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-00000000000a', null, 'note',
   'Work', '{"doc_kind": "typed"}', now() - interval '40 minutes'),
  -- B: a typed note changed 5 minutes ago: waits (cost guard).
  ('10000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-00000000000b', null, 'note',
   'Busy', '{"doc_kind": "typed"}', now() - interval '5 minutes'),
  -- C: seen after its last change; an empty note; a handwritten note; a note from a capture.
  ('10000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-00000000000c', null, 'note',
   'Seen', jsonb_build_object('doc_kind', 'typed', 'ai_seen_at', now() - interval '35 minutes'),
   now() - interval '40 minutes'),
  ('10000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-00000000000c', null, 'note',
   'Empty', '{"doc_kind": "typed"}', now() - interval '40 minutes'),
  ('10000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-00000000000c', null, 'note',
   'Ink', '{"doc_kind": "ink"}', now() - interval '40 minutes'),
  ('10000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-00000000000c',
   gen_random_uuid(), 'note', 'From a capture', '{}', now() - interval '40 minutes'),
  -- D: an idea typed straight in, an hour old: due; and an item found in a note: never looked at.
  ('10000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-00000000000d', null, 'idea',
   'Garden shed', '{}', now() - interval '1 hour'),
  ('10000000-0000-4000-8000-0000000000d2', '00000000-0000-0000-0000-00000000000d', null, 'idea',
   'Found in a note', '{"from_note_id": "10000000-0000-4000-8000-00000000000d"}', now() - interval '1 hour');

insert into public.note_docs (id, user_id, kind, doc, server_updated_at) values
  ('10000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'typed',
   '{"html": "<p>need to send the report to Trevor by Friday</p>"}', now() - interval '40 minutes'),
  ('10000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'typed',
   '{"html": "<p>typing…</p>"}', now() - interval '5 minutes'),
  ('10000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'typed',
   '{"html": "<p>old</p>"}', now() - interval '40 minutes'),
  ('10000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-00000000000c', 'typed',
   '{"html": "<p></p>"}', now() - interval '40 minutes'),
  ('10000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-00000000000c', 'ink',
   '{"pages": []}', now() - interval '40 minutes');

alter table public.items enable trigger set_server_updated_at;
alter table public.note_docs enable trigger set_server_updated_at;

select results_eq(
  $$ select user_id from public.users_due_now() order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid),
            ('00000000-0000-0000-0000-00000000000d'::uuid) $$,
  'due: a changed note that has waited 30 minutes; not one being typed, seen, empty, ink or from a capture');

select results_eq(
  $$ select id from public.notes_waiting_for_ai('00000000-0000-0000-0000-00000000000b') $$,
  $$ values ('10000000-0000-4000-8000-00000000000b'::uuid) $$,
  'a note being typed still rides along when a batch runs anyway');

select results_eq(
  $$ select id, doc ->> 'html' from public.notes_for_sorting('00000000-0000-0000-0000-00000000000a', 5) $$,
  $$ values ('10000000-0000-4000-8000-00000000000a'::uuid,
             '<p>need to send the report to Trevor by Friday</p>'::text) $$,
  'notes_for_sorting returns the note and its document');

-- Sorting looks at A's note: a task found in it, an action, a digest.
select is(
  public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {
    "items": [
      {"id": "f0000000-0000-4000-8000-00000000035a", "capture_id": null,
       "note_id": "10000000-0000-4000-8000-00000000000a", "type": "task",
       "title": "Send the report to Trevor", "body": null, "status": "open", "start_at": null,
       "end_at": null, "all_day": false, "due_at": "2030-11-15T17:00:00Z", "rrule": null,
       "calendar": null, "list_id": null, "topic_names": [], "confidence": 0.9,
       "data": {"from_note_id": "10000000-0000-4000-8000-00000000000a"}},
      {"id": "f0000000-0000-4000-8000-00000000035b", "capture_id": null,
       "note_id": "10000000-0000-4000-8000-0000000000ff", "type": "task",
       "title": "From a note that is gone", "status": "open", "topic_names": [], "data": {}}
    ],
    "actions": [
      {"id": "a0000000-0000-4000-8000-00000000035a", "capture_id": null,
       "note_id": "10000000-0000-4000-8000-00000000000a", "kind": "update_work_setting",
       "status": "proposed", "reason": "Check this", "summary": "Entitlement 23 days",
       "quote": "23 days", "confidence": 0.5, "payload": {}, "target_table": "settings",
       "target_id": null, "before": {"entitlement": null}, "after": {"entitlement": 23}}
    ],
    "captures": [],
    "notes": [{"id": "10000000-0000-4000-8000-00000000000a", "seen_len": 46, "seen_hash": "abc12345"}]
  }
  $json$::jsonb),
  '{"items": 1, "captures": 0, "links": 0, "actions": 1, "notes": 1}'::jsonb,
  'items and actions found in a note are applied; one for a note that is gone is not');

select ok((select capture_id is null and title = 'Send the report to Trevor'
    and data ->> 'from_note_id' = '10000000-0000-4000-8000-00000000000a'
  from public.items where id = 'f0000000-0000-4000-8000-00000000035a'),
  'the task links to its note, not a capture');
select ok((select capture_id is null and note_id = '10000000-0000-4000-8000-00000000000a'
  from public.ai_actions where id = 'a0000000-0000-4000-8000-00000000035a'),
  'the action records its note');

select ok((select title = 'Work' and (data ->> 'ai_seen_at')::timestamptz = now()
    and (data ->> 'ai_seen_len')::int = 46 and data ->> 'ai_seen_hash' = 'abc12345'
    and data ->> 'doc_kind' = 'typed'
  from public.items where id = '10000000-0000-4000-8000-00000000000a'),
  'the note is stamped as seen; its title and other data are kept');
select is((select doc ->> 'html' from public.note_docs where id = '10000000-0000-4000-8000-00000000000a'),
  '<p>need to send the report to Trevor by Friday</p>', 'the note text is never changed');
select is((select count(*)::int from public.notes_waiting_for_ai('00000000-0000-0000-0000-00000000000a')),
  0, 'after the look, the note is no longer waiting (the stamp is not itself a change)');

-- Stamped whatever the answer: a batch that found nothing in D's idea.
select public.apply_sort_batch('00000000-0000-0000-0000-00000000000d',
  '{"captures": [], "notes": [{"id": "10000000-0000-4000-8000-00000000000d", "seen_len": 11, "seen_hash": "x"}]}'::jsonb);
select ok((select data ? 'ai_seen_at' from public.items where id = '10000000-0000-4000-8000-00000000000d'),
  'a note with nothing in it is still stamped');
select is((select count(*)::int from public.users_due_now() where user_id = '00000000-0000-0000-0000-00000000000d'),
  0, 'and is no longer due');

-- Only the service role may read notes for sorting.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from public.notes_for_sorting('00000000-0000-0000-0000-00000000000a', 5) $$,
  '42501', null, 'apps cannot call notes_for_sorting');
select throws_ok($$ select * from public.notes_waiting_for_ai(null) $$,
  '42501', null, 'apps cannot list waiting notes');
reset role;

-- The digest is an everyday fact with source 'digest'; a duplicate is skipped.
select is(public.add_memory_facts('00000000-0000-0000-0000-00000000000a',
  '[{"text": "Sends Trevor a report on Fridays.", "category": "everyday", "source_capture_id": null, "source": "digest"}]'::jsonb),
  1, 'the digest is stored');
select ok((select status = 'active' and category = 'everyday' and source = 'digest' and source_capture_id is null
  from public.memory_facts where text = 'Sends Trevor a report on Fridays.'), 'as an active everyday fact from a digest');
select is(public.add_memory_facts('00000000-0000-0000-0000-00000000000a',
  '[{"text": "sends trevor a report on fridays.", "category": "everyday", "source": "digest"}]'::jsonb),
  0, 'the same digest again is skipped');

-- A tidy-up may carry the reminder set on the tidied event (Task 11.1 follow-up).
insert into public.captures (id, user_id, text, status) values
  ('c0000000-0000-4000-8000-000000000351', '00000000-0000-0000-0000-00000000000a',
   'Training on Tuesday 7pm, remind me an hour before', 'unsorted');
insert into public.items (id, user_id, capture_id, type, title, status, start_at, calendar, data, updated_at) values
  ('e0000000-0000-4000-8000-000000000351', '00000000-0000-0000-0000-00000000000a',
   'c0000000-0000-4000-8000-000000000351', 'event', 'Training . remind me', 'open',
   '2030-11-12T19:00:00Z', 'personal', '{"x": 1}', '2026-11-01T09:00:00Z');
select public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {"item_updates": [
    {"id": "a0000000-0000-4000-8000-000000000351", "capture_id": "c0000000-0000-4000-8000-000000000351",
     "item_id": "e0000000-0000-4000-8000-000000000351", "summary": "Tidied “Training”",
     "quote": "Training . remind me", "confidence": 0.9,
     "before": {"title": "Training . remind me", "data": {"x": 1}, "updated_at": "2026-11-01T09:00:00+00:00"},
     "after": {"title": "Training", "data": {"x": 1, "reminder_minutes": "60"}}}
  ], "captures": [{"id": "c0000000-0000-4000-8000-000000000351", "status": "sorted"}]}
  $json$::jsonb);
select ok((select title = 'Training' and data = '{"x": 1, "reminder_minutes": "60"}'::jsonb
  from public.items where id = 'e0000000-0000-4000-8000-000000000351'),
  'the tidied event gets its reminder too');

select * from finish();
rollback;
