-- Tests for migration 0010: the nightly job that marks past leave as Taken.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.leave_bookings (user_id, start_date, end_date, status, note) values
  ('00000000-0000-0000-0000-00000000000a', current_date - 10, current_date - 8, 'approved', 'past approved'),
  ('00000000-0000-0000-0000-00000000000a', current_date - 10, current_date - 8, 'requested', 'past requested'),
  ('00000000-0000-0000-0000-00000000000a', current_date - 10, current_date - 8, 'planned', 'past planned'),
  ('00000000-0000-0000-0000-00000000000a', current_date - 2, current_date + 2, 'approved', 'ongoing'),
  ('00000000-0000-0000-0000-00000000000a', current_date + 5, current_date + 6, 'approved', 'future');
insert into public.leave_bookings (user_id, start_date, end_date, status, note, deleted_at) values
  ('00000000-0000-0000-0000-00000000000a', current_date - 10, current_date - 8, 'approved', 'deleted', now());

select is(public.mark_leave_taken(), 2, 'two past bookings marked');
select results_eq($$ select note from public.leave_bookings where status = 'taken' order by note $$,
  array['past approved', 'past requested'], 'past requested and approved leave is taken');
select is((select status from public.leave_bookings where note = 'past planned'), 'planned', 'planned leave is left alone');
select is((select status from public.leave_bookings where note = 'ongoing'), 'approved', 'leave still running is not taken yet');
select is((select status from public.leave_bookings where note = 'deleted'), 'approved', 'deleted bookings are ignored');
select is(public.mark_leave_taken(), 0, 'running again changes nothing');

select ok(exists (select 1 from cron.job where jobname = 'mark-leave-taken'), 'nightly job scheduled');
select ok(not has_function_privilege('authenticated', 'public.mark_leave_taken()', 'execute'),
  'signed-in users cannot run it');

select * from finish();
rollback;
