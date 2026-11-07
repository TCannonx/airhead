-- 0024 Memory by relevance (Task 7.11): facts get gte-small embeddings in a
-- server-only table (memory_facts syncs to devices, and 384 numbers per fact
-- don't belong there), so sorting and the Workshop can add the facts closest
-- to the text at hand on top of the core profile.

create table public.fact_embeddings (
  fact_id uuid primary key references public.memory_facts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- md5 of the fact's text when it was embedded; a changed text is re-embedded.
  text_hash text not null,
  embedding extensions.vector(384) not null,
  updated_at timestamptz not null default now()
);
create index fact_embeddings_user_idx on public.fact_embeddings (user_id);
alter table public.fact_embeddings enable row level security;
revoke all on public.fact_embeddings from anon, authenticated;

-- Active facts with no embedding yet, or whose text changed since.
create or replace function public.facts_to_embed(p_limit integer)
returns table (id uuid, user_id uuid, text text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.user_id, f.text
    from public.memory_facts f
    left join public.fact_embeddings e on e.fact_id = f.id
   where f.status = 'active' and f.deleted_at is null
     and (e.fact_id is null or e.text_hash <> md5(f.text))
   order by f.created_at
   limit p_limit;
$$;

create or replace function public.store_fact_embedding(p_fact uuid, p_embedding extensions.vector(384))
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fact_embeddings (fact_id, user_id, text_hash, embedding)
  select f.id, f.user_id, md5(f.text), p_embedding from public.memory_facts f where f.id = p_fact
  on conflict (fact_id) do update
    set text_hash = excluded.text_hash, embedding = excluded.embedding, updated_at = now();
$$;

-- The user's active facts closest to an embedding (normalised: similarity = -inner product).
create or replace function public.relevant_facts(
  p_user uuid,
  p_embedding extensions.vector(384),
  p_limit integer default 8,
  p_min double precision default 0.8
)
returns table (id uuid, text text, last_used_at timestamptz, created_at timestamptz, similarity double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.text, f.last_used_at, f.created_at,
         -(e.embedding operator(extensions.<#>) p_embedding) as similarity
    from public.fact_embeddings e
    join public.memory_facts f on f.id = e.fact_id
   where e.user_id = p_user and f.user_id = p_user
     and f.status = 'active' and f.deleted_at is null
     and -(e.embedding operator(extensions.<#>) p_embedding) >= p_min
   order by e.embedding operator(extensions.<#>) p_embedding
   limit p_limit;
$$;

revoke all on function public.facts_to_embed(integer) from public, anon, authenticated;
revoke all on function public.store_fact_embedding(uuid, extensions.vector) from public, anon, authenticated;
revoke all on function public.relevant_facts(uuid, extensions.vector, integer, double precision)
  from public, anon, authenticated;
grant execute on function public.facts_to_embed(integer) to service_role;
grant execute on function public.store_fact_embedding(uuid, extensions.vector) to service_role;
grant execute on function public.relevant_facts(uuid, extensions.vector, integer, double precision)
  to service_role;

-- The embedder also runs when facts are waiting.
create or replace function public.dispatch_embed_items()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.embed_queue)
     and not exists (select 1 from public.facts_to_embed(1)) then
    return 0;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return 0;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/embed-items',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  return 1;
end;
$$;
revoke all on function public.dispatch_embed_items() from public, anon, authenticated;
