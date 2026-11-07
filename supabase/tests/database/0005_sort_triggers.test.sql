-- Tests for the sorting scheduler (migration 20261107000005).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'd@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000e', 'e@example.test', 'authenticated', 'authenticated');

-- A: five fresh unsorted captures (count threshold)
insert into public.captures (user_id, text, captured_at)
select '00000000-0000-0000-0000-00000000000a', 'thing ' || g, now() from generate_series(1, 5) g;
-- B: one fresh capture (not due yet)
insert into public.captures (user_id, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000b', 'fresh', now() - interval '5 minutes');
-- C: one capture waiting 2 hours (age threshold)
insert into public.captures (user_id, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000c', 'old', now() - interval '2 hours');
-- D: own setting "sort when 2 are waiting", two fresh captures
insert into public.settings (id, user_id, data) values
  ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d', '{"batch_threshold_count": 2}');
insert into public.captures (user_id, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000d', 'one', now()),
  ('00000000-0000-0000-0000-00000000000d', 'two', now());
-- E: old captures that don't count (sorted, deleted, photo-only)
insert into public.captures (user_id, text, status, captured_at) values
  ('00000000-0000-0000-0000-00000000000e', 'done', 'sorted', now() - interval '3 hours');
insert into public.captures (user_id, text, deleted_at, captured_at) values
  ('00000000-0000-0000-0000-00000000000e', 'binned', now(), now() - interval '3 hours');
insert into public.captures (user_id, kind, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000e', 'image', null, now() - interval '3 hours');

select results_eq(
  $$ select user_id from public.users_due_for_sorting() order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid),
            ('00000000-0000-0000-0000-00000000000c'::uuid),
            ('00000000-0000-0000-0000-00000000000d'::uuid) $$,
  'due: 5+ waiting, oldest over an hour, or the user''s own threshold');

select ok(exists (select 1 from cron.job where jobname = 'dispatch-sort-batches' and schedule = '*/5 * * * *'),
  'the dispatcher runs every 5 minutes');
select lives_ok($$ select public.dispatch_sort_batches() $$,
  'dispatch is safe to run without Vault secrets (does nothing)');
select is(public.dispatch_sort_batches(), 0, 'no secrets: no calls made');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.dispatch_sort_batches() $$, '42501', null, 'apps cannot trigger the dispatcher');
select throws_ok($$ select * from public.users_due_for_sorting() $$, '42501', null, 'apps cannot list other users');

reset role;
select * from finish();
rollback;
