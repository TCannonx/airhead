-- Tests for migration 0033: new captures are due at the next 5-minute check.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'd@example.test', 'authenticated', 'authenticated');

-- A: one capture, 3 minutes old: due.
insert into public.captures (user_id, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000a', 'dentist moved to Thursday', now() - interval '3 minutes');
-- B: one capture, just made: settling, not due yet.
insert into public.captures (user_id, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000b', 'just now', now());
-- C: a full batch made just now: due at once.
insert into public.captures (user_id, text, captured_at)
select '00000000-0000-0000-0000-00000000000c', 'thing ' || g, now() from generate_series(1, 20) g;
-- D: nothing waiting (sorted only): never due, so no AI call.
insert into public.captures (user_id, text, status, captured_at) values
  ('00000000-0000-0000-0000-00000000000d', 'done', 'sorted', now() - interval '1 hour');

select results_eq(
  $$ select user_id from public.users_due_now() order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid),
            ('00000000-0000-0000-0000-00000000000c'::uuid) $$,
  'due: settled for 2 minutes, or a full batch; nothing new means no call');

select ok(exists (select 1 from cron.job where jobname = 'dispatch-sort-batches' and schedule = '*/5 * * * *'),
  'still checked every 5 minutes');
select is(public.dispatch_sort_batches(), 0, 'without Vault secrets it does nothing');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from public.users_due_now() $$, '42501', null, 'apps cannot list who is due');

select * from finish();
rollback;
