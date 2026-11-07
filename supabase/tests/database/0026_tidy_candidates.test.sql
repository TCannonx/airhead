-- Tests for migration 0026: Tidy-up candidates.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title, status, completed_at, start_at, body, data, created_at) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'task', 'Old done task', 'done',
   now() - interval '120 days', null, null, '{}', now() - interval '130 days'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'task', 'Recent done task', 'done',
   now() - interval '10 days', null, null, '{}', now() - interval '20 days'),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'reading', 'Old article', 'done',
   now() - interval '100 days', null, null, '{}', now() - interval '110 days'),
  ('a0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-00000000000a', 'event', 'Old dentist', 'open',
   null, now() - interval '60 days', null, '{}', now() - interval '70 days'),
  ('a0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-00000000000a', 'event', 'Old party with notes', 'open',
   null, now() - interval '60 days', 'bring cake', '{}', now() - interval '70 days'),
  ('a0000000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-00000000000a', 'task', 'Buy milk', 'open',
   null, null, null, '{}', now() - interval '5 days'),
  ('a0000000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-00000000000a', 'task', '  buy  MILK ', 'open',
   null, null, null, '{}', now() - interval '1 days'),
  ('a0000000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-00000000000a', 'idea', 'Garden office', 'open',
   null, null, null, '{}', now() - interval '50 days'),
  ('a0000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-00000000000a', 'idea', 'Garden office', 'open',
   null, null, null, '{}', now() - interval '3 days'),
  ('a0000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-00000000000a', 'task', 'Kept old task', 'done',
   now() - interval '200 days', null, null, '{"keep": true}', now() - interval '210 days'),
  ('a0000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-00000000000b', 'task', 'Someone else old', 'done',
   now() - interval '200 days', null, null, '{}', now() - interval '210 days');
insert into public.captures (id, user_id, text, status, captured_at) values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'old unsorted thought', 'unsorted',
   now() - interval '40 days'),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'fresh thought', 'unsorted',
   now() - interval '2 days');

create temporary table t as select * from public.tidy_candidates('00000000-0000-0000-0000-00000000000a');

select is((select reason || '/' || mode from t where id = 'a0000000-0000-4000-8000-000000000001'), 'done_old/auto',
  'a task done over 90 days ago is low risk');
select ok(not exists (select 1 from t where id = 'a0000000-0000-4000-8000-000000000002'), 'recent done tasks stay');
select is((select reason || '/' || mode from t where id = 'a0000000-0000-4000-8000-000000000003'), 'read_old/auto',
  'an article read over 90 days ago is low risk');
select is((select reason || '/' || mode from t where id = 'a0000000-0000-4000-8000-000000000004'), 'past_event/auto',
  'a past event with no notes is low risk');
select ok(not exists (select 1 from t where id = 'a0000000-0000-4000-8000-000000000005'), 'a past event with notes stays');
select is((select reason || '/' || mode || '/' || duplicate_of from t where id = 'a0000000-0000-4000-8000-000000000007'),
  'duplicate/auto/a0000000-0000-4000-8000-000000000006', 'an exact duplicate (case and spaces aside) points at the first');
select ok(not exists (select 1 from t where id = 'a0000000-0000-4000-8000-000000000006'), 'the first copy is kept');
select is((select reason || '/' || mode from t where id = 'a0000000-0000-4000-8000-000000000009'), 'duplicate/ask',
  'ideas always need approval, even as duplicates');
select ok(not exists (select 1 from t where id = 'a0000000-0000-4000-8000-000000000010'), 'items marked keep are left alone');
select ok(not exists (select 1 from t where id = 'a0000000-0000-4000-8000-000000000011'), 'only the person''s own items');
select is((select reason || '/' || mode from t where id = 'c0000000-0000-4000-8000-000000000001'), 'stale_unsorted/ask',
  'old unsorted captures are offered');
select ok(not exists (select 1 from t where id = 'c0000000-0000-4000-8000-000000000002'), 'fresh captures stay');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from public.tidy_candidates('00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'users cannot call it directly');
reset role;

select * from finish();
rollback;
