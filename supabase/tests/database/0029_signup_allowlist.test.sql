-- Tests for migration 0029: invite-only sign-up.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into public.signup_allowlist (entry) values ('me@airhead.test'), ('@family.test');

select is(public.hook_before_user_created('{"user": {"email": "me@airhead.test"}}'::jsonb),
  '{}'::jsonb, 'an invited address may sign up');
select is(public.hook_before_user_created('{"user": {"email": "Me@Airhead.Test"}}'::jsonb),
  '{}'::jsonb, 'case does not matter');
select is(public.hook_before_user_created('{"user": {"email": "anyone@family.test"}}'::jsonb),
  '{}'::jsonb, 'a whole invited domain may sign up');
select is(public.hook_before_user_created('{"user": {"email": "stranger@else.test"}}'::jsonb)
  -> 'error' ->> 'http_code', '403', 'anyone else is refused');
select ok(public.hook_before_user_created('{"user": {"email": "stranger@else.test"}}'::jsonb)
  -> 'error' ->> 'message' like 'invite_only:%', 'with the invite_only marker the app recognises');
select is(public.hook_before_user_created('{"user": {}}'::jsonb) -> 'error' ->> 'http_code',
  '403', 'no email (e.g. phone) is refused');
select throws_ok($$ insert into public.signup_allowlist (entry) values ('Upper@x.test') $$,
  '23514', null, 'entries are lower case');
select throws_ok($$ insert into public.signup_allowlist (entry) values ('nope') $$,
  '23514', null, 'entries are an address or @domain');

set local role authenticated;
select throws_ok($$ select * from public.signup_allowlist $$, '42501', null,
  'signed-in users cannot read the list');
select throws_ok($$ select public.hook_before_user_created('{}'::jsonb) $$, '42501', null,
  'signed-in users cannot call the hook');
reset role;

select ok(has_table_privilege('supabase_auth_admin', 'public.signup_allowlist', 'select'),
  'Auth can read the list');
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
  'Auth can call the hook');

select * from finish();
rollback;
