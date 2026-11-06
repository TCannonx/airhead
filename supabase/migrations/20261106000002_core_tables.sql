-- 0002 Core tables: captures, items, lists, topics, corrections.
-- Same sync columns, trigger, index and RLS as 0001. Links between synced
-- tables (items.capture_id, items.list_id, ...) are deliberately NOT foreign
-- keys: devices push tables in batches in any order, and a row may arrive
-- before the row it points at.

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'link', 'ink', 'image', 'import')),
  text text,
  url text,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'app' check (source in ('app', 'shortcut', 'bookmarklet')),
  status text not null default 'unsorted'
    check (status in ('unsorted', 'sorted', 'needs_review', 'failed')),
  captured_at timestamptz not null default now(),
  sorted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_id uuid,
  type text not null
    check (type in ('task', 'event', 'reading', 'idea', 'meeting', 'note', 'list_entry')),
  title text not null default '',
  body text,
  data jsonb not null default '{}'::jsonb,
  -- open = active; suggested = waiting for a tap (fuzzy events, AI proposals);
  -- done = completed/read/ticked; dropped = let go.
  status text not null default 'open' check (status in ('open', 'suggested', 'done', 'dropped')),
  due_at timestamptz,
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean not null default false,
  rrule text,
  calendar text check (calendar in ('personal', 'us')),
  series_id uuid,
  list_id uuid,
  topic_ids uuid[] not null default '{}',
  confidence real check (confidence between 0 and 1),
  top3_date date,
  carry_count integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- from_value / to_value: the plan's "from" / "to" are reserved words in SQL.
create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_id uuid,
  from_value jsonb not null default '{}'::jsonb,
  to_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index items_user_type_idx on public.items (user_id, type) where deleted_at is null;
create index captures_user_status_idx on public.captures (user_id, status) where deleted_at is null;

-- Shared setup: trigger, sync index, RLS, grants -----------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['captures', 'items', 'lists', 'topics', 'corrections'] loop
    execute format(
      'create trigger set_server_updated_at before insert or update on public.%I
         for each row execute function public.set_server_updated_at()', t);
    execute format('create index %I on public.%I (user_id, server_updated_at)', t || '_sync_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: insert" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: update" on public.%I for update to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: delete" on public.%I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Realtime: other devices hear about changes within seconds (RLS still applies) -----
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['captures', 'items', 'lists', 'topics', 'corrections',
                           'settings', 'devices'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Nightly purge of rows soft-deleted more than 30 days ago -------------------------
create or replace function public.purge_soft_deleted()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  foreach t in array array['settings', 'devices', 'capture_tokens', 'captures', 'items',
                           'lists', 'topics', 'corrections'] loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - interval ''30 days''', t);
  end loop;
end;
$$;

revoke all on function public.purge_soft_deleted() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-soft-deleted', '17 3 * * *', 'select public.purge_soft_deleted()');

-- Private storage bucket for capture files: <user_id>/<file> ------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('captures', 'captures', false, 10485760,
        array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "captures bucket: own folder select" on storage.objects
  for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "captures bucket: own folder insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "captures bucket: own folder update" on storage.objects
  for update to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "captures bucket: own folder delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
