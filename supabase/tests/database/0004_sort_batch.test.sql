-- Tests for apply_sort_batch (migration 20261107000004).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.captures (id, user_id, text, status) values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'brain dump', 'unsorted'),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'garden thing', 'unsorted'),
  ('c0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'sorted on a device meanwhile', 'sorted');
insert into public.topics (id, user_id, name) values
  ('70000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Home');

select is(
  public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', $json$
  {
    "new_topics": ["Garden", "home"],
    "items": [
      {"capture_id": "c0000000-0000-4000-8000-000000000001", "type": "event", "title": "Dentist",
       "body": null, "status": "open", "start_at": "2026-11-10T15:00:00.000Z", "end_at": null,
       "all_day": false, "due_at": null, "rrule": null, "calendar": "personal", "list_id": null,
       "topic_names": ["HOME"], "confidence": 0.95, "data": {}},
      {"capture_id": "c0000000-0000-4000-8000-000000000002", "type": "idea", "title": "Garden thing",
       "body": null, "status": "suggested", "start_at": null, "end_at": null, "all_day": false,
       "due_at": null, "rrule": null, "calendar": null, "list_id": null,
       "topic_names": ["Garden"], "confidence": 0.4, "data": {"workshop": true}},
      {"capture_id": "c0000000-0000-4000-8000-000000000003", "type": "task", "title": "Should not appear",
       "body": null, "status": "open", "start_at": null, "end_at": null, "all_day": false,
       "due_at": null, "rrule": null, "calendar": null, "list_id": null,
       "topic_names": [], "confidence": 0.9, "data": {}}
    ],
    "captures": [
      {"id": "c0000000-0000-4000-8000-000000000001", "status": "sorted"},
      {"id": "c0000000-0000-4000-8000-000000000002", "status": "needs_review"},
      {"id": "c0000000-0000-4000-8000-000000000003", "status": "sorted"}
    ]
  }
  $json$::jsonb),
  '{"items": 2, "captures": 2}'::jsonb,
  'applies items for still-unsorted captures only');

select results_eq($$ select title from public.items order by title $$,
  array['Dentist', 'Garden thing'], 'items inserted; the capture sorted meanwhile is skipped');
select results_eq($$ select count(*)::int from public.topics where lower(name) = 'home' $$,
  array[1], 'an existing topic is reused (case-insensitive), not duplicated');
select results_eq($$ select count(*)::int from public.topics where name = 'Garden' $$,
  array[1], 'a new topic is created once');
select ok((select topic_ids = array['70000000-0000-4000-8000-000000000001'::uuid] from public.items where title = 'Dentist'),
  'topic names are mapped to ids');
select ok((select data ->> 'workshop' = 'true' and status = 'suggested' from public.items where title = 'Garden thing'),
  'status and data are kept');
select results_eq($$ select status from public.captures order by id $$,
  array['sorted', 'needs_review', 'sorted'], 'capture statuses updated; the other one untouched');
select ok((select sorted_at is not null from public.captures where id = 'c0000000-0000-4000-8000-000000000002'),
  'sorted_at is stamped');
select ok((select server_updated_at is not null from public.items where title = 'Dentist'),
  'new items get server_updated_at, so devices pull them');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.apply_sort_batch('00000000-0000-0000-0000-00000000000a', '{}'::jsonb) $$,
  '42501', null, 'apps cannot call it directly (service role only)');

reset role;
select * from finish();
rollback;
