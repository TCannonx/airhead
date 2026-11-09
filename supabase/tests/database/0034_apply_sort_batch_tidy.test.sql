-- Tests for apply_sort_batch v4 (migration 0034): tidying instant events (Task 11.1).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.captures (id, user_id, text, status, payload) values
  ('c0000000-0000-4000-8000-000000000341', '00000000-0000-0000-0000-00000000000a',
   'Training on Tuesday. Need a reminder to send report to Trevor', 'unsorted',
   '{"instant_item_id": "e0000000-0000-4000-8000-000000000341"}'),
  ('c0000000-0000-4000-8000-000000000342', '00000000-0000-0000-0000-00000000000a',
   'Quiz every Thursday 8pm. Bring a pen and then quiz', 'unsorted',
   '{"instant_item_id": "e0000000-0000-4000-8000-000000000342"}');
insert into public.items (id, user_id, capture_id, type, title, status, start_at, all_day, calendar, updated_at) values
  ('e0000000-0000-4000-8000-000000000341', '00000000-0000-0000-0000-00000000000a',
   'c0000000-0000-4000-8000-000000000341', 'event',
   'Training . Need a reminder to send report to Trevor', 'suggested',
   '2030-11-12T00:00:00Z', true, 'personal', '2026-11-01T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000342', '00000000-0000-0000-0000-00000000000a',
   'c0000000-0000-4000-8000-000000000342', 'event',
   'Quiz . Bring a pen and then quiz', 'open',
   '2030-11-14T20:00:00Z', false, 'personal', '2026-11-05T09:00:00Z');

select is(
  public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {
    "items": [
      {"id": "f0000000-0000-4000-8000-000000000341",
       "capture_id": "c0000000-0000-4000-8000-000000000341", "type": "task",
       "title": "Send report to Trevor", "body": null, "status": "open", "start_at": null,
       "end_at": null, "all_day": false, "due_at": null, "rrule": null, "calendar": null,
       "list_id": null, "topic_names": [], "confidence": 0.9, "data": {}}
    ],
    "item_updates": [
      {"id": "a0000000-0000-4000-8000-000000000341",
       "capture_id": "c0000000-0000-4000-8000-000000000341",
       "item_id": "e0000000-0000-4000-8000-000000000341",
       "summary": "Tidied “Training” and added 1 item",
       "quote": "Training . Need a reminder to send report to Trevor", "confidence": 0.9,
       "before": {"title": "Training . Need a reminder to send report to Trevor", "status": "suggested",
                  "updated_at": "2026-11-01T09:00:00+00:00"},
       "after": {"title": "Training", "status": "open"}},
      {"id": "a0000000-0000-4000-8000-000000000342",
       "capture_id": "c0000000-0000-4000-8000-000000000342",
       "item_id": "e0000000-0000-4000-8000-000000000342",
       "summary": "Tidied “Quiz”", "quote": "Quiz . Bring a pen and then quiz", "confidence": 0.9,
       "before": {"title": "Quiz . Bring a pen and then quiz", "end_at": null, "rrule": null,
                  "updated_at": "2026-11-04T09:00:00+00:00"},
       "after": {"title": "Quiz", "end_at": "2030-11-15T00:00:00.000Z", "rrule": "FREQ=WEEKLY;BYDAY=TH"}}
    ],
    "captures": [
      {"id": "c0000000-0000-4000-8000-000000000341", "status": "sorted"},
      {"id": "c0000000-0000-4000-8000-000000000342", "status": "sorted"}
    ]
  }
  $json$::jsonb),
  '{"items": 1, "captures": 2, "links": 0, "actions": 2}'::jsonb,
  'the new task is added and both tidy-ups are recorded');

select ok((select title = 'Training' and status = 'open' and all_day and start_at = '2030-11-12T00:00:00Z'
  from public.items where id = 'e0000000-0000-4000-8000-000000000341'),
  'the instant event is tidied in place (title and status), other columns kept');
select is((select count(*)::int from public.items where capture_id = 'c0000000-0000-4000-8000-000000000341'),
  2, 'no second event: the tidied one plus the task');
select ok((select title = 'Send report to Trevor' and type = 'task'
  from public.items where id = 'f0000000-0000-4000-8000-000000000341'), 'the lost task now exists');
select ok((select title = 'Quiz . Bring a pen and then quiz' and end_at is null and rrule is null
  from public.items where id = 'e0000000-0000-4000-8000-000000000342'),
  'an event edited since the plan is left alone');
select results_eq($$ select kind || ':' || status || ':' || coalesce(reason, '') || ':' || summary
    from public.ai_actions order by id $$,
  array['tidy_item:applied::Tidied “Training” and added 1 item',
        'tidy_item:proposed:Changed meanwhile; check before applying:Tidied “Quiz”'],
  'logged as tidy_item: applied, or a proposal when the event changed meanwhile');
select ok((select target_table = 'items' and target_id = 'e0000000-0000-4000-8000-000000000341'
    and before ->> 'title' = 'Training . Need a reminder to send report to Trevor'
    and after ->> 'title' = 'Training'
  from public.ai_actions where id = 'a0000000-0000-4000-8000-000000000341'),
  'before and after are kept for Undo');

-- A capture already sorted elsewhere is not tidied.
insert into public.captures (id, user_id, text, status) values
  ('c0000000-0000-4000-8000-000000000343', '00000000-0000-0000-0000-00000000000a', 'done meanwhile', 'sorted');
insert into public.items (id, user_id, capture_id, type, title, status, start_at, all_day, updated_at) values
  ('e0000000-0000-4000-8000-000000000343', '00000000-0000-0000-0000-00000000000a',
   'c0000000-0000-4000-8000-000000000343', 'event', 'Messy', 'open', '2030-11-14T20:00:00Z', false,
   '2026-11-05T09:00:00Z');
select public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {"item_updates": [
    {"id": "a0000000-0000-4000-8000-000000000343", "capture_id": "c0000000-0000-4000-8000-000000000343",
     "item_id": "e0000000-0000-4000-8000-000000000343", "summary": "Tidied “Clean”", "quote": "Messy",
     "confidence": 0.9, "before": {"title": "Messy", "updated_at": "2026-11-05T09:00:00+00:00"},
     "after": {"title": "Clean"}}
  ], "captures": [{"id": "c0000000-0000-4000-8000-000000000343", "status": "sorted"}]}
  $json$::jsonb);
select is((select title from public.items where id = 'e0000000-0000-4000-8000-000000000343'),
  'Messy', 'a capture no longer unsorted is not tidied');
select is((select count(*)::int from public.ai_actions where id = 'a0000000-0000-4000-8000-000000000343'),
  0, 'and nothing is logged for it');

select * from finish();
rollback;
