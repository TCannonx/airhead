-- Tests for migration 0057: nudge_stats (Task 17.1).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');
insert into public.items (id, user_id, type, title, start_at, rrule) values
  ('10000000-0000-4000-8000-000000000571', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   now() + interval '1 day', 'FREQ=WEEKLY');
select public.drain_page_queue();

insert into public.nudges (user_id, kind, item_id, send_at, title, dedupe_key, status, outcome, outcome_at, snoozed_to) values
  ('00000000-0000-0000-0000-00000000000a', 'prepare', '10000000-0000-4000-8000-000000000571',
   now() - interval '7 days', 'Pack', 'k1', 'sent', 'snoozed', now() - interval '7 days', now() - interval '7 days' + interval '10 hours'),
  ('00000000-0000-0000-0000-00000000000a', 'prepare', '10000000-0000-4000-8000-000000000571',
   now() - interval '14 days', 'Pack', 'k2', 'sent', 'snoozed', now() - interval '14 days', now() - interval '14 days' + interval '12 hours'),
  ('00000000-0000-0000-0000-00000000000a', 'prepare', '10000000-0000-4000-8000-000000000571',
   now() - interval '21 days', 'Pack', 'k3', 'sent', 'acted', now() - interval '21 days', null),
  ('00000000-0000-0000-0000-00000000000a', 'leave', null,
   now() - interval '3 days', 'Leave', 'k4', 'sent', 'ignored', now() - interval '3 days', null),
  ('00000000-0000-0000-0000-00000000000a', 'prepare', null,
   now() - interval '70 days', 'Old', 'k5', 'sent', 'dismissed', now() - interval '70 days', null);

select ok(public.refresh_nudge_stats('00000000-0000-0000-0000-00000000000a') >= 3, 'stats rebuilt');
select is((select acted || '/' || snoozed || '/' || dismissed || '/' || median_snooze_minutes
             from public.nudge_stats where kind = 'prepare' and page_id is null),
  '1/2/0/660', 'overall by kind over 8 weeks, median shift in minutes (the old one is left out)');
select is((select snoozed from public.nudge_stats s join public.pages p on p.id = s.page_id
            where s.kind = 'prepare' and p.kind = 'series'), 2, 'and per series page');
select is((select ignored from public.nudge_stats where kind = 'leave' and page_id is null), 1, 'ignored counted');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::integer from public.nudge_stats), 0, 'another person sees none');

select * from finish();
rollback;
