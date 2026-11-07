-- Tests for migration 0015: morning briefs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

select has_table('public', 'briefs', 'briefs exists');
select has_index('public', 'briefs', 'briefs_sync_idx', 'briefs has the sync index');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'briefs'),
  'briefs are published to Realtime');

-- Written by the server (as the service role would)
insert into public.briefs (user_id, local_date, status, content) values
  ('00000000-0000-0000-0000-00000000000a', '2027-01-10', 'ok', '{"reflection": "Good day."}');
select throws_ok($$ insert into public.briefs (user_id, local_date, status) values
  ('00000000-0000-0000-0000-00000000000a', '2027-01-10', 'fallback') $$, '23505', null, 'one brief per person per day');
select throws_ok($$ insert into public.briefs (user_id, local_date, status) values
  ('00000000-0000-0000-0000-00000000000a', '2027-01-11', 'maybe') $$, '23514', null, 'status is checked');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select content ->> 'reflection' from public.briefs), 'Good day.', 'the owner reads their brief');
select throws_ok($$ insert into public.briefs (user_id, local_date, status) values
  ('00000000-0000-0000-0000-00000000000a', '2027-01-12', 'ok') $$, '42501', null, 'devices cannot write briefs');
select throws_ok($$ update public.briefs set status = 'fallback' $$, '42501', null, 'devices cannot change briefs');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.briefs $$, 'others cannot read it');

reset role;
insert into public.briefs (user_id, local_date, status) values
  ('00000000-0000-0000-0000-00000000000a', current_date - 400, 'ok');
select public.purge_soft_deleted();
select is((select count(*)::int from public.briefs), 1, 'briefs over a year old are purged');

select * from finish();
rollback;
