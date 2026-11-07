-- Tests for migration 0027: weekly reviews.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

select has_table('public', 'reviews', 'reviews exists');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reviews'),
  'reviews are published to Realtime');

insert into public.reviews (user_id, week_start, status, content, digest) values
  ('00000000-0000-0000-0000-00000000000a', '2026-07-13', 'ok', '{"themes": ["House"]}', 'A busy week.');
select throws_ok($$ insert into public.reviews (user_id, week_start, status) values
  ('00000000-0000-0000-0000-00000000000a', '2026-07-13', 'ok') $$, '23505', null, 'one review per week');
select throws_ok($$ insert into public.reviews (user_id, week_start, status) values
  ('00000000-0000-0000-0000-00000000000a', '2026-07-20', 'maybe') $$, '23514', null, 'status is checked');
select lives_ok($$ insert into public.nudges (user_id, kind, send_at, title) values
  ('00000000-0000-0000-0000-00000000000a', 'weekly_review', now(), 'Your weekly review is ready') $$,
  'the weekly review notification is a nudge kind');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select digest from public.reviews), 'A busy week.', 'the owner reads their review');
select throws_ok($$ update public.reviews set digest = 'x' $$, '42501', null, 'devices cannot change reviews');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.reviews $$, 'others cannot read it');
reset role;

select * from finish();
rollback;
