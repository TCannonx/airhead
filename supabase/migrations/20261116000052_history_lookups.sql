-- 0052 Look-ups the planner can call (Task 14.6).
--
-- hybrid_search (0023) is security invoker and filters by auth.uid(), so it
-- works for a signed-in caller only. The planner runs with the service key on
-- one person's behalf: hybrid_search_for is the same search for a given user,
-- callable by the service role only. Same ranking (reciprocal rank fusion).

create or replace function public.hybrid_search_for(
  p_user_id uuid,
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
security definer
set search_path = ''
as $$
  with full_text as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc) as rank_ix
      from public.chunks c
     where c.user_id = p_user_id
       and c.fts @@ websearch_to_tsquery('english', query_text)
     order by rank_ix
     limit least(match_count, 30) * 2
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding operator(extensions.<#>) query_embedding) as rank_ix
      from public.chunks c
     where c.user_id = p_user_id
       and c.embedding is not null and semantic_weight > 0
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

revoke all on function public.hybrid_search_for(uuid, text, extensions.vector, integer, double precision, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.hybrid_search_for(uuid, text, extensions.vector, integer, double precision, double precision, integer)
  to service_role;
