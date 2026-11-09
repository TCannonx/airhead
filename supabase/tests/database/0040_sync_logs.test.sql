-- Tests for migration 0040: devices add their own sync diary; nobody reads it via the API.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

select ok(exists (select 1 from cron.job where jobname = 'sync-logs-cleanup'), 'old diaries are cleaned up daily');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.sync_logs (user_id, user_agent, build, entries)
     values ('00000000-0000-0000-0000-00000000000a', 'iPhone', 'abc', '[{"t":"2026-11-09T20:00:00Z","e":"run start"}]') $$,
  'a device adds its own diary');
select throws_ok(
  $$ insert into public.sync_logs (user_id, entries)
     values ('00000000-0000-0000-0000-00000000000b', '[]') $$,
  '42501', null, 'not for another user');
select throws_ok($$ select * from public.sync_logs $$, '42501', null, 'apps cannot read diaries');
select throws_ok($$ delete from public.sync_logs $$, '42501', null, 'apps cannot delete diaries');
reset role;

select is((select count(*)::int from public.sync_logs), 1, 'one diary saved');
select throws_ok(
  $$ insert into public.sync_logs (user_id, entries) values ('00000000-0000-0000-0000-00000000000a', '{}') $$,
  '23514', null, 'entries must be a list');

select * from finish();
rollback;
