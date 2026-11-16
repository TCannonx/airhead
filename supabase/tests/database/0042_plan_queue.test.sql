-- Tests for migration 0042: plan_queue trigger and upsert_plan_nudge (Task 13.3).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title, start_at) values
  ('10000000-0000-4000-8000-000000000421', '00000000-0000-0000-0000-00000000000a', 'event',
   'Training', now() + interval '1 day'),
  ('10000000-0000-4000-8000-000000000422', '00000000-0000-0000-0000-00000000000a', 'idea',
   'An idea', null);

select is((select count(*)::integer from public.plan_queue
            where item_id = '10000000-0000-4000-8000-000000000421'), 1, 'a new event is queued');
select is((select count(*)::integer from public.plan_queue
            where item_id = '10000000-0000-4000-8000-000000000422'), 0, 'an idea is not queued');

delete from public.plan_queue;
update public.items set body = 'notes' where id = '10000000-0000-4000-8000-000000000421';
select is((select count(*)::integer from public.plan_queue), 0, 'a body change does not queue');
update public.items set start_at = now() + interval '2 days' where id = '10000000-0000-4000-8000-000000000421';
select is((select count(*)::integer from public.plan_queue), 1, 'moving the event queues it');
update public.items set deleted_at = now() where id = '10000000-0000-4000-8000-000000000421';
select is((select count(*)::integer from public.plan_queue), 1, 'requeue keeps one row per item');

-- upsert_plan_nudge
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:prepare:x:d', 'prepare',
  null, now() + interval '1 hour', 'Pack', 'b', '/', 'Early start', 'default');
select is((select source || '/' || status || '/' || reason from public.nudges where dedupe_key = 'plan:prepare:x:d'),
  'default/pending/Early start', 'a default nudge is written with its reason');

select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:prepare:x:d', 'prepare',
  null, now() + interval '2 hours', 'Pack (AI)', 'b', '/', 'AI says', 'ai');
select is((select source || '/' || title from public.nudges where dedupe_key = 'plan:prepare:x:d'),
  'ai/Pack (AI)', 'the AI replaces a default');

select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:prepare:x:d', 'prepare',
  null, now() + interval '3 hours', 'Pack again', 'b', '/', 'Default again', 'default');
select is((select source || '/' || title from public.nudges where dedupe_key = 'plan:prepare:x:d'),
  'ai/Pack (AI)', 'a default never overwrites an AI nudge');

select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:leave:x:d', 'leave',
  null, now() + interval '1 hour', 'Leave', 'b', '/', 'r', 'default');
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:leave:x:d', 'leave',
  null, now() - interval '1 minute', 'Leave', 'b', '/', 'r', 'default');
select is((select status from public.nudges where dedupe_key = 'plan:leave:x:d'),
  'cancelled', 'a past time cancels instead of sending late');

select lives_ok(
  $$select public.refresh_plan_nudges('10000000-0000-4000-8000-000000000421')$$,
  'refresh_plan_nudges is callable by the service role');

-- The tick runs when the plan queue has work, even with no notification device.
select vault.create_secret('http://localhost:54321', 'project_url')
 where not exists (select 1 from vault.decrypted_secrets where name = 'project_url');
select vault.create_secret('test-key', 'service_role_key')
 where not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key');
delete from public.devices;
delete from public.plan_queue;
select is(public.dispatch_scheduler_tick(), false, 'no queue and no device: no call');
select public.refresh_plan_nudges('10000000-0000-4000-8000-000000000421');
select is(public.dispatch_scheduler_tick(), true, 'queued plan work: the tick is called');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select throws_ok(
  $$select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'k', 'leave', null,
    now() + interval '1 hour', 't', 'b', '/', 'r', 'user')$$,
  '42501', null, 'devices cannot call upsert_plan_nudge');
select throws_ok($$select * from public.plan_queue$$, '42501', null, 'devices cannot read the queue');

select * from finish();
rollback;
