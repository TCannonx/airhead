-- Tests for migration 0048: month_digests and the stale trigger (Task 14.2).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.reviews (user_id, week_start, status, digest) values
  ('00000000-0000-0000-0000-00000000000a', '2026-10-05', 'ok', 'Busy week.'),
  ('00000000-0000-0000-0000-00000000000a', '2026-11-02', 'ok', 'Quiet week.');

insert into public.month_digests (user_id, month, digest, week_starts) values
  ('00000000-0000-0000-0000-00000000000a', '2026-10-01', 'October.', array['2026-10-05']::date[]),
  ('00000000-0000-0000-0000-00000000000a', '2026-11-01', 'November.', array['2026-11-02']::date[]);

select throws_ok(
  $$insert into public.month_digests (user_id, month) values ('00000000-0000-0000-0000-00000000000a', '2026-10-02')$$,
  '23514', null, 'a month is its first day');
select throws_ok(
  $$insert into public.month_digests (user_id, month) values ('00000000-0000-0000-0000-00000000000a', '2026-10-01')$$,
  '23505', null, 'one summary a month');

update public.reviews set digest = 'Busy week, and a trip.' where week_start = '2026-10-05';
select is((select stale::text from public.month_digests where month = '2026-10-01'), 'true',
  'a changed weekly digest marks its month stale');
select is((select stale::text from public.month_digests where month = '2026-11-01'), 'false',
  'other months are left alone');
update public.reviews set content = '{"x": 1}' where week_start = '2026-11-02';
select is((select stale::text from public.month_digests where month = '2026-11-01'), 'false',
  'a change that is not the digest does not');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select is((select count(*)::integer from public.month_digests), 2, 'the owner reads them');
select throws_ok($$delete from public.month_digests$$, '42501', null, 'devices cannot write them');
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::integer from public.month_digests), 0, 'another person cannot');

select * from finish();
rollback;
