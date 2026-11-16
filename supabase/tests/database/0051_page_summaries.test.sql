-- Tests for migration 0051: page summaries (Task 14.5).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');

insert into public.items (id, user_id, type, title, start_at, rrule) values
  ('10000000-0000-4000-8000-000000000511', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   now() + interval '1 day', 'FREQ=WEEKLY');
select public.drain_page_queue();
select is((select summary_stale from public.pages where key like 'rrule:%'), true, 'a new link marks the page');

update public.pages set summary_stale = false, summarised_at = now() where key like 'rrule:%';
update public.items set body = 'Bring boots' where id = '10000000-0000-4000-8000-000000000511';
select is((select summary_stale from public.pages where key like 'rrule:%'), true, 'an item change marks its pages');

select is((select count(*)::integer from public.pages_to_summarise('00000000-0000-0000-0000-00000000000a')), 1,
  'a changed page is due');
update public.pages set status = 'archived' where key like 'rrule:%';
select is((select count(*)::integer from public.pages_to_summarise('00000000-0000-0000-0000-00000000000a')), 0,
  'an archived page is not');
update public.pages set status = 'active', summary_stale = false where key like 'rrule:%';

-- The owner asks for a rebuild; nothing else they send is kept.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
update public.pages set rebuild_requested_at = now(), summary = 'mine' where key like 'rrule:%';
reset role;
select is((select (rebuild_requested_at is not null)::text || '/' || summary from public.pages where key like 'rrule:%'),
  'true/', 'the owner can ask for a rebuild, not write the summary');
select is((select count(*)::integer from public.pages_to_summarise('00000000-0000-0000-0000-00000000000a')), 1,
  'a rebuild request makes it due');
select ok(not has_function_privilege('authenticated', 'public.pages_to_summarise(uuid, integer)', 'execute'),
  'devices cannot list them');

select * from finish();
rollback;
