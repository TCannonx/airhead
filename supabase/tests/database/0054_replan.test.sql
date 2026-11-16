-- Tests for migration 0054: re-plan queue reasons (Task 15.3).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.items (id, user_id, type, title, start_at) values
  ('10000000-0000-4000-8000-000000000541', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   now() + interval '1 day');

select is((select reason || '/' || defaults_done from public.plan_queue
            where item_id = '10000000-0000-4000-8000-000000000541'), 'changed/false', 'a new item is queued as changed');
update public.plan_queue set defaults_done = true;
update public.items set start_at = now() + interval '2 days' where id = '10000000-0000-4000-8000-000000000541';
select is((select defaults_done::text from public.plan_queue), 'false', 'a new change needs defaults again');

insert into public.nudges (id, user_id, kind, item_id, send_at, title, dedupe_key, status, sent_at, source) values
  ('40000000-0000-4000-8000-000000000541', '00000000-0000-0000-0000-00000000000a', 'prepare',
   '10000000-0000-4000-8000-000000000541', now() - interval '13 hours', 'Pack', 'plan:prepare:x:d', 'sent',
   now() - interval '13 hours', 'ai');
delete from public.plan_queue;
select is(public.mark_ignored_nudges(), 1, 'one ignored');
select is((select reason from public.plan_queue), 'missed', 'a missed reminder queues its item');

delete from public.plan_queue;
update public.nudges set outcome = null, status = 'sent' where id = '40000000-0000-4000-8000-000000000541';
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select public.nudge_outcome('40000000-0000-4000-8000-000000000541', 'snoozed', now() + interval '1 hour');
reset role;
select is((select reason from public.plan_queue), 'snoozed', 'a snooze queues its item');

select * from finish();
rollback;
