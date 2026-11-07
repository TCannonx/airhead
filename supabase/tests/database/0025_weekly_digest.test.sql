-- Tests for migration 0025: the weekly digest.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');
insert into public.settings (id, user_id, data) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', '{"time_zone": "Europe/Dublin"}');
insert into public.topics (id, user_id, name) values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'House');

-- Week of Monday 13 July 2026 (Irish summer time: UTC+1).
insert into public.items (id, user_id, type, title, due_at, status, carry_count, completed_at, topic_ids, created_at) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'task', 'Done on time',
   '2026-07-14T09:00:00Z', 'done', 0, '2026-07-14T08:30:00Z', '{}', '2026-07-12T10:00:00Z'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'task', 'Done late',
   '2026-07-13T09:00:00Z', 'done', 1, '2026-07-16T19:00:00Z', '{}', '2026-07-13T10:00:00Z'),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'task', 'Fix gutter',
   '2026-07-15T09:00:00Z', 'open', 3, null, '{c0000000-0000-4000-8000-000000000001}', '2026-07-13T10:00:00Z'),
  ('a0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-00000000000a', 'task', 'Next week',
   '2026-07-22T09:00:00Z', 'open', 0, null, '{}', '2026-07-14T10:00:00Z'),
  ('a0000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-00000000000b', 'task', 'Not mine',
   '2026-07-15T09:00:00Z', 'done', 0, '2026-07-15T09:00:00Z', '{}', '2026-07-13T10:00:00Z');
insert into public.items (id, user_id, type, title, created_at) values
  ('b0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'idea', 'Garden office',
   '2026-07-01T10:00:00Z');
insert into public.items (user_id, type, title, data, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'note', 'More on the office',
   '{"related_idea_id": "b0000000-0000-4000-8000-000000000001"}', '2026-07-15T10:00:00Z'),
  ('00000000-0000-0000-0000-00000000000a', 'task', 'Price the office',
   '{"related_idea_id": "b0000000-0000-4000-8000-000000000001"}', '2026-07-16T10:00:00Z');
insert into public.captures (user_id, text, captured_at) values
  ('00000000-0000-0000-0000-00000000000a', 'x', '2026-07-14T21:15:00Z'), -- 22:15 local
  ('00000000-0000-0000-0000-00000000000a', 'y', '2026-07-15T21:40:00Z'), -- 22:40 local
  ('00000000-0000-0000-0000-00000000000a', 'z', '2026-07-21T10:00:00Z'); -- next week
insert into public.ai_usage (user_id, task, tier, model, cost_eur, ok, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'sort_batch', 'small', 'm', 0.01, true, '2026-07-14T10:00:00Z'),
  ('00000000-0000-0000-0000-00000000000a', 'morning_brief', 'large', 'm', 0.03, true, '2026-07-15T06:30:00Z'),
  ('00000000-0000-0000-0000-00000000000b', 'sort_batch', 'small', 'm', 9, true, '2026-07-15T06:30:00Z');

create temporary table d as select public.weekly_digest('00000000-0000-0000-0000-00000000000a', '2026-07-13') as j;

select is((select j -> 'tasks' ->> 'due' from d), '3', 'tasks due this week (own only)');
select is((select j -> 'tasks' ->> 'done' from d), '2', 'tasks done this week');
select is((select j -> 'tasks' ->> 'done_on_time' from d), '1', 'done on time');
select is((select j -> 'slipped' -> 0 ->> 'title' from d), 'Fix gutter', 'slipped tasks, most carried first');
select is((select j -> 'slipping_topics' -> 0 ->> 'topic' from d), 'House', 'topics that slip');
select is((select j ->> 'captures' from d), '2', 'captures this week');
select is((select (j -> 'capture_hours' ->> 22)::int from d), 2, 'capture hours are local');
select is((select jsonb_array_length(j -> 'capture_hours') from d), 24, '24 hours');
select is((select (j -> 'completion_weekdays' ->> 1)::int + (j -> 'completion_weekdays' ->> 3)::int from d), 2,
  'completions by weekday (Tuesday and Thursday)');
select is((select j -> 'returning_ideas' -> 0 ->> 'returns' from d), '2', 'an idea that kept coming back');
select is((select (j -> 'ai' ->> 'cost_eur')::numeric from d), 0.04, 'AI spend this week (own only)');
select is((select j -> 'ai' -> 'by_task' -> 0 ->> 'task' from d), 'morning_brief', 'spend by task, largest first');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select public.weekly_digest('00000000-0000-0000-0000-00000000000a', '2026-07-13') $$,
  '42501', null, 'users cannot call the digest directly');
reset role;

select * from finish();
rollback;
