-- Tests for migration 0041: item_plans, plan_runs and the new nudge columns (Task 13.2).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title) values
  ('10000000-0000-4000-8000-000000000411', '00000000-0000-0000-0000-00000000000a', 'event', 'Training');

-- The service role (this session) writes plans.
insert into public.item_plans (id, user_id, item_id, prep, reason, source)
values ('20000000-0000-4000-8000-000000000411', '00000000-0000-0000-0000-00000000000a',
        '10000000-0000-4000-8000-000000000411', '["Pack your bag"]', 'Early start', 'default');

select throws_ok(
  $$insert into public.item_plans (user_id, item_id) values
    ('00000000-0000-0000-0000-00000000000a', '10000000-0000-4000-8000-000000000411')$$,
  '23505', null, 'one plan per item');

select throws_ok(
  $$insert into public.item_plans (user_id, item_id, reading_slot) values
    ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'bedtime')$$,
  '23514', null, 'reading_slot is checked');

insert into public.plan_runs (user_id, kind, local_date, status)
values ('00000000-0000-0000-0000-00000000000a', 'evening', '2026-11-17', 'ok');
select throws_ok(
  $$insert into public.plan_runs (user_id, kind, local_date) values
    ('00000000-0000-0000-0000-00000000000a', 'evening', '2026-11-17')$$,
  '23505', null, 'an evening run happens once a day');
select lives_ok(
  $$insert into public.plan_runs (user_id, kind, local_date) values
    ('00000000-0000-0000-0000-00000000000a', 'replan', '2026-11-17'),
    ('00000000-0000-0000-0000-00000000000a', 'replan', '2026-11-17')$$,
  'replans may run many times a day');
select throws_ok(
  $$insert into public.plan_runs (user_id, kind, local_date) values
    ('00000000-0000-0000-0000-00000000000a', 'hourly', '2026-11-17')$$,
  '23514', null, 'run kind is checked');

-- Nudges: new kinds and columns.
select lives_ok(
  $$insert into public.nudges (user_id, kind, item_id, send_at, title, dedupe_key, reason, source, delivery)
    values ('00000000-0000-0000-0000-00000000000a', 'prepare', '10000000-0000-4000-8000-000000000411',
            now() + interval '1 day', 'Pack your bag', 'plan:prepare:x:2026-11-18', 'Early start', 'default', 'push')$$,
  'prepare is a nudge kind');
select lives_ok(
  $$insert into public.nudges (user_id, kind, send_at, title, dedupe_key, delivery)
    values ('00000000-0000-0000-0000-00000000000a', 'reading', now() + interval '1 day', 'Read', 'r1', 'digest')$$,
  'reading is a nudge kind and digest a delivery');
select throws_ok(
  $$insert into public.nudges (user_id, kind, send_at, title, dedupe_key)
    values ('00000000-0000-0000-0000-00000000000a', 'nag', now(), 'x', 'n1')$$,
  '23514', null, 'unknown nudge kinds are refused');
select throws_ok(
  $$insert into public.nudges (user_id, kind, send_at, title, dedupe_key, outcome)
    values ('00000000-0000-0000-0000-00000000000a', 'leave', now(), 'x', 'n2', 'maybe')$$,
  '23514', null, 'outcome is checked');
select is((select source from public.nudges where dedupe_key = 'r1'), 'rule', 'source defaults to rule');
select is((select status from public.nudges where dedupe_key = 'r1'), 'pending', 'status default unchanged');

-- RLS: the owner reads, nobody writes from a device; a second user sees nothing.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select is((select count(*)::integer from public.item_plans), 1, 'owner reads own plan');
select is((select count(*)::integer from public.plan_runs), 3, 'owner reads own runs');
select is((select runs from public.plan_runs_daily where kind = 'replan'), 2, 'owner reads the daily view');
select throws_ok(
  $$insert into public.item_plans (user_id, item_id) values
    ('00000000-0000-0000-0000-00000000000a', gen_random_uuid())$$,
  '42501', null, 'devices cannot write plans');
select throws_ok(
  $$update public.nudges set outcome = 'acted'$$,
  '42501', null, 'devices cannot update nudges directly');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::integer from public.item_plans), 0, 'second user cannot read the plan');
select is((select count(*)::integer from public.plan_runs), 0, 'second user cannot read runs');
select is((select count(*)::integer from public.plan_runs_daily), 0, 'second user cannot read the view');
select is((select count(*)::integer from public.nudges), 0, 'second user cannot read nudges');

select * from finish();
rollback;
