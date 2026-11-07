-- Tests for migration 0016: the morning digest.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');
insert into public.settings (id, user_id, data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '{"time_zone": "Europe/Dublin"}');

-- Wednesday 15 July 2026 (Irish summer time: UTC+1)
insert into public.items (id, user_id, type, title, start_at, end_at, data, all_day, body) values
  ('e0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'event', 'Dentist',
   '2026-07-15T14:00:00Z', '2026-07-15T14:30:00Z', '{"location": "Smile Clinic"}', false, 'secret notes'),
  ('e0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'event', 'Late film',
   '2026-07-15T22:30:00Z', null, '{}', false, null), -- 23:30 local: still today
  ('e0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'event', 'Next week',
   '2026-07-22T09:00:00Z', null, '{}', false, null),
  ('e0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-00000000000a', 'event', 'Too far',
   '2026-07-24T09:00:00Z', null, '{}', false, null);
insert into public.items (id, user_id, type, title, start_at, rrule) values
  ('e0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   '2026-07-07T18:00:00Z', 'FREQ=WEEKLY;BYDAY=TU,TH');
insert into public.items (id, user_id, type, title, due_at, top3_date, carry_count, status, deleted_at, completed_at) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'task', 'Overdue form',
   '2026-07-13T09:00:00Z', null, 2, 'open', null, null),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'task', 'Plan trip',
   null, '2026-07-15', 0, 'open', null, null),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'task', 'Deleted task',
   null, null, 0, 'open', now(), null),
  ('a0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-00000000000a', 'task', 'Done yesterday',
   null, null, 0, 'done', null, '2026-07-14T12:00:00Z'),
  ('a0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-00000000000a', 'task', 'Yesterday top 3',
   null, '2026-07-14', 0, 'open', null, null);
insert into public.items (user_id, type, title) values
  ('00000000-0000-0000-0000-00000000000a', 'idea', 'Garden office'),
  ('00000000-0000-0000-0000-00000000000b', 'task', 'Someone else''s task');
insert into public.captures (user_id, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000a', 'x', '2026-07-14T10:00:00Z'),
  ('00000000-0000-0000-0000-00000000000a', 'y', '2026-07-14T22:59:00Z'), -- 23:59 local on the 14th
  ('00000000-0000-0000-0000-00000000000a', 'z', '2026-07-14T23:01:00Z'); -- 00:01 local on the 15th
insert into public.leave_bookings (user_id, start_date, end_date, status) values
  ('00000000-0000-0000-0000-00000000000a', '2026-07-17', '2026-07-17', 'approved');
insert into public.work_days (user_id, date, location) values
  ('00000000-0000-0000-0000-00000000000a', '2026-07-16', 'client');

create temporary table d as
  select public.morning_digest('00000000-0000-0000-0000-00000000000a', '2026-07-15') as j;

select is((select j ->> 'weekday' from d), 'Wednesday', 'weekday');
select is((select jsonb_array_length(j -> 'events') from d), 3, 'events from today to 7 days ahead');
select is((select j -> 'events' -> 0 ->> 'start' from d), '15:00', 'times are local');
select is((select j -> 'events' -> 1 ->> 'date' from d), '2026-07-15', 'a 23:30 local event is today');
select is((select j -> 'events' -> 0 ->> 'location' from d), 'Smile Clinic', 'location included');
select ok((select j::text not like '%secret notes%' from d), 'notes are never included');
select is((select j -> 'recurring' -> 0 ->> 'rrule' from d), 'FREQ=WEEKLY;BYDAY=TU,TH', 'recurring events passed for expansion');
select is((select jsonb_agg(t ->> 'title') from d, jsonb_array_elements(j -> 'tasks') t),
  '["Overdue form", "Plan trip", "Yesterday top 3"]'::jsonb, 'open tasks: overdue first, then Top 3; deleted left out');
select is((select j -> 'yesterday' from d), '{"done": 1, "captured": 2, "unfinished_top3": 1}'::jsonb,
  'yesterday in local time');
select is((select jsonb_array_length(j -> 'leave') from d), 1, 'leave this week');
select is((select j -> 'work_days' -> 0 ->> 'location' from d), 'client', 'location overrides this week');
select is((select j -> 'ideas' -> 0 ->> 'title' from d), 'Garden office', 'active ideas');
select ok((select j::text not like '%Someone else%' from d), 'only this person''s data');

select ok(not has_function_privilege('authenticated', 'public.morning_digest(uuid, date)', 'execute'),
  'devices cannot read digests');
select ok(has_function_privilege('service_role', 'public.morning_digest(uuid, date)', 'execute'),
  'the brief function can');

select * from finish();
rollback;
