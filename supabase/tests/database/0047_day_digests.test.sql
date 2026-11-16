-- Tests for migration 0047: day_digests and the stale trigger (Task 14.1).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title, status, due_at, completed_at, start_at, created_at) values
  ('10000000-0000-4000-8000-000000000471', '00000000-0000-0000-0000-00000000000a', 'task', 'Send form',
   'done', null, current_date - 1 + time '12:00', null, current_date - 1 + time '09:00'),
  ('10000000-0000-4000-8000-000000000472', '00000000-0000-0000-0000-00000000000a', 'task', 'Call plumber',
   'open', current_date - 1 + time '15:00', null, null, current_date - 3),
  ('10000000-0000-4000-8000-000000000473', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   'open', null, null, current_date - 1 + time '08:00', current_date - 5),
  ('10000000-0000-4000-8000-000000000474', '00000000-0000-0000-0000-00000000000a', 'task', 'Old one',
   'done', null, current_date - 40 + time '12:00', null, current_date - 41);

select is(
  (select jsonb_array_length(s -> 'done') || '/' || jsonb_array_length(s -> 'missed') || '/'
        || jsonb_array_length(s -> 'events') || '/' || jsonb_array_length(s -> 'captured')
     from (select public.day_digest_source('00000000-0000-0000-0000-00000000000a', current_date - 1) s) x),
  '1/1/1/1', 'yesterday: one done, one missed, one event, one captured');

insert into public.day_digests (user_id, local_date, digest, item_ids) values
  ('00000000-0000-0000-0000-00000000000a', current_date - 1, 'Trained; sent the form.',
   array['10000000-0000-4000-8000-000000000471', '10000000-0000-4000-8000-000000000473']::uuid[]),
  ('00000000-0000-0000-0000-00000000000a', current_date - 40, 'Long ago.',
   array['10000000-0000-4000-8000-000000000474']::uuid[]);

select throws_ok(
  $$insert into public.day_digests (user_id, local_date) values
    ('00000000-0000-0000-0000-00000000000a', current_date - 1)$$,
  '23505', null, 'one summary per day');

update public.items set title = 'Send the form' where id = '10000000-0000-4000-8000-000000000471';
select is((select stale from public.day_digests where local_date = current_date - 1), true,
  'a change to a source item marks the day stale');

update public.items set title = 'Older' where id = '10000000-0000-4000-8000-000000000474';
select is((select stale from public.day_digests where local_date = current_date - 40), false,
  'a day older than 30 days is left alone');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select is((select count(*)::integer from public.day_digests), 2, 'the owner reads them');
select throws_ok(
  $$update public.day_digests set digest = 'x'$$, '42501', null, 'devices cannot write them');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::integer from public.day_digests), 0, 'another person cannot');
reset role;
select ok(not has_function_privilege('authenticated', 'public.day_digest_source(uuid, date)', 'execute'),
  'devices cannot read sources through the function');

select * from finish();
rollback;
