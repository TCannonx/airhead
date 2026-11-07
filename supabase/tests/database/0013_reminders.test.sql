-- Tests for migration 0013: reminders follow items (create, move, complete, delete).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.settings (id, user_id, data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a',
   '{"time_zone": "Europe/Dublin"}');

-- The item is written as its owner would (through RLS), like a synced device.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

-- Create ------------------------------------------------------------------------
insert into public.items (id, type, title, start_at, end_at, data) values
  ('e0000000-0000-4000-8000-000000000001', 'event', 'Dentist',
   date_trunc('minute', now()) + interval '3 days', date_trunc('minute', now()) + interval '3 days 1 hour',
   '{"location": "Smile Clinic"}');
reset role;

select is((select count(*)::int from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  1, 'an event gets one reminder');
select is((select send_at from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  date_trunc('minute', now()) + interval '3 days' - interval '30 minutes', 'by default 30 minutes before');
select is((select kind || '|' || status || '|' || url from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  'event_reminder|pending|/calendar', 'pending event reminder opening the calendar');
select matches((select body from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  '^In 30 min · \d\d:\d\d · Smile Clinic$', 'body: in 30 min, local time, place');

-- Move ---------------------------------------------------------------------------------
update public.items set start_at = start_at + interval '1 day' where id = 'e0000000-0000-4000-8000-000000000001';
select is((select send_at from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  date_trunc('minute', now()) + interval '4 days' - interval '30 minutes', 'moving the event moves the reminder');
select is((select count(*)::int from public.nudges), 1, 'still one nudge');

-- A sent reminder is armed again when the event moves
update public.nudges set status = 'sent', sent_at = now() where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001';
update public.items set start_at = start_at + interval '1 day' where id = 'e0000000-0000-4000-8000-000000000001';
select is((select status from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  'pending', 'a moved event is reminded again');
-- …but an unrelated edit doesn't resend it
update public.nudges set status = 'sent', sent_at = now() where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001';
update public.items set title = 'Dentist (Dr Byrne)' where id = 'e0000000-0000-4000-8000-000000000001';
select is((select status from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  'sent', 'a title change does not resend');

-- Per-event override and "none"
update public.nudges set status = 'pending', sent_at = null;
update public.items set data = data || '{"reminder_minutes": "90"}' where id = 'e0000000-0000-4000-8000-000000000001';
select is((select start_at - send_at from public.nudges n join public.items i on i.id = n.item_id
  where n.dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'), interval '90 minutes', 'per-event override');
update public.items set data = data || '{"reminder_minutes": "none"}' where id = 'e0000000-0000-4000-8000-000000000001';
select is((select status from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000001'),
  'cancelled', '"none" cancels the reminder');

-- Settings default
update public.settings set data = data || '{"notifications": {"event_reminder_minutes": 15}}'
 where id = '00000000-0000-0000-0000-00000000000a';
insert into public.items (id, user_id, type, title, start_at) values
  ('e0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'event', 'Call',
   date_trunc('minute', now()) + interval '2 days');
select is((select send_at from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000002'),
  date_trunc('minute', now()) + interval '2 days' - interval '15 minutes', 'the default comes from settings');

-- Complete / delete ----------------------------------------------------------------------
insert into public.items (id, user_id, type, title, due_at) values
  ('e0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'task', 'Send invoice',
   date_trunc('minute', now()) + interval '1 day');
select is((select kind || '|' || title || '|' || url from public.nudges where dedupe_key = 'task:e0000000-0000-4000-8000-000000000003'),
  'task_due|Due: Send invoice|/library/item/e0000000-0000-4000-8000-000000000003', 'a task gets a due reminder');
update public.items set status = 'done', completed_at = now() where id = 'e0000000-0000-4000-8000-000000000003';
select is((select status from public.nudges where dedupe_key = 'task:e0000000-0000-4000-8000-000000000003'),
  'cancelled', 'completing the task cancels it');
update public.items set deleted_at = now() where id = 'e0000000-0000-4000-8000-000000000002';
select is((select status from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000002'),
  'cancelled', 'deleting the event cancels it');

-- Time TBC, past events, suggestions, recurring ------------------------------------------
insert into public.items (id, user_id, type, title, all_day, start_at, data) values
  ('e0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-00000000000a', 'event', 'Final', true,
   ((current_date + 30)::timestamp at time zone 'Europe/Dublin'), '{"time_tbc": true}');
select is((select kind from public.nudges where dedupe_key = 'tbc:e0000000-0000-4000-8000-000000000004'),
  'check_time', 'a time-TBC event gets a check-the-time nudge');
select is((select (send_at at time zone 'Europe/Dublin') from public.nudges where dedupe_key = 'tbc:e0000000-0000-4000-8000-000000000004'),
  (current_date + 23) + time '10:00', '10:00 local, a week before');
select is((select count(*)::int from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000004'),
  0, 'all-day events get no timed reminder');

insert into public.items (id, user_id, type, title, start_at) values
  ('e0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-00000000000a', 'event', 'Soon', now() + interval '10 minutes'),
  ('e0000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-00000000000a', 'event', 'Weekly', now() + interval '2 days');
update public.items set rrule = 'FREQ=WEEKLY' where id = 'e0000000-0000-4000-8000-000000000006';
insert into public.items (id, user_id, type, title, status, start_at) values
  ('e0000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-00000000000a', 'event', 'Maybe', 'suggested', now() + interval '2 days');
select is((select count(*)::int from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000005'),
  0, 'too late to remind: no nudge');
select is((select status from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000006'),
  'cancelled', 'recurring events are left to the scheduler');
select is((select count(*)::int from public.nudges where dedupe_key = 'event:e0000000-0000-4000-8000-000000000007'),
  0, 'suggestions get no reminder until accepted');

select ok(not has_function_privilege('authenticated', 'public.upsert_nudge(uuid, text, text, uuid, timestamptz, text, text, text)', 'execute'),
  'devices cannot create nudges directly');

select * from finish();
rollback;
