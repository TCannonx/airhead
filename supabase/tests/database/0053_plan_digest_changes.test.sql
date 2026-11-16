-- Tests for migration 0053: plan_digest carries when each row changed (Task 15.1).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.items (id, user_id, type, title, start_at) values
  ('10000000-0000-4000-8000-000000000531', '00000000-0000-0000-0000-00000000000a', 'event', 'Training',
   '2030-01-08T08:00:00Z');

select ok(
  (select (x ->> 'updated_at') is not null from jsonb_array_elements(
     public.plan_digest('00000000-0000-0000-0000-00000000000a', '2030-01-07') -> 'items') x),
  'each item says when it last changed');

select * from finish();
rollback;
