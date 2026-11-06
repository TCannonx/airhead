-- 0001 Foundation: sync-column trigger, settings, devices, capture_tokens, RLS.
--
-- Every synced table has the same shape:
--   id                 uuid, generated on the device
--   user_id            owner (defaults to the signed-in user)
--   created_at         device time, informational
--   updated_at         device time, informational
--   server_updated_at  set by trigger on every insert/update; the ONLY value used for sync ordering
--   deleted_at         soft delete; purged after 30 days (job added in 0002)
-- and the same rule: a user can only see and change rows where user_id = auth.uid().

-- Trigger function -------------------------------------------------------------
create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

comment on function public.set_server_updated_at() is
  'Stamps server_updated_at on insert/update so device clocks never decide sync order.';

-- settings: one row per user ----------------------------------------------------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint settings_one_per_user unique (user_id)
);

-- devices: each installed device --------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  platform text not null,
  push_subscription jsonb,
  receives_notifications boolean not null default false,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- capture_tokens: Shortcut and bookmarklet tokens (only a hash is stored) -------
create table public.capture_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  token_hash text not null unique,
  label text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Shared setup for each synced table: trigger, sync index, RLS, grants ---------
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'devices', 'capture_tokens'] loop
    execute format(
      'create trigger set_server_updated_at before insert or update on public.%I
         for each row execute function public.set_server_updated_at()', t);

    execute format(
      'create index %I on public.%I (user_id, server_updated_at)', t || '_sync_idx', t);

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

    -- Signed-out visitors get nothing at all (defence in depth on top of RLS).
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;
