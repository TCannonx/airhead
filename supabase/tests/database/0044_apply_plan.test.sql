-- Tests for migration 0044: apply_plan (Task 13.6).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title, start_at) values
  ('10000000-0000-4000-8000-000000000441', '00000000-0000-0000-0000-00000000000a', 'event',
   'Training', now() + interval '2 days'),
  ('10000000-0000-4000-8000-000000000442', '00000000-0000-0000-0000-00000000000b', 'event',
   'Someone else', now() + interval '2 days');

insert into public.plan_runs (id, user_id, kind, local_date) values
  ('30000000-0000-4000-8000-000000000441', '00000000-0000-0000-0000-00000000000a', 'evening', '2030-01-07');

-- The owner snoozed this one: the AI must not touch it.
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a',
  'plan:do:10000000-0000-4000-8000-000000000441:D', 'do', '10000000-0000-4000-8000-000000000441',
  now() + interval '5 hours', 'Mine', 'b', '/', 'Snoozed', 'user');
-- An earlier AI nudge for the same occurrence that this plan drops.
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a',
  'plan:follow_up:10000000-0000-4000-8000-000000000441:D', 'follow_up', '10000000-0000-4000-8000-000000000441',
  now() + interval '6 hours', 'Old', 'b', '/', 'r', 'ai');

create temp table payload as select (
  '{"items": [
     {"item_id": "10000000-0000-4000-8000-000000000441", "surface_at": null, "effort_minutes": 90,
      "needs": ["gym"], "prep": ["Pack your bag"], "reason": "Early start", "confidence": 0.9},
     {"item_id": "10000000-0000-4000-8000-000000000442", "surface_at": null, "effort_minutes": null,
      "needs": [], "prep": ["Not yours"], "reason": "x", "confidence": 0.5}],
   "nudges": [
     {"key": "plan:prepare:10000000-0000-4000-8000-000000000441:D", "kind": "prepare",
      "item_id": "10000000-0000-4000-8000-000000000441", "send_at": "' || (now() + interval '1 hour')::text || '",
      "title": "Pack your bag", "body": "Boots", "url": "/x", "reason": "Evening before", "delivery": "push"},
     {"key": "plan:do:10000000-0000-4000-8000-000000000441:D", "kind": "do",
      "item_id": "10000000-0000-4000-8000-000000000441", "send_at": "' || (now() + interval '2 hours')::text || '",
      "title": "AI do", "body": "", "url": "/x", "reason": "r", "delivery": "push"},
     {"key": "plan:leave:10000000-0000-4000-8000-000000000442:D", "kind": "leave",
      "item_id": "10000000-0000-4000-8000-000000000442", "send_at": "' || (now() + interval '1 hour')::text || '",
      "title": "Not yours", "body": "", "url": "/x", "reason": "r", "delivery": "push"}],
   "occurrences": [{"item_id": "10000000-0000-4000-8000-000000000441", "date": "D"}],
   "cost_eur": 0.004,
   "summary": {"items_considered": 1}}')::jsonb as p;

select is(public.apply_plan('30000000-0000-4000-8000-000000000441', (select p from payload)), 2,
  'two nudges for the owner''s own item');

select is((select source || '/' || prep::text from public.item_plans
            where item_id = '10000000-0000-4000-8000-000000000441'),
  'ai/["Pack your bag"]', 'the plan is stored as the AI''s');
select is((select count(*)::integer from public.item_plans
            where item_id = '10000000-0000-4000-8000-000000000442'), 0, 'never another person''s item');
select is((select count(*)::integer from public.nudges
            where dedupe_key like 'plan:leave:10000000-0000-4000-8000-000000000442%'), 0,
  'no nudge for another person''s item');
select is((select source || '/' || title || '/' || plan_run_id::text from public.nudges
            where dedupe_key = 'plan:prepare:10000000-0000-4000-8000-000000000441:D'),
  'ai/Pack your bag/30000000-0000-4000-8000-000000000441', 'the prepare nudge carries its run');
select is((select source || '/' || title from public.nudges
            where dedupe_key = 'plan:do:10000000-0000-4000-8000-000000000441:D'),
  'user/Mine', 'never touches source = user');
select is((select status from public.nudges
            where dedupe_key = 'plan:follow_up:10000000-0000-4000-8000-000000000441:D'),
  'cancelled', 'an earlier AI nudge the plan no longer contains is cancelled');
select is((select status || '/' || nudges_written || '/' || cost_eur from public.plan_runs
            where id = '30000000-0000-4000-8000-000000000441'),
  'ok/2/0.004', 'the run totals are written');

-- Idempotent: the same plan again changes nothing.
select is(public.apply_plan('30000000-0000-4000-8000-000000000441', (select p from payload)), 2, 'again');
select is((select count(*)::integer from public.nudges
            where item_id = '10000000-0000-4000-8000-000000000441' and status = 'pending'
              and dedupe_key like 'plan:%'), 2,
  'still one prepare and the owner''s do pending');
select is((select count(*)::integer from public.item_plans), 1, 'still one plan');

select ok(not has_function_privilege('authenticated', 'public.apply_plan(uuid, jsonb)', 'execute'),
  'devices cannot apply plans');

select * from finish();
rollback;
