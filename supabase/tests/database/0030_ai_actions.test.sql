-- Tests for migration 0030: AI actions.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.ai_actions (id, user_id, kind, status, summary, target_table, after) values
  ('a0000000-0000-4000-8000-000000000030', '00000000-0000-0000-0000-00000000000a',
   'set_leave_remaining', 'applied', 'Leave left set to 9.5 days', 'settings',
   '{"opening_used": {"2025-12-01": 11.5}}');

select throws_ok($$ insert into public.ai_actions (user_id, kind, status, summary) values
  ('00000000-0000-0000-0000-00000000000a', 'delete_everything', 'applied', 'x') $$,
  '23514', null, 'kind is checked');
select throws_ok($$ insert into public.ai_actions (user_id, kind, status, summary, target_table) values
  ('00000000-0000-0000-0000-00000000000a', 'book_leave', 'applied', 'x', 'auth.users') $$,
  '23514', null, 'target table is checked');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select summary from public.ai_actions), 'Leave left set to 9.5 days', 'the owner sees the action');
select lives_ok($$ update public.ai_actions set status = 'undone' $$, 'the owner undoes it');
select throws_ok($$ update public.ai_actions set status = 'maybe' $$, '23514', null, 'status is checked');
select throws_ok($$ delete from public.ai_actions $$, '42501', null, 'devices cannot delete actions');
select throws_ok($$ insert into public.ai_actions (user_id, kind, status, summary) values
  ('00000000-0000-0000-0000-00000000000b', 'book_leave', 'applied', 'x') $$,
  '42501', null, 'nobody inserts for someone else');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.ai_actions $$, 'others cannot read actions');
update public.ai_actions set status = 'dismissed';
reset role;
select is((select status from public.ai_actions), 'undone', 'others cannot change actions');

select * from finish();
rollback;
