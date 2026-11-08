-- Tests for migration 0032: prep rules make prep nudges before matching events.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.settings (id, user_id, data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a',
   '{"time_zone": "Europe/Dublin", "work": {"entitlement": 21}}');

-- An event that exists before the rule.
insert into public.items (id, user_id, type, title, status, start_at, all_day) values
  ('e0000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-00000000000a', 'event',
   'Barber', 'open', '2030-11-14T17:00:00Z', false);
select is_empty($$ select 1 from public.nudges where kind = 'prep' $$, 'no rule, no prep nudge');

-- Adding the rule reminds before the existing event.
update public.settings set data = jsonb_set(data, '{work,prep_rules}',
  '[{"id": "r1", "match": ["barber", "haircut"], "reminder": "Bring €20 cash", "minutes_before": 720}]')
  where user_id = '00000000-0000-0000-0000-00000000000a';
select is((select send_at from public.nudges where dedupe_key = 'prep:r1:e0000000-0000-4000-8000-000000000032'),
  '2030-11-14T05:00:00Z'::timestamptz, 'a new rule reminds 12 hours before the existing event');
select is((select title from public.nudges where dedupe_key = 'prep:r1:e0000000-0000-4000-8000-000000000032'),
  'Bring €20 cash', 'with the rule''s words');

-- A new matching event (any case) gets one; others do not.
insert into public.items (id, user_id, type, title, status, start_at, all_day) values
  ('e0000000-0000-4000-8000-000000000033', '00000000-0000-0000-0000-00000000000a', 'event',
   'HAIRCUT with Joe', 'open', '2030-12-01T10:00:00Z', false),
  ('e0000000-0000-4000-8000-000000000034', '00000000-0000-0000-0000-00000000000a', 'event',
   'Dentist', 'open', '2030-12-02T10:00:00Z', false);
select is((select count(*)::int from public.nudges where kind = 'prep' and status = 'pending'), 2,
  'the new haircut gets one; the dentist does not');

-- Moving the event moves the reminder; cancelling the event cancels it.
update public.items set start_at = '2030-11-15T17:00:00Z' where id = 'e0000000-0000-4000-8000-000000000032';
select is((select send_at from public.nudges where dedupe_key = 'prep:r1:e0000000-0000-4000-8000-000000000032'),
  '2030-11-15T05:00:00Z'::timestamptz, 'it follows the event when moved');
update public.items set status = 'dropped' where id = 'e0000000-0000-4000-8000-000000000033';
select is((select status from public.nudges where dedupe_key = 'prep:r1:e0000000-0000-4000-8000-000000000033'),
  'cancelled', 'a dropped event loses its prep reminder');

-- Removing the rule cancels what it made.
update public.settings set data = jsonb_set(data, '{work,prep_rules}', '[]')
  where user_id = '00000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from public.nudges where kind = 'prep' and status = 'pending'), 0,
  'removing the rule cancels its reminders');

select lives_ok($$ insert into public.ai_actions (user_id, kind, status, summary) values
  ('00000000-0000-0000-0000-00000000000a', 'add_prep_rule', 'applied', 'x') $$,
  'add_prep_rule is an action kind');

select * from finish();
rollback;
