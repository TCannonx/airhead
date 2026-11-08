-- Tests for apply_sort_batch v3 (migration 0031): AI actions.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.settings (id, user_id, data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a',
   '{"time_zone": "Europe/Dublin", "work": {"entitlement": 21}}');
insert into public.captures (id, user_id, text, status) values
  ('c0000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-00000000000a', '9.5 days left', 'unsorted'),
  ('c0000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-00000000000a', 'sorted meanwhile', 'sorted');
insert into public.items (id, user_id, type, title, status, start_at, end_at, all_day, updated_at) values
  ('e0000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-00000000000a', 'event', 'Dentist',
   'open', '2030-11-10T15:00:00Z', '2030-11-10T16:00:00Z', false, '2026-11-01T09:00:00Z'),
  ('e0000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-00000000000a', 'event', 'Physio',
   'open', '2030-11-11T15:00:00Z', null, false, '2026-11-05T09:00:00Z');

select is(
  public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {
    "items": [
      {"id": "f0000000-0000-4000-8000-000000000031",
       "capture_id": "c0000000-0000-4000-8000-000000000031", "type": "event", "title": "Dinner",
       "body": null, "status": "open", "start_at": "2030-11-14T19:00:00.000Z", "end_at": null,
       "all_day": false, "due_at": null, "rrule": null, "calendar": "personal", "list_id": null,
       "topic_names": [], "confidence": 0.9, "data": {"reminder_minutes": "1440"}}
    ],
    "actions": [
      {"id": "a0000000-0000-4000-8000-000000000031", "capture_id": "c0000000-0000-4000-8000-000000000031",
       "kind": "set_leave_remaining", "status": "applied", "reason": null,
       "summary": "Leave left set to 9.5 days", "quote": "9.5 days left", "confidence": 0.9, "payload": {},
       "target_table": "settings", "target_id": "00000000-0000-0000-0000-00000000000a",
       "before": {"opening_used": null}, "after": {"opening_used": {"2025-12-01": 11.5}}},
      {"id": "a0000000-0000-4000-8000-000000000032", "capture_id": "c0000000-0000-4000-8000-000000000031",
       "kind": "book_leave", "status": "applied", "reason": null,
       "summary": "Annual leave booked: 22–24 Dec (3 days)", "quote": "off 22-24 Dec", "confidence": 0.9,
       "payload": {}, "target_table": "leave_bookings", "target_id": "b0000000-0000-4000-8000-000000000031",
       "before": null, "after": {"start_date": "2030-12-22", "end_date": "2030-12-24", "start_half": false,
       "end_half": false, "leave_type": "annual", "status": "planned", "days": 3}},
      {"id": "a0000000-0000-4000-8000-000000000033", "capture_id": "c0000000-0000-4000-8000-000000000031",
       "kind": "reschedule_item", "status": "applied", "reason": null,
       "summary": "Moved Dentist", "quote": "dentist moved", "confidence": 0.9, "payload": {},
       "target_table": "items", "target_id": "e0000000-0000-4000-8000-000000000031",
       "before": {"start_at": "2030-11-10T15:00:00.000Z", "end_at": "2030-11-10T16:00:00.000Z",
                  "all_day": false, "updated_at": "2026-11-01T09:00:00+00:00"},
       "after": {"start_at": "2030-11-12T16:00:00.000Z", "end_at": "2030-11-12T17:00:00.000Z", "all_day": false}},
      {"id": "a0000000-0000-4000-8000-000000000034", "capture_id": "c0000000-0000-4000-8000-000000000031",
       "kind": "reschedule_item", "status": "applied", "reason": null,
       "summary": "Moved Physio", "quote": "physio moved", "confidence": 0.9, "payload": {},
       "target_table": "items", "target_id": "e0000000-0000-4000-8000-000000000032",
       "before": {"start_at": "2030-11-11T15:00:00.000Z", "end_at": null, "all_day": false,
                  "updated_at": "2026-11-04T09:00:00+00:00"},
       "after": {"start_at": "2030-11-13T15:00:00.000Z", "end_at": null, "all_day": false}},
      {"id": "a0000000-0000-4000-8000-000000000035", "capture_id": "c0000000-0000-4000-8000-000000000031",
       "kind": "reschedule_item", "status": "proposed", "reason": "Which one?",
       "summary": "Move Team meeting", "quote": "meeting moved", "confidence": 0.9,
       "payload": {"choices": ["x", "y"]}, "target_table": null, "target_id": null, "before": null, "after": null},
      {"id": "a0000000-0000-4000-8000-000000000036", "capture_id": "c0000000-0000-4000-8000-000000000032",
       "kind": "update_work_setting", "status": "applied", "reason": null,
       "summary": "Entitlement set to 30 days", "quote": "x", "confidence": 0.9, "payload": {},
       "target_table": "settings", "target_id": "00000000-0000-0000-0000-00000000000a",
       "before": {"entitlement": 21}, "after": {"entitlement": 30}}
    ],
    "captures": [
      {"id": "c0000000-0000-4000-8000-000000000031", "status": "needs_review"},
      {"id": "c0000000-0000-4000-8000-000000000032", "status": "sorted"}
    ]
  }
  $json$::jsonb),
  '{"items": 1, "captures": 1, "links": 0, "actions": 5}'::jsonb,
  'applies the actions of still-unsorted captures only');

select is((select data -> 'work' from public.settings where user_id = '00000000-0000-0000-0000-00000000000a'),
  '{"entitlement": 21, "opening_used": {"2025-12-01": 11.5}}'::jsonb,
  'the leave figure is merged into work settings; other keys and the stale capture untouched');
select ok((select capture_id = 'c0000000-0000-4000-8000-000000000031' and days = 3 and status = 'planned'
  from public.leave_bookings where id = 'b0000000-0000-4000-8000-000000000031'), 'the leave is booked');
select is((select start_at from public.items where id = 'e0000000-0000-4000-8000-000000000031'),
  '2030-11-12T16:00:00Z'::timestamptz, 'the untouched dentist moved');
select is((select send_at from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000031'),
  '2030-11-12T15:30:00Z'::timestamptz, 'its reminder moved with it');
select is((select start_at from public.items where id = 'e0000000-0000-4000-8000-000000000032'),
  '2030-11-11T15:00:00Z'::timestamptz, 'an item edited since the plan is left alone');
select results_eq($$ select status || ':' || coalesce(reason, '') from public.ai_actions order by id $$,
  array['applied:', 'applied:', 'applied:', 'proposed:Changed meanwhile; check before applying',
        'proposed:Which one?'],
  'every action is recorded; the stale move became a proposal');
select ok((select id = 'f0000000-0000-4000-8000-000000000031' and data ->> 'reminder_minutes' = '1440'
  from public.items where title = 'Dinner'), 'new items keep their planned id and reminder');
select is((select send_at from public.nudges where dedupe_key = 'event:f0000000-0000-4000-8000-000000000031'),
  '2030-11-13T19:00:00Z'::timestamptz, 'the new event reminds a day before');

-- The settings guard: a key changed since the plan makes it a proposal.
insert into public.captures (id, user_id, text, status) values
  ('c0000000-0000-4000-8000-000000000033', '00000000-0000-0000-0000-00000000000a', 'I get 23 days', 'unsorted');
select public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {"actions": [
    {"id": "a0000000-0000-4000-8000-000000000037", "capture_id": "c0000000-0000-4000-8000-000000000033",
     "kind": "update_work_setting", "status": "applied", "reason": null, "summary": "Entitlement set to 23 days",
     "quote": "I get 23 days", "confidence": 0.9, "payload": {}, "target_table": "settings",
     "target_id": "00000000-0000-0000-0000-00000000000a", "before": {"entitlement": 20}, "after": {"entitlement": 23}}
  ], "captures": [{"id": "c0000000-0000-4000-8000-000000000033", "status": "sorted"}]}
  $json$::jsonb);
select is((select data -> 'work' ->> 'entitlement' from public.settings where user_id = '00000000-0000-0000-0000-00000000000a'),
  '21', 'a setting changed since the plan is not overwritten');
select is((select status from public.ai_actions where id = 'a0000000-0000-4000-8000-000000000037'),
  'proposed', 'and the action waits for a tap');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', '{}'::jsonb) $$,
  '42501', null, 'devices cannot call apply_sort_batch');
reset role;

select * from finish();
rollback;
