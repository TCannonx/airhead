-- Tests for migration 0058: timing_prefs (Task 17.2).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');
insert into public.timing_prefs (user_id, kind, direction, shift_minutes) values
  ('00000000-0000-0000-0000-00000000000a', 'prepare', 'later', 660);
select throws_ok(
  $$insert into public.timing_prefs (user_id, kind, direction, shift_minutes) values
    ('00000000-0000-0000-0000-00000000000a', 'prepare', 'later', 600)$$,
  '23505', null, 'one live preference per kind and page');
update public.timing_prefs set archived = true;
select lives_ok(
  $$insert into public.timing_prefs (user_id, kind, direction, shift_minutes) values
    ('00000000-0000-0000-0000-00000000000a', 'prepare', 'earlier', -60)$$,
  'an archived one makes room for a new one');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::integer from public.timing_prefs), 0, 'another person sees none');
select * from finish();
rollback;
