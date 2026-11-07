-- Tests for migration 0017: the morning round-up nudge kind.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
select lives_ok($$ insert into public.nudges (user_id, kind, send_at, title) values
  ('00000000-0000-0000-0000-00000000000a', 'morning_brief', now(), 'Good morning') $$, 'morning_brief is a nudge kind');
select lives_ok($$ insert into public.nudges (user_id, kind, send_at, title) values
  ('00000000-0000-0000-0000-00000000000a', 'prep', now(), 'Pack your bag') $$, 'existing kinds still work');
select throws_ok($$ insert into public.nudges (user_id, kind, send_at, title) values
  ('00000000-0000-0000-0000-00000000000a', 'spam', now(), 'x') $$, '23514', null, 'other kinds are still refused');

select * from finish();
rollback;
