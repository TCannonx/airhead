-- Tests for migration 0023: hybrid search.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

-- Unit vectors: e1 = [1,0,…], e2 = [0,1,0,…].
create temporary table v as select
  ('[1' || repeat(',0', 383) || ']')::extensions.vector(384) as e1,
  ('[0,1' || repeat(',0', 382) || ']')::extensions.vector(384) as e2;
grant select on v to authenticated;

insert into public.chunks (user_id, item_id, chunk_index, content, content_hash, embedding)
select '00000000-0000-0000-0000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 0,
       'Budget review: travel is cut by ten percent', 'h1', e1 from v
union all
select '00000000-0000-0000-0000-00000000000a', 'a0000000-0000-4000-8000-000000000002', 0,
       'Garden shed for the bikes', 'h2', e2 from v
union all
select '00000000-0000-0000-0000-00000000000b', 'b0000000-0000-4000-8000-000000000001', 0,
       'Someone else''s travel plans', 'h3', e1 from v;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select item_id from public.hybrid_search('travel', (select e1 from v), 8) limit 1),
  'a0000000-0000-4000-8000-000000000001'::uuid, 'a chunk matching both the words and the meaning ranks first');
select is((select count(*)::int from public.hybrid_search('travel', (select e1 from v), 8)), 2,
  'vector matches without the words are included too (own rows only)');
select is((select item_id from public.hybrid_search('bikes', (select e1 from v), 8) limit 1),
  'a0000000-0000-4000-8000-000000000002'::uuid, 'a keyword match outranks a meaning-only match');
select is((select count(*)::int from public.hybrid_search('travel', (select e1 from v), 1)), 1,
  'match_count limits the results');
select ok(not exists (select 1 from public.hybrid_search('travel', (select e1 from v), 8)
  where item_id = 'b0000000-0000-4000-8000-000000000001'), 'another person''s chunks never appear');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.hybrid_search('travel', (select e1 from v), 8)), 1,
  'each person searches only their own');
reset role;

set local role anon;
select throws_ok($$ select * from public.hybrid_search('travel', null, 8) $$, '42501', null,
  'anonymous callers cannot search');
reset role;

select * from finish();
rollback;
