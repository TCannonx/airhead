-- Tests for migration 0059: review proposal kinds (Task 17.3).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
select lives_ok($$insert into public.ai_actions (user_id, kind, status, summary, quote, payload)
  values ('00000000-0000-0000-0000-00000000000a', 'split_task', 'proposed', 's', 'q', '{}'),
         ('00000000-0000-0000-0000-00000000000a', 'drop_item', 'proposed', 's', 'q', '{}')$$,
  'split_task and drop_item are action kinds');
select throws_ok($$insert into public.ai_actions (user_id, kind, status, summary, quote, payload)
  values ('00000000-0000-0000-0000-00000000000a', 'delete_everything', 'proposed', 's', 'q', '{}')$$,
  '23514', null, 'others are not');
select * from finish();
rollback;
