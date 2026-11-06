-- RLS and sync-column tests for migration 0001 (settings, devices, capture_tokens).
-- Run with: npx supabase test db   (needs the local stack, so it runs in CI)
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- Two users -------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

-- Structure -------------------------------------------------------------------
select has_table('public', t, t || ' exists')
from unnest(array['settings', 'devices', 'capture_tokens']) as t;

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('settings', 'devices', 'capture_tokens')
     and c.relrowsecurity),
  3, 'row-level security is enabled on all three tables');

select has_column('public', t, col, t || '.' || col)
from unnest(array['settings', 'devices', 'capture_tokens']) as t,
     unnest(array['id', 'user_id', 'created_at', 'updated_at', 'server_updated_at', 'deleted_at']) as col
where col in ('server_updated_at', 'deleted_at');

-- User A writes one row in each table ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$ insert into public.settings (id, data) values
  ('10000000-0000-0000-0000-00000000000a', '{"time_zone":"Europe/Dublin"}') $$,
  'A can insert own settings (user_id defaults to auth.uid())');
select lives_ok($$ insert into public.devices (id, name, platform) values
  ('20000000-0000-0000-0000-00000000000a', 'A iPhone', 'ios') $$, 'A can insert own device');
select lives_ok($$ insert into public.capture_tokens (id, token_hash, label) values
  ('30000000-0000-0000-0000-00000000000a', 'hash-a', 'Shortcut') $$, 'A can insert own token');

select is((select user_id from public.settings), '00000000-0000-0000-0000-00000000000a'::uuid,
  'user_id is filled from auth.uid()');
select isnt((select server_updated_at from public.devices), null, 'server_updated_at is set on insert');

select throws_ok($$ insert into public.devices (name, platform, user_id) values
  ('sneaky', 'web', '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'A cannot insert a row owned by B');

-- User B sees and changes nothing of A's -------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is_empty($$ select * from public.settings $$, 'B cannot read A''s settings');
select is_empty($$ select * from public.devices $$, 'B cannot read A''s devices');
select is_empty($$ select * from public.capture_tokens $$, 'B cannot read A''s tokens');

update public.settings set data = '{"hacked":true}';
update public.devices set name = 'hacked';
update public.capture_tokens set label = 'hacked';
delete from public.settings;
delete from public.devices;
delete from public.capture_tokens;

select lives_ok($$ insert into public.settings (data) values ('{}') $$, 'B can create B''s own settings');
select results_eq($$ select count(*)::int from public.settings $$, array[1], 'B sees only B''s settings');

-- Back as A: A's rows are untouched -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select results_eq($$ select data->>'time_zone' from public.settings $$, array['Europe/Dublin'],
  'A''s settings survived B''s update and delete');
select results_eq($$ select name from public.devices $$, array['A iPhone'],
  'A''s device survived B''s update and delete');
select results_eq($$ select label from public.capture_tokens $$, array['Shortcut'],
  'A''s token survived B''s update and delete');

select throws_ok($$ update public.devices set user_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'A cannot hand a row to B');

-- One settings row per user
select throws_ok($$ insert into public.settings (data) values ('{}') $$, '23505', null,
  'only one settings row per user');

-- server_updated_at is the server's, not the device's ---------------------------
select lives_ok($$ update public.devices
  set name = 'A iPhone 2', server_updated_at = '2000-01-01T00:00:00Z'
  where id = '20000000-0000-0000-0000-00000000000a' $$, 'A can update own device');
select ok((select server_updated_at > '2001-01-01'::timestamptz from public.devices),
  'a device-supplied server_updated_at is overwritten by the trigger');

-- Soft delete is just an update
select lives_ok($$ update public.capture_tokens set deleted_at = now() $$, 'A can soft-delete own token');
select ok((select deleted_at is not null from public.capture_tokens), 'deleted_at is recorded');

-- Anonymous users see nothing -------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select * from public.settings $$, '42501', null, 'anon has no access to settings');

reset role;
select * from finish();
rollback;
