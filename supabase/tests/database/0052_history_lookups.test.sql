-- Tests for migration 0052: hybrid_search_for (Task 14.6).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

insert into public.chunks (user_id, item_id, chunk_index, content, content_hash) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-4000-8000-000000000521', 0,
   'Dentist appointment at the Smile Clinic, bring the insurance card', 'h1'),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-4000-8000-000000000522', 0,
   'Dentist for someone else', 'h2');

select is(
  (select array_agg(item_id::text) from public.hybrid_search_for(
     '00000000-0000-0000-0000-00000000000a', 'dentist',
     array_fill(0::real, array[384])::extensions.vector(384), 8, 1, 0)),
  array['10000000-0000-4000-8000-000000000521'],
  'keyword search over one person''s chunks only');

select ok(not has_function_privilege('authenticated',
  'public.hybrid_search_for(uuid, text, extensions.vector, integer, double precision, double precision, integer)',
  'execute'), 'devices cannot search for another user');

select * from finish();
rollback;
