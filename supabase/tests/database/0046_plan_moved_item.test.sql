-- Tests for migration 0046: a moved item drops its stale AI timings.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title, start_at) values
  ('10000000-0000-4000-8000-000000000461', '00000000-0000-0000-0000-00000000000a', 'event',
   'Training', now() + interval '2 days');

select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a',
  'plan:leave:10000000-0000-4000-8000-000000000461:D', 'leave', '10000000-0000-4000-8000-000000000461',
  now() + interval '47 hours', 'AI leave', 'b', '/', 'r', 'ai');
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a',
  'snooze:x', 'prepare', '10000000-0000-4000-8000-000000000461',
  now() + interval '3 hours', 'Mine', 'b', '/', 'r', 'user');

update public.items set title = 'Training (gym)' where id = '10000000-0000-4000-8000-000000000461';
select is((select status from public.nudges where dedupe_key like 'plan:leave:%461:D'), 'pending',
  'a title change keeps the AI timing');

update public.items set start_at = now() + interval '3 days' where id = '10000000-0000-4000-8000-000000000461';
select is((select status from public.nudges where dedupe_key like 'plan:leave:%461:D'), 'cancelled',
  'moving the event cancels its AI timing');
select is((select status from public.nudges where dedupe_key = 'snooze:x'), 'pending',
  'the owner''s own nudge stays');
select is((select count(*)::integer from public.plan_queue
            where item_id = '10000000-0000-4000-8000-000000000461'), 1, 'and it is queued for defaults');

-- The default for the same key now takes over the cancelled AI nudge.
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a',
  'plan:leave:10000000-0000-4000-8000-000000000461:D', 'leave', '10000000-0000-4000-8000-000000000461',
  now() + interval '71 hours', 'Default leave', 'b', '/', 'r', 'default');
select is((select source || '/' || status || '/' || title from public.nudges where dedupe_key like 'plan:leave:%461:D'),
  'default/pending/Default leave', 'a default replaces a cancelled AI nudge');

-- A dismissed default stays dismissed when the same default is written again.
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:do:z:D', 'do', null,
  now() + interval '5 hours', 'Do', 'b', '/', 'r', 'default');
update public.nudges set status = 'cancelled', outcome = 'dismissed' where dedupe_key = 'plan:do:z:D';
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:do:z:D', 'do', null,
  (select send_at from public.nudges where dedupe_key = 'plan:do:z:D'), 'Do', 'b', '/', 'r', 'default');
select is((select status from public.nudges where dedupe_key = 'plan:do:z:D'), 'cancelled',
  'a dismissed reminder is not brought back');

-- A pending AI nudge still wins over a default.
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:prepare:y:D', 'prepare', null,
  now() + interval '5 hours', 'AI', 'b', '/', 'r', 'ai');
select public.upsert_plan_nudge('00000000-0000-0000-0000-00000000000a', 'plan:prepare:y:D', 'prepare', null,
  now() + interval '6 hours', 'Default', 'b', '/', 'r', 'default');
select is((select title from public.nudges where dedupe_key = 'plan:prepare:y:D'), 'AI',
  'a default never replaces a pending AI nudge');

select * from finish();
rollback;
