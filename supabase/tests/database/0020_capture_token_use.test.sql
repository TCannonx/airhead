-- Tests for migration 0020: capture tokens in use.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.capture_tokens (id, user_id, token_hash, label) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'hash-live', 'iPhone'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'hash-revoked', 'Old');
update public.capture_tokens set revoked_at = now() where token_hash = 'hash-revoked';

select has_column('public', 'capture_tokens', 'last_used_at', 'tokens record their last use');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from public.use_capture_token('hash-live') $$, '42501', null,
  'signed-in users cannot call the lookup');
select throws_ok($$ select * from public.capture_token_uses $$, '42501', null,
  'the use log is not readable by users');
reset role;

set local role service_role;
select results_eq($$ select user_id, allowed from public.use_capture_token('hash-live') $$,
  $$ values ('00000000-0000-0000-0000-00000000000a'::uuid, true) $$, 'a live token is found and allowed');
select is_empty($$ select * from public.use_capture_token('hash-revoked') $$, 'a revoked token is not found');
select is_empty($$ select * from public.use_capture_token('nope') $$, 'an unknown token is not found');
reset role;

select ok((select last_used_at is not null from public.capture_tokens where token_hash = 'hash-live'),
  'last_used_at is set');
select ok((select last_used_at is null from public.capture_tokens where token_hash = 'hash-revoked'),
  'the revoked token stays unused');

insert into public.capture_token_uses (token_id)
  select 'a0000000-0000-4000-8000-000000000001' from generate_series(1, 59);
set local role service_role;
select is((select allowed from public.use_capture_token('hash-live')), false,
  'the 61st use in an hour is refused');
reset role;
select is((select count(*)::int from public.capture_token_uses), 60, 'a refused use is not logged');

update public.capture_token_uses set used_at = now() - interval '2 hours';
set local role service_role;
select is((select allowed from public.use_capture_token('hash-live')), true, 'old uses no longer count');
reset role;
select is((select count(*)::int from public.capture_token_uses), 1, 'uses older than an hour are cleared');

select * from finish();
rollback;
