-- 0018 Note documents (Task 6.1): the content of typed and handwritten notes,
-- one row per note item (same id), synced both ways as whole documents.
-- The server numbers every write (version); devices say which version an edit
-- was based on (base_version) and which device wrote it (writer_device), so a
-- device can tell another device's newer edit from its own and keep both
-- versions instead of losing writing (Task 6.2).

create table public.note_docs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null default 'typed' check (kind in ('typed', 'ink')),
  -- typed: { html } ; ink: { width, pages: [{ height, strokes, texts }] }
  doc jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  base_version integer not null default 0,
  writer_device uuid,
  -- Summarise (Task 6.7): { summary, decisions, actions, transcription, at }
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Every write gets the next version number, whatever the device sent.
create or replace function public.bump_note_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger bump_note_version before insert or update on public.note_docs
  for each row execute function public.bump_note_version();
create trigger set_server_updated_at before insert or update on public.note_docs
  for each row execute function public.set_server_updated_at();
create index note_docs_sync_idx on public.note_docs (user_id, server_updated_at);

alter table public.note_docs enable row level security;
create policy "own rows: select" on public.note_docs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.note_docs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.note_docs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.note_docs for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.note_docs from anon;
grant select, insert, update, delete on public.note_docs to authenticated;

alter publication supabase_realtime add table public.note_docs;

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
                           'nudges', 'briefs', 'note_docs'] loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - interval ''30 days''', t);
  end loop;
  delete from public.job_runs where local_date < current_date - 90;
  delete from public.briefs where local_date < current_date - 366;
end;
$$;
