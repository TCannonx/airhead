-- Tests for migration 0050: people and projects on pages (Task 14.4).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title, data) values
  ('10000000-0000-4000-8000-000000000501', '00000000-0000-0000-0000-00000000000a', 'event',
   'Dinner with Niamh and Trevor',
   '{"mentions": [{"kind": "person", "name": "Niamh"}, {"kind": "person", "name": "Trevor"},
                  {"kind": "project", "name": "Kitchen extension"}]}'),
  ('10000000-0000-4000-8000-000000000502', '00000000-0000-0000-0000-00000000000a', 'task',
   'Ask niamh about the tiles',
   '{"mentions": [{"kind": "person", "name": "  niamh "}, {"kind": "project", "name": "kitchen  extension"},
                  {"kind": "place", "name": "Ignored"}, {"kind": "person", "name": "x"}]}');

select public.drain_page_queue();

select set_eq(
  $$select kind || ':' || key || ':' || status || ':' || item_count from public.pages$$,
  array['person:person:niamh:pending_approval:2', 'person:person:trevor:pending_approval:1',
        'project:project:kitchen extension:active:2'],
  'one page per person and project by normalised name; people wait for approval');
select is((select name from public.pages where key = 'person:niamh'), 'Niamh', 'the first spelling names the page');

-- The owner approves Niamh; a later mention keeps the approval.
update public.pages set status = 'active' where key = 'person:niamh';
update public.items set title = 'Ask Niamh about the tiles' where id = '10000000-0000-4000-8000-000000000502';
select public.drain_page_queue();
select is((select status from public.pages where key = 'person:niamh'), 'active', 'an approval stays');

-- An item that no longer mentions Trevor leaves his page.
update public.items set data = '{"mentions": [{"kind": "person", "name": "Niamh"}]}'
 where id = '10000000-0000-4000-8000-000000000501';
select public.drain_page_queue();
select is((select item_count from public.pages where key = 'person:trevor'), 0, 'unlinked when no longer mentioned');
select is((select item_count from public.pages where key = 'project:kitchen extension'), 1, 'and from the project');

select is(public.page_name_key('  Mary  Kate '), 'mary kate', 'names are normalised');

select * from finish();
rollback;
