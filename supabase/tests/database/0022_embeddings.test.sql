-- Tests for migration 0022: embeddings.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');
delete from public.embed_queue;

select has_table('public', 'chunks', 'chunks exists');
select has_index('public', 'chunks', 'chunks_embedding_idx', 'chunks have an HNSW index');
select col_type_is('public', 'chunks', 'embedding', 'extensions', 'vector(384)', 'gte-small vectors (384)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into public.items (id, type, title) values ('a0000000-0000-4000-8000-000000000001', 'idea', 'Garden shed');
reset role;
select results_eq($$ select item_id from public.embed_queue $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid) $$, 'a new item is queued');

delete from public.embed_queue;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
update public.items set top3_date = current_date where id = 'a0000000-0000-4000-8000-000000000001';
reset role;
select is_empty($$ select 1 from public.embed_queue $$, 'changes that don''t touch text are not queued');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into public.drafts (id, item_id, content) values
  ('a0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-000000000001', '{"summary": "A shed"}');
reset role;
select results_eq($$ select item_id from public.embed_queue $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid) $$, 'a new draft queues its item');

set local role service_role;
select results_eq($$ select item_id from public.take_embed_queue(10) $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid) $$, 'the embedder takes queued items');
reset role;
select is_empty($$ select 1 from public.embed_queue $$, 'taken items leave the queue');

insert into public.chunks (user_id, item_id, chunk_index, content, content_hash, embedding) values
  ('00000000-0000-0000-0000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 0, 'Garden shed for bikes', 'h',
   array_fill(0.05, array[384])::extensions.vector);
select ok((select fts @@ to_tsquery('english', 'bike') from public.chunks), 'chunks are full-text searchable');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is((select count(*)::int from public.chunks), 1, 'the owner can read their chunks');
select throws_ok($$ insert into public.chunks (user_id, item_id, chunk_index, content, content_hash) values
  ('00000000-0000-0000-0000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 1, 'x', 'h') $$,
  '42501', null, 'devices cannot write chunks');
select throws_ok($$ select * from public.take_embed_queue(1) $$, '42501', null, 'users cannot take the queue');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.chunks $$, 'others cannot read them');
reset role;

select * from finish();
rollback;
