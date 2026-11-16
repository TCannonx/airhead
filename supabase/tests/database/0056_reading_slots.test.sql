-- Tests for migration 0056: reading slots (Task 16.7).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.items (id, user_id, type, title) values
  ('10000000-0000-4000-8000-000000000561', '00000000-0000-0000-0000-00000000000a', 'reading', 'Marathon plan');
insert into public.plan_runs (id, user_id, kind, local_date) values
  ('30000000-0000-4000-8000-000000000561', '00000000-0000-0000-0000-00000000000a', 'evening', '2030-01-07');

select public.apply_plan('30000000-0000-4000-8000-000000000561', '{
  "items": [{"item_id": "10000000-0000-4000-8000-000000000561", "surface_at": null, "effort_minutes": 13,
             "needs": [], "prep": [], "reason": "Fits the commute", "confidence": 0.7, "reading_slot": "commute"}],
  "nudges": [], "occurrences": [], "cost_eur": 0, "summary": {}}'::jsonb);
select is((select reading_slot from public.item_plans), 'commute', 'the slot is stored');

select public.apply_plan('30000000-0000-4000-8000-000000000561', '{
  "items": [{"item_id": "10000000-0000-4000-8000-000000000561", "surface_at": null, "effort_minutes": 13,
             "needs": [], "prep": [], "reason": "x", "confidence": 0.7, "reading_slot": "bedtime"}],
  "nudges": [], "occurrences": [], "cost_eur": 0, "summary": {}}'::jsonb);
select is((select reading_slot from public.item_plans), null, 'an unknown slot is not');

select * from finish();
rollback;
