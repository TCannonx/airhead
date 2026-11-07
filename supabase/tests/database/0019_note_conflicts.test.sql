-- Tests for migration 0019: conflicted copies of notes on the server.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

-- Device A creates a note (version 1), then edits it (version 2).
insert into public.items (id, type, title) values ('d0000000-0000-4000-8000-000000000001', 'meeting', 'Team sync');
insert into public.note_docs (id, kind, doc, base_version, writer_device) values
  ('d0000000-0000-4000-8000-000000000001', 'typed', '{"html": "A1"}', 0, 'aaaaaaaa-0000-4000-8000-000000000001');
update public.note_docs set doc = '{"html": "A2"}', base_version = 1, writer_device = 'aaaaaaaa-0000-4000-8000-000000000001'
 where id = 'd0000000-0000-4000-8000-000000000001';
select is((select version from public.note_docs where id = 'd0000000-0000-4000-8000-000000000001'), 2,
  'the same device editing on: no conflict');

-- Device B was offline with an edit based on version 1.
update public.note_docs set doc = '{"html": "B offline"}', base_version = 1, writer_device = 'bbbbbbbb-0000-4000-8000-000000000002'
 where id = 'd0000000-0000-4000-8000-000000000001';

select is((select doc ->> 'html' from public.note_docs where id = 'd0000000-0000-4000-8000-000000000001'), 'A2',
  'the newer version stays on the original note');
select is((select doc ->> 'html' from public.note_docs where id <> 'd0000000-0000-4000-8000-000000000001'), 'B offline',
  'the older edit is kept as a copy');
select matches((select title from public.items where id <> 'd0000000-0000-4000-8000-000000000001'),
  '^Team sync \(conflicted copy, \d\d \w{3} \d\d:\d\d\)$', 'the copy is a note titled "conflicted copy"');
select is((select type from public.items where id <> 'd0000000-0000-4000-8000-000000000001'), 'meeting',
  'the copy keeps the note''s type');

-- B, now up to date (based on version 3), edits normally.
update public.note_docs set doc = '{"html": "B on top"}',
  base_version = (select version from public.note_docs where id = 'd0000000-0000-4000-8000-000000000001'),
  writer_device = 'bbbbbbbb-0000-4000-8000-000000000002'
 where id = 'd0000000-0000-4000-8000-000000000001';
select is((select doc ->> 'html' from public.note_docs where id = 'd0000000-0000-4000-8000-000000000001'), 'B on top',
  'an edit based on the latest version is applied');
select is((select count(*)::int from public.note_docs), 2, 'no further copies');

select * from finish();
rollback;
