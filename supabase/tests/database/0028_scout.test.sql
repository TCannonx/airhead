-- Tests for migration 0028: Scout runs and suggestions.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.scout_runs (id, user_id, trigger, queries, searches, cards) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'manual',
   '["gigs in Dublin this month"]', 1, 1);
insert into public.suggestions (id, user_id, run_id, kind, title, proposed) values
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a',
   'a0000000-0000-4000-8000-000000000001', 'web', 'Tickets on sale Friday', '{"type": "task", "title": "Buy tickets"}');

select throws_ok($$ insert into public.suggestions (user_id, kind, title) values
  ('00000000-0000-0000-0000-00000000000a', 'spam', 'x') $$, '23514', null, 'kind is checked');
select lives_ok($$ insert into public.nudges (user_id, kind, send_at, title) values
  ('00000000-0000-0000-0000-00000000000a', 'scout', now(), 'Airhead has 3 ideas for you') $$,
  'scout is a nudge kind');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select queries ->> 0 from public.scout_runs), 'gigs in Dublin this month', 'the owner sees the run log');
select throws_ok($$ update public.scout_runs set queries = '[]' $$, '42501', null, 'devices cannot change the run log');
select lives_ok($$ update public.suggestions set status = 'accepted' $$, 'the owner accepts a card');
select is((select status from public.suggestions), 'accepted', 'the status is saved');
select throws_ok($$ update public.suggestions set status = 'maybe' $$, '23514', null, 'status is checked');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.scout_runs $$, 'others cannot read runs');
select is_empty($$ select 1 from public.suggestions $$, 'others cannot read cards');
update public.suggestions set status = 'dismissed';
reset role;
select is((select status from public.suggestions), 'accepted', 'others cannot change cards');

select * from finish();
rollback;
