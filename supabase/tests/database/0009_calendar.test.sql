-- Tests for migration 0009: calendar, work and leave, sharing, notification tables.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

-- Structure ---------------------------------------------------------------------
select has_table('public', t, t || ' exists')
from unnest(array['series', 'nudges', 'feeds', 'external_events', 'work_days',
                  'leave_bookings', 'job_runs']) t;
select ok(c.relrowsecurity, c.relname || ' has row-level security')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('series', 'nudges', 'feeds', 'external_events',
  'work_days', 'leave_bookings', 'job_runs');
select has_index('public', t, t || '_sync_idx', t || ' has the sync index')
from unnest(array['series', 'feeds', 'external_events', 'work_days', 'leave_bookings', 'nudges']) t;
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t),
  t || ' is published to Realtime')
from unnest(array['series', 'feeds', 'external_events', 'work_days', 'leave_bookings']) t;

-- Checks
select throws_ok($$ insert into public.feeds (user_id, kind) values
  ('00000000-0000-0000-0000-00000000000a', 'us_out') $$, '23514', null, 'an outgoing feed needs a token hash');
select throws_ok($$ insert into public.feeds (user_id, kind, token_hash) values
  ('00000000-0000-0000-0000-00000000000a', 'us_out', 'not-a-hash') $$, '23514', null, 'token hash must be hex SHA-256');
select throws_ok($$ insert into public.feeds (user_id, kind) values
  ('00000000-0000-0000-0000-00000000000a', 'linked_in') $$, '23514', null, 'a linked calendar needs a URL');
select throws_ok($$ insert into public.leave_bookings (user_id, start_date, end_date) values
  ('00000000-0000-0000-0000-00000000000a', '2026-07-18', '2026-07-14') $$, '23514', null, 'leave cannot end before it starts');
select throws_ok($$ insert into public.work_days (user_id, date, location) values
  ('00000000-0000-0000-0000-00000000000a', '2026-07-14', 'beach') $$, '23514', null, 'work location is checked');

-- RLS: device-written tables ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$ insert into public.series (name, calendar) values ('Dublin GAA 2027', 'us') $$, 'A adds a series');
select lives_ok($$ insert into public.feeds (id, kind, name, token_hash) values
  ('f0000000-0000-4000-8000-00000000000a', 'us_out', 'Us', repeat('ab', 32)) $$, 'A adds an outgoing feed');
select lives_ok($$ insert into public.feeds (id, kind, name, url) values
  ('f0000000-0000-4000-8000-00000000000b', 'linked_in', 'Her calendar', 'https://example.test/secret.ics') $$,
  'A links a calendar');
select lives_ok($$ insert into public.work_days (date, location) values ('2026-07-14', 'office') $$, 'A sets a work day');
select throws_ok($$ insert into public.work_days (date, location) values ('2026-07-14', 'wfh') $$, '23505', null,
  'one work-day row per date');
select lives_ok($$ insert into public.leave_bookings (start_date, end_date, days) values
  ('2026-07-14', '2026-07-18', 5) $$, 'A books leave');

-- Server-written tables are read-only for the owner
select throws_ok($$ insert into public.external_events (user_id, feed_id, occurrence_key, start_at) values
  ('00000000-0000-0000-0000-00000000000a', 'f0000000-0000-4000-8000-00000000000b', 'x', now()) $$,
  '42501', null, 'devices cannot write linked-calendar events');
select throws_ok($$ insert into public.nudges (user_id, kind, send_at, title) values
  ('00000000-0000-0000-0000-00000000000a', 'test', now(), 'hi') $$, '42501', null, 'devices cannot write nudges');
select throws_ok($$ insert into public.job_runs (user_id, job, local_date) values
  ('00000000-0000-0000-0000-00000000000a', 'x', current_date) $$, '42501', null, 'devices cannot write job runs');
select throws_ok($$ select public.claim_job('00000000-0000-0000-0000-00000000000a', 'x', current_date) $$,
  '42501', null, 'devices cannot claim jobs');

-- Server writes (as the service role would)
reset role;
insert into public.external_events (user_id, feed_id, occurrence_key, title, start_at) values
  ('00000000-0000-0000-0000-00000000000a', 'f0000000-0000-4000-8000-00000000000b', 'uid-1|2026-07-20', 'Her match', '2026-07-20 18:00Z');
insert into public.nudges (user_id, kind, send_at, title, dedupe_key) values
  ('00000000-0000-0000-0000-00000000000a', 'test', now(), 'Test', 'test-1');
select throws_ok($$ insert into public.external_events (user_id, feed_id, occurrence_key, start_at) values
  ('00000000-0000-0000-0000-00000000000a', 'f0000000-0000-4000-8000-00000000000b', 'uid-1|2026-07-20', now()) $$,
  '23505', null, 'an occurrence is stored once per feed');
select throws_ok($$ insert into public.nudges (user_id, kind, send_at, title, dedupe_key) values
  ('00000000-0000-0000-0000-00000000000a', 'test', now(), 'Again', 'test-1') $$,
  '23505', null, 'a generated nudge is stored once per key');

-- Job claims run once per user, job and local date
select ok(public.claim_job('00000000-0000-0000-0000-00000000000a', 'evening_review', '2026-07-14'), 'first claim wins');
select ok(not public.claim_job('00000000-0000-0000-0000-00000000000a', 'evening_review', '2026-07-14'), 'second claim loses');
select ok(public.claim_job('00000000-0000-0000-0000-00000000000b', 'evening_review', '2026-07-14'), 'another user claims separately');
select ok(public.claim_job('00000000-0000-0000-0000-00000000000a', 'evening_review', '2026-07-15'), 'the next day claims again');

-- B sees and changes none of A's rows ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.external_events), 1, 'A reads own linked-calendar events');
select is((select count(*)::int from public.nudges), 1, 'A reads own nudges');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty(format('select 1 from public.%I where user_id <> %L', t, '00000000-0000-0000-0000-00000000000b'),
  'B cannot read A''s ' || t)
from unnest(array['series', 'nudges', 'feeds', 'external_events', 'work_days', 'leave_bookings', 'job_runs']) t;
update public.leave_bookings set status = 'taken';
delete from public.feeds;
select throws_ok($$ insert into public.series (user_id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'sneaky') $$, '42501', null, 'B cannot insert a series owned by A');

reset role;
select is((select status from public.leave_bookings), 'planned', 'A''s booking untouched');
select is((select count(*)::int from public.feeds), 2, 'A''s feeds survived B''s delete');

-- Purge ----------------------------------------------------------------------------
insert into public.job_runs (user_id, job, local_date) values
  ('00000000-0000-0000-0000-00000000000a', 'old', current_date - 120);
update public.feeds set deleted_at = now() - interval '31 days' where kind = 'us_out';
select public.purge_soft_deleted();
select is((select count(*)::int from public.feeds), 1, 'soft-deleted feeds are purged after 30 days');
select is((select count(*)::int from public.job_runs where job = 'old'), 0, 'job runs older than 90 days are purged');
select is((select count(*)::int from public.external_events), 1, 'linked events of a remaining feed stay');

select * from finish();
rollback;
