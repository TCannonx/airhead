-- Tests for migration 0036: Workshop routing in apply_sort_batch v6 (Task 11.2).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.captures (id, user_id, text, status) values
  -- Could not be placed at all.
  ('c0000000-0000-4000-8000-000000000361', '00000000-0000-0000-0000-00000000000a',
   'hmm the thing with the stuff', 'unsorted'),
  -- An event plus words no item covers.
  ('c0000000-0000-4000-8000-000000000362', '00000000-0000-0000-0000-00000000000a',
   'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder',
   'unsorted'),
  -- Sorted meanwhile on another device: left alone.
  ('c0000000-0000-4000-8000-000000000363', '00000000-0000-0000-0000-00000000000a',
   'done elsewhere', 'sorted');

insert into public.items (id, user_id, capture_id, type, title, data) values
  ('10000000-0000-4000-8000-000000000364', '00000000-0000-0000-0000-00000000000a', null, 'note',
   'Typed note', '{"doc_kind": "typed"}');

select is(
  public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {
    "items": [
      {"id": "f0000000-0000-4000-8000-000000000361", "capture_id": "c0000000-0000-4000-8000-000000000361",
       "type": "note", "title": "Hmm the thing with the stuff", "body": "hmm the thing with the stuff",
       "status": "open", "all_day": false, "topic_names": [], "confidence": 1,
       "data": {"workshop": true, "workshop_from": "unmapped"}},
      {"id": "f0000000-0000-4000-8000-000000000362", "capture_id": "c0000000-0000-4000-8000-000000000362",
       "type": "event", "title": "Christmas sandwiches", "status": "open",
       "start_at": "2030-11-15T00:00:00Z", "all_day": true, "rrule": "FREQ=WEEKLY;BYDAY=FR",
       "calendar": "personal", "topic_names": [], "confidence": 0.9, "data": {}},
      {"id": "f0000000-0000-4000-8000-000000000363", "capture_id": "c0000000-0000-4000-8000-000000000362",
       "type": "note", "title": "Still need to plan",
       "body": "Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder",
       "status": "open", "all_day": false, "topic_names": [], "confidence": 1,
       "data": {"workshop": true, "workshop_from": "leftover"}},
      {"id": "f0000000-0000-4000-8000-000000000365", "capture_id": "c0000000-0000-4000-8000-000000000363",
       "type": "note", "title": "Too late", "status": "open", "all_day": false, "topic_names": [],
       "confidence": 1, "data": {"workshop": true, "workshop_from": "unmapped"}}
    ],
    "captures": [
      {"id": "c0000000-0000-4000-8000-000000000361", "status": "sorted"},
      {"id": "c0000000-0000-4000-8000-000000000362", "status": "sorted"},
      {"id": "c0000000-0000-4000-8000-000000000363", "status": "sorted"}
    ],
    "workshop": [
      {"capture_id": "c0000000-0000-4000-8000-000000000361",
       "item_id": "f0000000-0000-4000-8000-000000000361", "reason": "unmapped"},
      {"capture_id": "c0000000-0000-4000-8000-000000000362",
       "item_id": "f0000000-0000-4000-8000-000000000363", "reason": "leftover"},
      {"capture_id": "c0000000-0000-4000-8000-000000000363",
       "item_id": "f0000000-0000-4000-8000-000000000365", "reason": "unmapped"}
    ],
    "notes": [
      {"id": "10000000-0000-4000-8000-000000000364", "seen_len": 10, "seen_hash": "abc",
       "workshop": true}
    ]
  }
  $json$::jsonb) ->> 'items',
  '3',
  'the Workshop notes and the event are inserted; nothing for a capture sorted meanwhile');

select results_eq(
  $$ select status, payload ->> 'workshop_item_id', payload ->> 'workshop_reason'
     from public.captures where id = 'c0000000-0000-4000-8000-000000000361' $$,
  $$ values ('sorted'::text, 'f0000000-0000-4000-8000-000000000361'::text, 'unmapped'::text) $$,
  'an unplaced capture is sorted and points at its Workshop note');

select ok((select data ->> 'workshop' = 'true' and body = 'hmm the thing with the stuff'
  from public.items where id = 'f0000000-0000-4000-8000-000000000361'),
  'the Workshop note keeps the capture text word for word');

select results_eq(
  $$ select payload ->> 'workshop_item_id', payload ->> 'workshop_reason'
     from public.captures where id = 'c0000000-0000-4000-8000-000000000362' $$,
  $$ values ('f0000000-0000-4000-8000-000000000363'::text, 'leftover'::text) $$,
  'a partly placed capture points at the note made from its leftover');

select is(
  (select count(*)::integer from public.items
   where capture_id = 'c0000000-0000-4000-8000-000000000362' and deleted_at is null),
  2, 'the event and the leftover note, in the same transaction');

select ok(
  (select not (payload ? 'workshop_item_id') from public.captures
   where id = 'c0000000-0000-4000-8000-000000000363'),
  'a capture sorted meanwhile is not touched');

select ok(
  (select data ->> 'workshop' = 'true' and data ->> 'ai_seen_hash' = 'abc' and title = 'Typed note'
   from public.items where id = '10000000-0000-4000-8000-000000000364'),
  'a note with leftover words is marked for the Workshop when stamped; its title is unchanged');

select * from finish();
rollback;
