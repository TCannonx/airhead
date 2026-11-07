-- 0008 Memory: fact profile and learned rules (both synced to devices).

create table public.memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null,
  category text not null default 'everyday' check (category in ('everyday', 'person', 'personal')),
  status text not null default 'active' check (status in ('active', 'pending_approval', 'archived')),
  source_capture_id uuid,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.learned_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pattern text not null,
  match_kind text not null default 'prefix' check (match_kind in ('prefix', 'keyword')),
  -- { type, list_id, calendar }
  result jsonb not null default '{}'::jsonb,
  hits integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint learned_rules_unique unique (user_id, match_kind, pattern)
);

do $$
declare
  t text;
begin
  foreach t in array array['memory_facts', 'learned_rules'] loop
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
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end;
$$;

-- The nightly purge now covers the memory tables too.
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
                           'lists', 'topics', 'corrections', 'memory_facts', 'learned_rules'] loop
    execute format(
      'delete from public.%I where deleted_at is not null and deleted_at < now() - interval ''30 days''', t);
  end loop;
end;
$$;

-- Facts proposed by a sort batch. Only from captures the person typed (the
-- caller excludes web pages and imports); duplicates (case-insensitive) skipped.
create or replace function public.add_memory_facts(p_user_id uuid, p_facts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fact jsonb;
  v_added integer := 0;
begin
  for v_fact in select * from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb)) loop
    continue when coalesce(trim(v_fact ->> 'text'), '') = '';
    continue when exists (
      select 1 from public.memory_facts f
      where f.user_id = p_user_id and f.deleted_at is null
        and lower(trim(f.text)) = lower(trim(v_fact ->> 'text'))
    );
    insert into public.memory_facts (user_id, text, category, status, source_capture_id)
    values (
      p_user_id,
      trim(v_fact ->> 'text'),
      v_fact ->> 'category',
      case when v_fact ->> 'category' = 'everyday' then 'active' else 'pending_approval' end,
      (v_fact ->> 'source_capture_id')::uuid
    );
    v_added := v_added + 1;
  end loop;
  return v_added;
end;
$$;

-- Learned rules: when captures starting with the same word have been sorted
-- into exactly one item with the same result at least 4 times, never
-- corrected, and that word never led anywhere else, create a prefix rule.
create or replace function public.learn_rules(p_user_id uuid, p_min_hits integer default 4)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_added integer;
begin
  with single as (
    select c.id, lower(regexp_replace(split_part(trim(c.text), ' ', 1), '[^[:alnum:]'']', '', 'g')) as word,
           i.type, i.list_id, i.calendar
    from public.captures c
    join public.items i on i.capture_id = c.id and i.deleted_at is null
    where c.user_id = p_user_id and c.kind = 'text' and c.status = 'sorted' and c.deleted_at is null
      and (select count(*) from public.items i2 where i2.capture_id = c.id and i2.deleted_at is null) = 1
      and not exists (select 1 from public.corrections k where k.capture_id = c.id and k.deleted_at is null)
      and coalesce(c.payload ->> 'rule_id', '') = ''
  ),
  words as (
    select word, min(type) as type, min(list_id::text)::uuid as list_id, min(calendar) as calendar, count(*) as n
    from single
    where length(word) >= 3
      and word not in ('the', 'and', 'for', 'this', 'that', 'with', 'about', 'from', 'maybe', 'some')
    group by word
    having count(distinct (type, coalesce(list_id::text, ''), coalesce(calendar, ''))) = 1
       and count(*) >= p_min_hits
  ),
  inserted as (
    insert into public.learned_rules (user_id, pattern, match_kind, result, hits)
    select p_user_id, w.word, 'prefix',
           jsonb_strip_nulls(jsonb_build_object('type', w.type, 'list_id', w.list_id, 'calendar', w.calendar)),
           w.n
    from words w
    on conflict (user_id, match_kind, pattern) do nothing
    returning 1
  )
  select count(*) into v_added from inserted;
  return v_added;
end;
$$;

-- Facts unused for 180 days are archived (still listed, no longer sent).
create or replace function public.archive_stale_facts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with archived as (
    update public.memory_facts
      set status = 'archived'
      where status = 'active' and deleted_at is null
        and coalesce(last_used_at, created_at) < now() - interval '180 days'
      returning 1
  )
  select count(*)::integer from archived;
$$;

revoke all on function public.add_memory_facts(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.learn_rules(uuid, integer) from public, anon, authenticated;
revoke all on function public.archive_stale_facts() from public, anon, authenticated;
grant execute on function public.add_memory_facts(uuid, jsonb) to service_role;
grant execute on function public.learn_rules(uuid, integer) to service_role;

select cron.schedule('archive-stale-facts', '41 3 * * *', 'select public.archive_stale_facts()');
