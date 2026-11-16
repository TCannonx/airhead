-- Tests for migration 0043: plan_digest (Task 13.5).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

-- Evening of 2030-01-07 (Dublin, GMT). Window: 8 Jan 00:00 to 15 Jan 00:00.
insert into public.items (id, user_id, type, title, start_at, due_at, rrule, status, data) values
  ('10000000-0000-4000-8000-000000000431', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   '2030-01-08T08:00:00Z', null, null, 'open', '{"travel_minutes": 20, "location": "Gym"}'),
  ('10000000-0000-4000-8000-000000000432', '00000000-0000-0000-0000-00000000000a', 'event', 'Too late',
   '2030-01-20T08:00:00Z', null, null, 'open', '{}'),
  ('10000000-0000-4000-8000-000000000433', '00000000-0000-0000-0000-00000000000a', 'event', 'Weekly',
   '2029-12-01T18:00:00Z', null, 'FREQ=WEEKLY', 'open', '{}'),
  ('10000000-0000-4000-8000-000000000434', '00000000-0000-0000-0000-00000000000a', 'task', 'Form',
   null, '2030-01-09T15:00:00Z', null, 'open', '{}'),
  ('10000000-0000-4000-8000-000000000435', '00000000-0000-0000-0000-00000000000a', 'task', 'Done one',
   null, '2030-01-09T15:00:00Z', null, 'done', '{}'),
  ('10000000-0000-4000-8000-000000000436', '00000000-0000-0000-0000-00000000000b', 'event', 'Not mine',
   '2030-01-08T09:00:00Z', null, null, 'open', '{}');

insert into public.item_plans (user_id, item_id, prep, reason, source) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-4000-8000-000000000431', '["Bag"]', 'r', 'ai');

select set_eq(
  $$select x ->> 'title' from jsonb_array_elements(
      public.plan_digest('00000000-0000-0000-0000-00000000000a', '2030-01-07') -> 'items') x$$,
  array['Training', 'Weekly', 'Form'],
  'the window, repeating events and open tasks; nothing later, done or someone else''s');

select is(
  (select x -> 'plan' -> 'prep' from jsonb_array_elements(
      public.plan_digest('00000000-0000-0000-0000-00000000000a', '2030-01-07') -> 'items') x
    where x ->> 'title' = 'Training'),
  '["Bag"]'::jsonb, 'the item''s current plan comes with it');

select is(
  (select (x ->> 'travel_minutes')::int from jsonb_array_elements(
      public.plan_digest('00000000-0000-0000-0000-00000000000a', '2030-01-07') -> 'items') x
    where x ->> 'title' = 'Training'),
  20, 'travel minutes from the item');

select ok(not has_function_privilege('authenticated', 'public.plan_digest(uuid, date)', 'execute'),
  'devices cannot call it');

select * from finish();
rollback;
