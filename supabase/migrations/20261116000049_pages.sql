-- 0049 Pages, built by code (Task 14.3).
--
-- pages: one running page per person, place, project, repeating event (series)
-- and topic. This first pass makes, without AI:
--   series: one per series_id (series.name), and one per repeating event (rrule);
--   topic:  one per topic an item belongs to (items.topic_ids);
--   place:  one per event location used by 3 or more events.
-- page_items links items to pages (note: one line, written later by AI).
-- Synced. The owner reads both, and may rename or archive a page (a trigger
-- keeps every other column as the server wrote it); only the server links items.
-- A queue (page_queue) and drain (drain_page_queue, run by scheduler-tick)
-- keep page_items in step as items change, like plan_queue (0042).

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('person', 'place', 'project', 'series', 'topic')),
  -- What the page is about, stable across renames: series:<id>, rrule:<item id>,
  -- topic:<id>, place:<normalised location>, person:<name>, project:<name>.
  key text not null,
  name text not null,
  summary text not null default '',
  facts jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'pending_approval', 'archived')),
  item_count integer not null default 0,
  last_item_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint pages_key unique (user_id, key)
);
create trigger set_server_updated_at before insert or update on public.pages
  for each row execute function public.set_server_updated_at();
create index pages_sync_idx on public.pages (user_id, server_updated_at);
alter table public.pages enable row level security;
create policy "own rows: select" on public.pages for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.pages for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.pages for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.pages from anon;
revoke delete on public.pages from authenticated;
grant select, insert, update on public.pages to authenticated;
alter publication supabase_realtime add table public.pages;

-- A device may change only the name and status (rename, archive); the rest stays the server's.
create or replace function public.pages_owner_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated' then
    new.kind := old.kind;
    new.key := old.key;
    new.summary := old.summary;
    new.facts := old.facts;
    new.item_count := old.item_count;
    new.last_item_at := old.last_item_at;
    new.deleted_at := old.deleted_at;
    -- A person page waiting for approval may be approved (active) or archived, never made pending.
  end if;
  return new;
end;
$$;
create trigger pages_owner_edits before update on public.pages
  for each row execute function public.pages_owner_edits();

create table public.page_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  page_id uuid not null references public.pages (id) on delete cascade,
  item_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint page_items_one unique (page_id, item_id)
);
create trigger set_server_updated_at before insert or update on public.page_items
  for each row execute function public.set_server_updated_at();
create index page_items_sync_idx on public.page_items (user_id, server_updated_at);
create index page_items_item_idx on public.page_items (item_id);
alter table public.page_items enable row level security;
create policy "own rows: select" on public.page_items for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.page_items from anon;
revoke insert, update, delete on public.page_items from authenticated;
grant select on public.page_items to authenticated;
alter publication supabase_realtime add table public.page_items;

create table public.page_queue (
  item_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  queued_at timestamptz not null default now()
);
alter table public.page_queue enable row level security;
revoke all on public.page_queue from anon, authenticated;

create or replace function public.item_page_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.page_queue (item_id, user_id) values (new.id, new.user_id)
  on conflict (item_id) do update set queued_at = now();
  return null;
end;
$$;
revoke all on function public.item_page_queue() from public, anon, authenticated;
create trigger item_page_queue
  after insert or update of title, type, status, series_id, rrule, topic_ids, data, start_at, deleted_at
  on public.items
  for each row execute function public.item_page_queue();

-- Links one page and an item, creating the page if needed. Returns the page id.
create or replace function public.link_page(
  p_user_id uuid, p_kind text, p_key text, p_name text, p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page uuid;
begin
  insert into public.pages (user_id, kind, key, name)
  values (p_user_id, p_kind, p_key, left(p_name, 120))
  on conflict (user_id, key) do update set deleted_at = null
    where public.pages.deleted_at is not null
  returning id into v_page;
  if v_page is null then
    select id into v_page from public.pages where user_id = p_user_id and key = p_key;
  end if;
  insert into public.page_items (user_id, page_id, item_id) values (p_user_id, v_page, p_item_id)
  on conflict (page_id, item_id) do update set deleted_at = null, updated_at = now()
    where public.page_items.deleted_at is not null;
  return v_page;
end;
$$;
revoke all on function public.link_page(uuid, text, text, text, uuid) from public, anon, authenticated;

-- Keeps the code-built pages (series, topic, place) in step for queued items.
create or replace function public.drain_page_queue(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q record;
  v_item public.items%rowtype;
  v_keys text[];
  v_pages uuid[] := '{}';
  v_page uuid;
  v_topic record;
  v_loc text;
  v_other record;
  v_done integer := 0;
begin
  for v_q in select * from public.page_queue order by queued_at limit p_limit loop
    v_keys := '{}';
    select * into v_item from public.items where id = v_q.item_id;
    if found and v_item.deleted_at is null and v_item.status in ('open', 'done') then
      if v_item.series_id is not null then
        v_page := public.link_page(v_item.user_id, 'series', 'series:' || v_item.series_id,
          coalesce((select s.name from public.series s where s.id = v_item.series_id), v_item.title),
          v_item.id);
        v_keys := v_keys || ('series:' || v_item.series_id);
        v_pages := v_pages || v_page;
      elsif v_item.type = 'event' and v_item.rrule is not null then
        v_page := public.link_page(v_item.user_id, 'series', 'rrule:' || v_item.id, v_item.title, v_item.id);
        v_keys := v_keys || ('rrule:' || v_item.id);
        v_pages := v_pages || v_page;
      end if;

      for v_topic in select t.id, t.name from public.topics t
                      where t.id = any (v_item.topic_ids) and t.deleted_at is null loop
        v_page := public.link_page(v_item.user_id, 'topic', 'topic:' || v_topic.id, v_topic.name, v_item.id);
        v_keys := v_keys || ('topic:' || v_topic.id);
        v_pages := v_pages || v_page;
      end loop;

      v_loc := lower(btrim(coalesce(v_item.data ->> 'location', '')));
      if v_item.type = 'event' and length(v_loc) >= 2 and (
           select count(*) from public.items i
            where i.user_id = v_item.user_id and i.type = 'event' and i.deleted_at is null
              and lower(btrim(coalesce(i.data ->> 'location', ''))) = v_loc) >= 3 then
        -- Every event at that place belongs to its page (the third one creates it).
        for v_other in select i.id from public.items i
                        where i.user_id = v_item.user_id and i.type = 'event' and i.deleted_at is null
                          and lower(btrim(coalesce(i.data ->> 'location', ''))) = v_loc loop
          v_page := public.link_page(v_item.user_id, 'place', 'place:' || v_loc,
            btrim(v_item.data ->> 'location'), v_other.id);
        end loop;
        v_keys := v_keys || ('place:' || v_loc);
        v_pages := v_pages || v_page;
      end if;
    end if;

    -- Unlink the item from code-built pages it no longer belongs to.
    with gone as (
      update public.page_items pi set deleted_at = now(), updated_at = now()
        from public.pages p
       where pi.page_id = p.id and pi.item_id = v_q.item_id and pi.deleted_at is null
         and p.kind in ('series', 'topic', 'place')
         and not (p.key = any (v_keys))
      returning pi.page_id)
    select v_pages || coalesce(array_agg(page_id), '{}') into v_pages from gone;

    delete from public.page_queue where item_id = v_q.item_id and queued_at = v_q.queued_at;
    v_done := v_done + 1;
  end loop;

  -- Counts and the latest item for every page touched.
  update public.pages p
     set item_count = c.n, last_item_at = c.last_at, updated_at = now()
    from (select pi.page_id, count(*)::integer as n,
                 max(coalesce(i.start_at, i.due_at, i.created_at)) as last_at
            from public.page_items pi join public.items i on i.id = pi.item_id
           where pi.page_id = any (v_pages) and pi.deleted_at is null and i.deleted_at is null
           group by pi.page_id) c
   where p.id = c.page_id;
  update public.pages p set item_count = 0, updated_at = now()
   where p.id = any (v_pages)
     and not exists (select 1 from public.page_items pi where pi.page_id = p.id and pi.deleted_at is null);
  return v_done;
end;
$$;
revoke all on function public.drain_page_queue(integer) from public, anon, authenticated;

-- First pass over existing items.
insert into public.page_queue (item_id, user_id)
select i.id, i.user_id from public.items i
 where i.deleted_at is null
   and (i.series_id is not null or i.rrule is not null or cardinality(i.topic_ids) > 0
        or coalesce(i.data ->> 'location', '') <> '')
on conflict (item_id) do nothing;

-- The tick also runs for queued page work (copy of 0042 with that one change).
create or replace function public.dispatch_scheduler_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return false;
  end if;
  if not exists (select 1 from public.devices
                  where receives_notifications and push_subscription is not null and deleted_at is null)
     and not exists (select 1 from public.plan_queue)
     and not exists (select 1 from public.page_queue) then
    return false;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/scheduler-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  return true;
end;
$$;
revoke all on function public.dispatch_scheduler_tick() from public, anon, authenticated;
