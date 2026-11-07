-- 0022 Embeddings (Task 7.9): searchable chunks of every item, embedded with
-- Supabase's built-in gte-small model (384 dimensions, normalised), for Ask
-- Airhead's hybrid search (7.10). Server-only: devices don't sync chunks.

create extension if not exists vector with schema extensions;

create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null,
  chunk_index integer not null,
  content text not null,
  content_hash text not null,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, chunk_index)
);
create index chunks_user_idx on public.chunks (user_id);
create index chunks_fts_idx on public.chunks using gin (fts);
-- Normalised vectors: inner product (<#>) ranks the same as cosine, and is cheaper.
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_ip_ops);

alter table public.chunks enable row level security;
create policy "own rows: select" on public.chunks for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.chunks from anon;
revoke insert, update, delete on public.chunks from authenticated;
grant select on public.chunks to authenticated;

-- Items whose text changed since they were last embedded.
create table public.embed_queue (
  item_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  queued_at timestamptz not null default now()
);
alter table public.embed_queue enable row level security;
revoke all on public.embed_queue from anon, authenticated;

create or replace function public.queue_embedding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item uuid;
begin
  -- Separate branches: plpgsql would fail on new.item_id for tables without it.
  if tg_table_name = 'drafts' then
    v_item := new.item_id;
  else
    v_item := new.id;
  end if;
  insert into public.embed_queue (item_id, user_id) values (v_item, new.user_id)
    on conflict (item_id) do update set queued_at = now();
  return new;
end;
$$;

create trigger queue_embedding after insert or update of title, body, data, deleted_at, status
  on public.items for each row execute function public.queue_embedding();
create trigger queue_embedding after insert or update of doc, deleted_at
  on public.note_docs for each row execute function public.queue_embedding();
create trigger queue_embedding after insert or update of content, deleted_at
  on public.drafts for each row execute function public.queue_embedding();

-- Takes up to p_limit queued items (oldest first) for one embed-items run.
create or replace function public.take_embed_queue(p_limit integer)
returns table (item_id uuid, user_id uuid)
language sql
security definer
set search_path = ''
as $$
  delete from public.embed_queue q
   where q.item_id in (
     select e.item_id from public.embed_queue e
      order by e.queued_at
      limit p_limit
      for update skip locked)
  returning q.item_id, q.user_id;
$$;
revoke all on function public.take_embed_queue(integer) from public, anon, authenticated;
grant execute on function public.take_embed_queue(integer) to service_role;

-- Every 5 minutes, when anything is waiting, ask embed-items to work through it.
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
  if not exists (select 1 from public.embed_queue) then
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

select cron.schedule('embed-items', '*/5 * * * *', 'select public.dispatch_embed_items()');

-- Everything already there gets embedded once.
insert into public.embed_queue (item_id, user_id)
  select i.id, i.user_id from public.items i where i.deleted_at is null
  on conflict (item_id) do nothing;
