-- 0023 Ask Airhead search (Task 7.10): hybrid keyword + vector search over the
-- caller's own chunks, merged by reciprocal rank fusion (k = 50), following
-- Supabase's hybrid search guide. Security invoker: RLS keeps it to own rows.

create or replace function public.hybrid_search(
  query_text text,
  query_embedding extensions.vector(384),
  match_count integer default 8,
  full_text_weight double precision default 1,
  semantic_weight double precision default 1,
  rrf_k integer default 50
)
returns table (id uuid, item_id uuid, chunk_index integer, content text, score double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with full_text as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc) as rank_ix
      from public.chunks c
     where c.user_id = (select auth.uid())
       and c.fts @@ websearch_to_tsquery('english', query_text)
     order by rank_ix
     limit least(match_count, 30) * 2
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding operator(extensions.<#>) query_embedding) as rank_ix
      from public.chunks c
     where c.user_id = (select auth.uid())
       and c.embedding is not null
     order by rank_ix
     limit least(match_count, 30) * 2
  )
  select c.id, c.item_id, c.chunk_index, c.content,
         coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
       + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight as score
    from full_text
    full outer join semantic on full_text.id = semantic.id
    join public.chunks c on c.id = coalesce(full_text.id, semantic.id)
   order by score desc
   limit least(match_count, 30);
$$;

revoke all on function public.hybrid_search(text, extensions.vector, integer, double precision, double precision, integer)
  from public, anon;
grant execute on function public.hybrid_search(text, extensions.vector, integer, double precision, double precision, integer)
  to authenticated;
