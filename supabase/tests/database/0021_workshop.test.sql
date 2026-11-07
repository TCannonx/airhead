-- Tests for migration 0021: Workshop drafts and sessions.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

select has_table('public', 'drafts', 'drafts exists');
select has_table('public', 'workshop_sessions', 'workshop_sessions exists');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'drafts'),
  'drafts are published to Realtime');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$ insert into public.drafts (id, item_id, version, content, source) values
  ('a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000aa', 1, '{"summary": "v1"}', 'auto'),
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-0000000000aa', 1, '{"summary": "v2"}', 'session') $$,
  'two devices can both add "version 1" offline');
select results_eq($$ select version from public.drafts order by version $$, array[1, 2],
  'the server numbers versions per item');
select lives_ok($$ insert into public.drafts (id, item_id, content) values
  ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-0000000000bb', '{}') $$,
  'another item starts at 1');
select is((select version from public.drafts where id = 'a0000000-0000-4000-8000-000000000003'), 1,
  'versions are per item');
update public.drafts set deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000001';
select is((select version from public.drafts where id = 'a0000000-0000-4000-8000-000000000001'), 1,
  'updates keep the version');
update public.drafts set version = 7 where id = 'a0000000-0000-4000-8000-000000000001';
select is((select version from public.drafts where id = 'a0000000-0000-4000-8000-000000000001'), 1,
  'a version number cannot be changed');
select lives_ok($$ insert into public.drafts (id, item_id, version, content) values
  ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-0000000000aa', 1, '{"summary": "v2 again"}')
  on conflict (id) do update set content = excluded.content, version = excluded.version $$,
  'a device re-pushes a draft (upsert)');
select is((select version from public.drafts where id = 'a0000000-0000-4000-8000-000000000002'), 2,
  'a re-pushed draft keeps its server number');
select is((select count(*)::int from public.drafts where item_id = 'a0000000-0000-4000-8000-0000000000aa'), 2,
  'and no extra version appears');
select throws_ok($$ insert into public.drafts (id, item_id, source) values
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-0000000000aa', 'guess') $$,
  '23514', null, 'source is checked');

select lives_ok($$ insert into public.workshop_sessions (id, turns, pending) values
  ('a0000000-0000-4000-8000-0000000000aa', '[{"role": "airhead", "text": "Who is it for?"}]', '{"text": "Me"}') $$,
  'the owner starts a session');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.drafts $$, 'others cannot read drafts');
select is_empty($$ select 1 from public.workshop_sessions $$, 'others cannot read sessions');
select throws_ok($$ insert into public.drafts (id, user_id, item_id) values
  ('a0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-00000000000a', 'a0000000-0000-4000-8000-0000000000aa') $$,
  '42501', null, 'others cannot write drafts for them');
update public.workshop_sessions set pending = null;

reset role;
select is((select pending ->> 'text' from public.workshop_sessions), 'Me', 'the owner''s session is untouched');

select * from finish();
rollback;
