-- Tests for migration 0055: topic pages (Task 16.5).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.topics (id, user_id, name) values
  ('60000000-0000-4000-8000-000000000551', '00000000-0000-0000-0000-00000000000a', 'Running');
insert into public.items (id, user_id, type, title, topic_ids) values
  ('10000000-0000-4000-8000-000000000551', '00000000-0000-0000-0000-00000000000a', 'reading', 'A', '{60000000-0000-4000-8000-000000000551}'),
  ('10000000-0000-4000-8000-000000000552', '00000000-0000-0000-0000-00000000000a', 'reading', 'B', '{60000000-0000-4000-8000-000000000551}'),
  ('10000000-0000-4000-8000-000000000553', '00000000-0000-0000-0000-00000000000a', 'reading', 'C', '{60000000-0000-4000-8000-000000000551}'),
  ('10000000-0000-4000-8000-000000000554', '00000000-0000-0000-0000-00000000000a', 'task', 'Buy shoes', '{60000000-0000-4000-8000-000000000551}');
select public.drain_page_queue();

select is(public.page_reading_count((select id from public.pages where kind = 'topic')), 3,
  'three reading items on the topic page (the task does not count)');

update public.pages set rebuild_requested_at = null, summary_stale = false where kind = 'topic';
update public.items set topic_ids = '{}' where id = '10000000-0000-4000-8000-000000000552';
select public.drain_page_queue();
select ok((select rebuild_requested_at is not null from public.pages where kind = 'topic'),
  'removing a link from a topic asks for a rebuild');
select is(public.page_reading_count((select id from public.pages where kind = 'topic')), 2, 'now two');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
update public.pages set collated = '{"next_step": "hacked"}' where kind = 'topic';
reset role;
select is((select collated::text from public.pages where kind = 'topic'), '{}', 'the owner cannot write the collation');

select * from finish();
rollback;
