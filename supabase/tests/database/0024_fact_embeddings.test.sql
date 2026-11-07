-- Tests for migration 0024: fact embeddings and relevance.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');
insert into public.memory_facts (id, user_id, text, status) values
  ('f0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Cycles to work', 'active'),
  ('f0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Allergic to cats', 'active'),
  ('f0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Old fact', 'archived'),
  ('f0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-00000000000b', 'B cycles too', 'active');

create temporary table v as select
  ('[1' || repeat(',0', 383) || ']')::extensions.vector(384) as e1,
  ('[0,1' || repeat(',0', 382) || ']')::extensions.vector(384) as e2;

set local role service_role;
select is((select count(*)::int from public.facts_to_embed(10)), 3, 'active facts without embeddings wait');
select lives_ok($$ select public.store_fact_embedding('f0000000-0000-4000-8000-000000000001', (select e1 from v)) $$,
  'an embedding is stored');
select public.store_fact_embedding('f0000000-0000-4000-8000-000000000002', (select e2 from v));
select public.store_fact_embedding('f0000000-0000-4000-8000-000000000004', (select e1 from v));
select is_empty($$ select 1 from public.facts_to_embed(10) $$, 'nothing waits once embedded');
reset role;

update public.memory_facts set text = 'Cycles to work most days' where id = 'f0000000-0000-4000-8000-000000000001';
set local role service_role;
select results_eq($$ select id from public.facts_to_embed(10) $$,
  $$ values ('f0000000-0000-4000-8000-000000000001'::uuid) $$, 'an edited fact is re-embedded');

select results_eq($$ select id from public.relevant_facts('00000000-0000-0000-0000-00000000000a', (select e1 from v), 8, 0.8) $$,
  $$ values ('f0000000-0000-4000-8000-000000000001'::uuid) $$,
  'only close facts above the threshold, and only the person''s own');
select is((select count(*)::int from public.relevant_facts('00000000-0000-0000-0000-00000000000a', (select e1 from v), 8, -1)), 2,
  'a lower threshold brings in more (active only)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from public.fact_embeddings $$, '42501', null, 'users cannot read fact embeddings');
select throws_ok($$ select * from public.relevant_facts('00000000-0000-0000-0000-00000000000a', null, 8, 0) $$,
  '42501', null, 'users cannot call relevant_facts');
reset role;

select * from finish();
rollback;
