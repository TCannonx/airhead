-- Tests for migration 0045: nudge_outcome and mark_ignored_nudges (Task 13.8).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.nudges (id, user_id, kind, item_id, send_at, title, body, url, dedupe_key,
                           status, sent_at, source) values
  ('40000000-0000-4000-8000-000000000451', '00000000-0000-0000-0000-00000000000a', 'prepare',
   '10000000-0000-4000-8000-000000000451', now() - interval '5 minutes', 'Pack your bag', 'Boots',
   '/library/item/10000000-0000-4000-8000-000000000451', 'plan:prepare:x:d', 'sent',
   now() - interval '5 minutes', 'ai'),
  ('40000000-0000-4000-8000-000000000452', '00000000-0000-0000-0000-00000000000a', 'leave',
   null, now() + interval '1 hour', 'Leave', null, '/', 'plan:leave:x:d', 'pending', null, 'default'),
  ('40000000-0000-4000-8000-000000000453', '00000000-0000-0000-0000-00000000000a', 'do',
   null, now() - interval '13 hours', 'Old', null, '/', 'plan:do:x:d', 'sent',
   now() - interval '13 hours', 'ai'),
  ('40000000-0000-4000-8000-000000000454', '00000000-0000-0000-0000-00000000000a', 'checklist',
   null, now() - interval '13 hours', 'Not a plan nudge', null, '/', 'c1', 'sent',
   now() - interval '13 hours', 'rule');

select is(public.mark_ignored_nudges(), 1, 'one plan nudge sent 13 hours ago and untouched');
select is((select outcome from public.nudges where id = '40000000-0000-4000-8000-000000000453'),
  'ignored', 'it is marked ignored');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select throws_ok(
  $$select public.nudge_outcome('40000000-0000-4000-8000-000000000451', 'acted')$$,
  'P0002', null, 'another person cannot answer the owner''s nudge');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select throws_ok(
  $$select public.nudge_outcome('40000000-0000-4000-8000-000000000451', 'snoozed', now() - interval '1 minute')$$,
  '22023', null, 'a snooze needs a time in the future');

select lives_ok(
  $$select public.nudge_outcome('40000000-0000-4000-8000-000000000451', 'snoozed', now() + interval '1 hour')$$,
  'the owner snoozes a sent nudge');
select is((select outcome || '/' || status from public.nudges where id = '40000000-0000-4000-8000-000000000451'),
  'snoozed/sent', 'the outcome is recorded');
select is((select source || '/' || status || '/' || kind || '/' || title from public.nudges
            where dedupe_key = 'snooze:40000000-0000-4000-8000-000000000451'),
  'user/pending/prepare/Pack your bag', 'a new nudge from the owner, same kind and words');

select lives_ok(
  $$select public.nudge_outcome('40000000-0000-4000-8000-000000000452', 'dismissed')$$, 'dismiss');
select is((select outcome || '/' || status from public.nudges where id = '40000000-0000-4000-8000-000000000452'),
  'dismissed/cancelled', 'a dismissed nudge that has not gone out is cancelled');

reset role;
select ok(not has_function_privilege('authenticated', 'public.mark_ignored_nudges()', 'execute'),
  'devices cannot mark nudges ignored');

select * from finish();
rollback;
