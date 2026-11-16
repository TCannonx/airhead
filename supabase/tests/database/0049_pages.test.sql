-- Tests for migration 0049: pages built by code (Task 14.3).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.series (id, user_id, name) values
  ('50000000-0000-4000-8000-000000000491', '00000000-0000-0000-0000-00000000000a', 'Hurling fixtures');
insert into public.topics (id, user_id, name) values
  ('60000000-0000-4000-8000-000000000491', '00000000-0000-0000-0000-00000000000a', 'Running');

insert into public.items (id, user_id, type, title, start_at, rrule, series_id, topic_ids, data) values
  ('10000000-0000-4000-8000-000000000491', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   now() + interval '1 day', 'FREQ=WEEKLY', null, '{}', '{"location": "Gym"}'),
  ('10000000-0000-4000-8000-000000000492', '00000000-0000-0000-0000-00000000000a', 'event', 'Match 1',
   now() + interval '2 days', null, '50000000-0000-4000-8000-000000000491', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000493', '00000000-0000-0000-0000-00000000000a', 'reading', 'Marathon plan',
   null, null, null, '{60000000-0000-4000-8000-000000000491}', '{}'),
  ('10000000-0000-4000-8000-000000000494', '00000000-0000-0000-0000-00000000000a', 'event', 'Physio',
   now() + interval '3 days', null, null, '{}', '{"location": "gym "}');

select ok((select count(*) from public.page_queue) >= 4, 'new items are queued');
select ok(public.drain_page_queue() >= 4, 'the drain works through the queue');
select is((select count(*)::integer from public.page_queue), 0, 'and empties it');

select set_eq(
  $$select kind || ':' || name || ':' || item_count from public.pages
     where user_id = '00000000-0000-0000-0000-00000000000a'$$,
  array['series:Training:1', 'series:Hurling fixtures:1', 'topic:Running:1'],
  'a page per repeating event, per series and per topic; no place page under 3 events');

-- A third event at the gym makes the place page, with all three events on it.
insert into public.items (id, user_id, type, title, start_at, data) values
  ('10000000-0000-4000-8000-000000000495', '00000000-0000-0000-0000-00000000000a', 'event', 'Spin',
   now() + interval '4 days', '{"location": "GYM"}');
select public.drain_page_queue();
select is((select item_count from public.pages where kind = 'place'), 3,
  'the third event at a place makes its page, with every event there');
select is((select key from public.pages where kind = 'place'), 'place:gym', 'places match ignoring case and spaces');

-- Leaving a topic unlinks; deleting an item unlinks it everywhere.
update public.items set topic_ids = '{}' where id = '10000000-0000-4000-8000-000000000493';
update public.items set deleted_at = now() where id = '10000000-0000-4000-8000-000000000491';
select public.drain_page_queue();
select is((select item_count from public.pages where kind = 'topic'), 0, 'an item that leaves a topic is unlinked');
select is((select item_count from public.pages where key like 'rrule:%'), 0, 'a deleted item is unlinked');
select is((select item_count from public.pages where kind = 'place'), 2, 'and its place page counts one fewer');

-- The owner renames and archives; the rest stays the server's.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
update public.pages set name = 'Our hurling', status = 'archived', summary = 'hacked', item_count = 99
 where kind = 'series' and key like 'series:%';
select is((select name || '/' || status || '/' || summary || '/' || item_count from public.pages
            where key like 'series:%'), 'Our hurling/archived//1', 'rename and archive only');
select is((select count(*)::integer from public.page_items where deleted_at is null), 3, 'the owner reads links');
select throws_ok($$delete from public.page_items$$, '42501', null, 'devices cannot change links');
select throws_ok($$select public.drain_page_queue()$$, '42501', null, 'devices cannot run the drain');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::integer from public.pages), 0, 'another person sees no pages');
select is((select count(*)::integer from public.page_items), 0, 'nor links');

select * from finish();
rollback;
