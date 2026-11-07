-- Tests for migration 0014: the every-minute scheduler dispatch.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

select ok(exists (select 1 from cron.job where jobname = 'scheduler-tick' and schedule = '* * * * *'),
  'runs every minute');
select ok(not has_function_privilege('authenticated', 'public.dispatch_scheduler_tick()', 'execute'),
  'signed-in users cannot run it');
select has_index('public', 'nudges', 'nudges_user_due_idx', 'due nudges are indexed per person');

-- No call when nobody has a notification device (even with the secrets).
select is(public.dispatch_scheduler_tick(), false, 'nothing to send: no call');

-- Job runs claimed by insert-if-absent, as the function does.
insert into public.job_runs (user_id, job, local_date) values
  ('00000000-0000-0000-0000-00000000000a', 'evening_review', '2027-01-10')
  on conflict do nothing;
insert into public.job_runs (user_id, job, local_date) values
  ('00000000-0000-0000-0000-00000000000a', 'evening_review', '2027-01-10')
  on conflict do nothing;
select is((select count(*)::int from public.job_runs
  where user_id = '00000000-0000-0000-0000-00000000000a' and job = 'evening_review' and local_date = '2027-01-10'),
  1, 'a second claim for the same day adds no row');

select * from finish();
rollback;
