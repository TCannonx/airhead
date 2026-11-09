-- Tests for migration 0038: the morning digest passes a series' exceptions.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.settings (id, user_id, data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '{"time_zone": "Europe/Dublin"}');
insert into public.items (id, user_id, type, title, start_at, rrule, data) values
  ('e0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   '2026-07-07T18:00:00Z', 'FREQ=WEEKLY;BYDAY=TU,TH', '{"exdates": ["2026-07-16T18:00:00.000Z"]}'),
  ('e0000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-00000000000a', 'event', 'Quiz',
   '2026-07-09T19:00:00Z', 'FREQ=WEEKLY;BYDAY=TH', '{}');

with d as (select public.morning_digest('00000000-0000-0000-0000-00000000000a', '2026-07-15') j)
select is(
  (select r -> 'exdates' from d, jsonb_array_elements(j -> 'recurring') r where r ->> 'title' = 'Training'),
  '["2026-07-16T18:00:00.000Z"]'::jsonb, 'exceptions go with the series');
with d as (select public.morning_digest('00000000-0000-0000-0000-00000000000a', '2026-07-15') j)
select is(
  (select r -> 'exdates' from d, jsonb_array_elements(j -> 'recurring') r where r ->> 'title' = 'Quiz'),
  '[]'::jsonb, 'a series with no exceptions has an empty list');
select ok(
  not has_function_privilege('authenticated', 'public.morning_digest(uuid, date)', 'execute'),
  'still service only');

select * from finish();
rollback;
