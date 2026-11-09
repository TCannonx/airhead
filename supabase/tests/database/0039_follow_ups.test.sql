-- Tests for migration 0039: follow-ups and apply_sort_batch v7 (Task 12.1).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.captures (id, user_id, text, status) values
  ('c0000000-0000-4000-8000-000000000391', '00000000-0000-0000-0000-00000000000a',
   'Planning Christmas sandwiches every week on a Friday. Still need to plan but keep as a placeholder',
   'unsorted'),
  -- Sorted meanwhile on another device: no questions for it.
  ('c0000000-0000-4000-8000-000000000392', '00000000-0000-0000-0000-00000000000a',
   'done elsewhere', 'sorted');

insert into public.items (id, user_id, type, title, body, updated_at) values
  ('10000000-0000-4000-8000-000000000393', '00000000-0000-0000-0000-00000000000a', 'event',
   'Old event', null, '2026-11-01T10:00:00Z');

select is(
  public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {
    "items": [
      {"id": "f0000000-0000-4000-8000-000000000391", "capture_id": "c0000000-0000-4000-8000-000000000391",
       "type": "event", "title": "Christmas sandwiches", "status": "open",
       "start_at": "2030-11-15T00:00:00Z", "all_day": true, "rrule": "FREQ=WEEKLY;BYDAY=FR",
       "calendar": "personal", "topic_names": [], "confidence": 0.9, "data": {}},
      {"id": "f0000000-0000-4000-8000-000000000392", "capture_id": "c0000000-0000-4000-8000-000000000391",
       "type": "task", "title": "Plan Christmas sandwiches", "status": "open",
       "due_at": "2030-11-14T09:00:00Z", "all_day": false, "topic_names": [], "confidence": 0.9,
       "body": "- [ ] Decide who they are for", "data": {"planning": true}}
    ],
    "captures": [
      {"id": "c0000000-0000-4000-8000-000000000391", "status": "sorted"},
      {"id": "c0000000-0000-4000-8000-000000000392", "status": "sorted"}
    ],
    "follow_ups": [
      {"id": "d0000000-0000-4000-8000-000000000391", "capture_id": "c0000000-0000-4000-8000-000000000391",
       "item_id": "f0000000-0000-4000-8000-000000000391", "question": "Who are the sandwiches for?",
       "options": ["Family", "Work"]},
      {"id": "d0000000-0000-4000-8000-000000000392", "capture_id": "c0000000-0000-4000-8000-000000000391",
       "item_id": "f0000000-0000-4000-8000-0000000003ff", "question": "How many people?", "options": [],
       "round": 2},
      {"id": "d0000000-0000-4000-8000-000000000393", "capture_id": "c0000000-0000-4000-8000-000000000392",
       "item_id": null, "question": "Too late?", "options": []}
    ],
    "item_updates": [
      {"id": "a0000000-0000-4000-8000-000000000393", "capture_id": "c0000000-0000-4000-8000-000000000391",
       "item_id": "10000000-0000-4000-8000-000000000393", "summary": "Added details", "quote": "for 12",
       "confidence": 1, "before": {"body": null, "updated_at": "2026-11-01T10:00:00Z"},
       "after": {"body": "Who are they for? For 12 people"}}
    ]
  }
  $json$::jsonb) ->> 'follow_ups',
  '2',
  'questions are inserted with the batch; none for a capture sorted meanwhile');

select results_eq(
  $$ select question, options, status, item_id::text, round from public.follow_ups
     where id = 'd0000000-0000-4000-8000-000000000391' $$,
  $$ values ('Who are the sandwiches for?'::text, '["Family", "Work"]'::jsonb, 'open'::text,
             'f0000000-0000-4000-8000-000000000391'::text, 1) $$,
  'a question links to the item made in the same batch, open, round 1');

select results_eq(
  $$ select item_id, round from public.follow_ups where id = 'd0000000-0000-4000-8000-000000000392' $$,
  $$ values (null::uuid, 2) $$,
  'an item that does not exist is not linked');

select is((select body from public.items where id = '10000000-0000-4000-8000-000000000393'),
  'Who are they for? For 12 people', 'an update may set the item body (Task 12.2)');

select throws_ok($$ insert into public.follow_ups (user_id, question, status) values
  ('00000000-0000-0000-0000-00000000000a', 'x', 'maybe') $$, '23514', null, 'status is checked');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::integer from public.follow_ups), 2, 'the owner sees their questions');
select lives_ok($$ update public.follow_ups set status = 'answered', answer = 'Work'
  where id = 'd0000000-0000-4000-8000-000000000391' $$, 'the owner answers one');
select throws_ok($$ delete from public.follow_ups $$, '42501', null, 'devices cannot delete questions');
select throws_ok($$ insert into public.follow_ups (user_id, question) values
  ('00000000-0000-0000-0000-00000000000b', 'x') $$, '42501', null, 'nobody inserts for someone else');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.follow_ups $$, 'others cannot read questions');
update public.follow_ups set status = 'dismissed';
reset role;
select is((select status from public.follow_ups where id = 'd0000000-0000-4000-8000-000000000391'),
  'answered', 'others cannot change questions');

select * from finish();
rollback;
