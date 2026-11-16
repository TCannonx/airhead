-- 0058 Timing preferences (Task 17.2).
--
-- timing_prefs: one row per learned timing pattern (a nudge kind on a page),
-- linked to the everyday memory fact that words it, so later outcomes can
-- confirm or contradict it. A fact contradicted by 3 later outcomes is
-- archived (memory_facts.status = 'archived'), visibly, in Settings -> Memory.
-- Server-only (the fact itself is what the owner sees and can remove).

create table public.timing_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  page_id uuid references public.pages (id) on delete cascade,
  direction text not null check (direction in ('later', 'earlier')),
  shift_minutes integer not null,
  fact_id uuid references public.memory_facts (id) on delete set null,
  contradictions integer not null default 0,
  checked_until timestamptz not null default now(),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index timing_prefs_one on public.timing_prefs
  (user_id, kind, coalesce(page_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where not archived;
alter table public.timing_prefs enable row level security;
create policy "own rows: select" on public.timing_prefs for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.timing_prefs from anon;
revoke insert, update, delete on public.timing_prefs from authenticated;
grant select on public.timing_prefs to authenticated;
