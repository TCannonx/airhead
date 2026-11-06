-- Tests for migration 0002: captures, items, lists, topics, corrections,
-- realtime, the soft-delete purge job and the captures storage bucket.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

-- Structure ---------------------------------------------------------------------
select has_table('public', t, t || ' exists')
from unnest(array['captures', 'items', 'lists', 'topics', 'corrections']) as t;

select ok(c.relrowsecurity, c.relname || ' has row-level security')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('captures', 'items', 'lists', 'topics', 'corrections');

select has_column('public', t, 'server_updated_at', t || '.server_updated_at')
from unnest(array['captures', 'items', 'lists', 'topics', 'corrections']) as t;

select has_index('public', t, t || '_sync_idx', t || ' has the sync index')
from unnest(array['captures', 'items', 'lists', 'topics', 'corrections']) as t;

select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t),
  t || ' is published to Realtime')
from unnest(array['captures', 'items', 'lists', 'topics', 'corrections',
                  'settings', 'devices']) as t;

-- Check constraints
select throws_ok($$ insert into public.items (user_id, type) values
  ('00000000-0000-0000-0000-00000000000a', 'banana') $$, '23514', null, 'items.type is checked');
select throws_ok($$ insert into public.captures (user_id, kind) values
  ('00000000-0000-0000-0000-00000000000a', 'smell') $$, '23514', null, 'captures.kind is checked');

-- RLS: A writes, B sees and changes nothing ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$ insert into public.captures (id, kind, text) values
  ('c0000000-0000-0000-0000-00000000000a', 'text', 'dentist tue 3pm') $$, 'A inserts a capture');
select lives_ok($$ insert into public.items (id, capture_id, type, title) values
  ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'task', 'Call dentist') $$,
  'A inserts an item');
select lives_ok($$ insert into public.lists (id, name) values
  ('20000000-0000-0000-0000-00000000000a', 'Shopping') $$, 'A inserts a list');
select lives_ok($$ insert into public.topics (id, name) values
  ('30000000-0000-0000-0000-00000000000a', 'Health') $$, 'A inserts a topic');
select lives_ok($$ insert into public.corrections (id, capture_id, from_value, to_value) values
  ('40000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a',
   '{"type":"note"}', '{"type":"task"}') $$, 'A inserts a correction');

-- An item may arrive before its capture (soft links, any push order)
select lives_ok($$ insert into public.items (type, capture_id, title) values
  ('note', 'c0000000-0000-0000-0000-0000000000ff', 'orphan for now') $$,
  'items accept a capture_id that has not synced yet');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is_empty(format('select 1 from public.%I', t), 'B cannot read A''s ' || t)
from unnest(array['captures', 'items', 'lists', 'topics', 'corrections']) as t;

update public.captures set text = 'hacked';
update public.items set title = 'hacked';
update public.lists set name = 'hacked';
delete from public.topics;
delete from public.corrections;

select throws_ok($$ insert into public.items (type, title, user_id) values
  ('task', 'sneaky', '00000000-0000-0000-0000-00000000000a') $$, '42501', null,
  'B cannot insert an item owned by A');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select results_eq($$ select text from public.captures $$, array['dentist tue 3pm'], 'A''s capture untouched');
select results_eq($$ select count(*)::int from public.items where title = 'hacked' $$, array[0], 'A''s items untouched');
select results_eq($$ select name from public.lists $$, array['Shopping'], 'A''s list untouched');
select results_eq($$ select count(*)::int from public.topics $$, array[1], 'A''s topic survived B''s delete');
select results_eq($$ select count(*)::int from public.corrections $$, array[1], 'A''s correction survived B''s delete');

-- Storage: files only under <own user id>/ ------------------------------------------
select lives_ok($$ insert into storage.objects (bucket_id, name, owner)
  values ('captures', '00000000-0000-0000-0000-00000000000a/photo.webp', '00000000-0000-0000-0000-00000000000a') $$,
  'A can upload into A''s folder');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner)
  values ('captures', '00000000-0000-0000-0000-00000000000b/photo.webp', '00000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'A cannot upload into B''s folder');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from storage.objects where bucket_id = 'captures' $$, 'B cannot see A''s files');

-- Purge job ------------------------------------------------------------------------
reset role;
select ok(exists (select 1 from storage.buckets where id = 'captures' and not public),
  'private captures bucket exists');
select ok(exists (select 1 from cron.job where jobname = 'purge-soft-deleted'),
  'nightly purge job is scheduled');
select ok(not has_function_privilege('authenticated', 'public.purge_soft_deleted()', 'execute'),
  'signed-in users cannot run the purge');

insert into public.items (user_id, type, title, deleted_at) values
  ('00000000-0000-0000-0000-00000000000a', 'task', 'old trash', now() - interval '31 days'),
  ('00000000-0000-0000-0000-00000000000a', 'task', 'recent trash', now() - interval '29 days');
select public.purge_soft_deleted();
select results_eq($$ select count(*)::int from public.items where title = 'old trash' $$, array[0],
  'rows soft-deleted over 30 days ago are purged');
select results_eq($$ select count(*)::int from public.items where title = 'recent trash' $$, array[1],
  'rows soft-deleted under 30 days ago stay (restorable)');
select results_eq($$ select count(*)::int from public.items where title = 'Call dentist' $$, array[1],
  'live rows are never purged');

select * from finish();
rollback;
