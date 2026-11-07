-- Tests for migration 0018: note documents.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

select has_table('public', 'note_docs', 'note_docs exists');
select has_index('public', 'note_docs', 'note_docs_sync_idx', 'note_docs has the sync index');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'note_docs'),
  'note_docs are published to Realtime');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$ insert into public.note_docs (id, kind, doc, version, base_version, writer_device) values
  ('d0000000-0000-4000-8000-000000000001', 'typed', '{"html": "<p>Hi</p>"}', 99, 0,
   'd0000000-0000-4000-8000-0000000000ee') $$, 'the owner creates a document');
select is((select version from public.note_docs), 1, 'the server numbers the first write 1, whatever the device sent');
update public.note_docs set doc = '{"html": "<p>Hi there</p>"}', base_version = 1;
update public.note_docs set doc = '{"html": "<p>Hi there!</p>"}', base_version = 2;
select is((select version from public.note_docs), 3, 'each write gets the next version');
select is((select base_version from public.note_docs), 2, 'base_version is kept as the device sent it');
select throws_ok($$ insert into public.note_docs (id, kind) values
  ('d0000000-0000-4000-8000-000000000002', 'scribble') $$, '23514', null, 'kind is checked');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.note_docs $$, 'others cannot read it');
update public.note_docs set doc = '{}';
select throws_ok($$ insert into public.note_docs (id, user_id, kind) values
  ('d0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'typed') $$,
  '42501', null, 'others cannot write into it');

reset role;
select is((select doc ->> 'html' from public.note_docs), '<p>Hi there!</p>', 'the owner''s document is untouched');

select * from finish();
rollback;
