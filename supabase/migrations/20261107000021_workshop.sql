-- 0021 Workshop (Task 7.5): drafts that flesh out an item, kept as versions,
-- and the collaborative session that produces them. Both sync both ways.

-- One row per version of an item's draft. Versions are append-only and
-- numbered by the server (per item), so two devices adding a version offline
-- never collide; the device's own number is only a placeholder.
create table public.drafts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null,
  version integer not null default 0,
  -- { summary, sections: [{ heading, body }], open_questions: [], next_steps: [] }
  content jsonb not null default '{}'::jsonb,
  source text not null default 'auto' check (source in ('auto', 'session', 'edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.number_draft_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  existing integer;
begin
  if tg_op = 'UPDATE' then
    -- A version keeps its number for good.
    new.version := old.version;
    return new;
  end if;
  -- Devices push with upsert: a row that is already here keeps its number
  -- (this trigger runs before the insert turns into an update).
  select d.version into existing from public.drafts d where d.id = new.id;
  if found then
    new.version := existing;
    return new;
  end if;
  -- Serialise numbering per item.
  perform pg_advisory_xact_lock(hashtext(new.item_id::text));
  select coalesce(max(d.version), 0) + 1 into new.version
    from public.drafts d where d.item_id = new.item_id;
  return new;
end;
$$;

create trigger number_draft_version before insert or update on public.drafts
  for each row execute function public.number_draft_version();
create trigger set_server_updated_at before insert or update on public.drafts
  for each row execute function public.set_server_updated_at();
create unique index drafts_item_version_idx on public.drafts (item_id, version);
create index drafts_sync_idx on public.drafts (user_id, server_updated_at);

-- One session per item (id = the item's id): the conversation so far and an
-- answer typed offline, waiting to be sent.
create table public.workshop_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- [{ role: 'airhead' | 'me', text, at }]
  turns jsonb not null default '[]'::jsonb,
  -- { text, at } or null
  pending jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger set_server_updated_at before insert or update on public.workshop_sessions
  for each row execute function public.set_server_updated_at();
create index workshop_sessions_sync_idx on public.workshop_sessions (user_id, server_updated_at);

do $$
declare
  t text;
begin
  foreach t in array array['drafts', 'workshop_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows: select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end;
$$;

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
                           'lists', 'topics', 'corrections', 'memory_facts', 'learned_rules',
                           'series', 'feeds', 'external_events', 'work_days', 'leave_bookings',
                           'nudges', 'briefs', 'note_docs', 'drafts', 'workshop_sessions'] loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - interval ''30 days''', t);
  end loop;
  delete from public.job_runs where local_date < current_date - 90;
  delete from public.briefs where local_date < current_date - 366;
end;
$$;
