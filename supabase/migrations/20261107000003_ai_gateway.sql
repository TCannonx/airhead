-- 0003 AI gateway: per-call usage log, editable price table, month-to-date spend.

-- Prices in US dollars per million tokens, converted with eur_rate (euros per
-- dollar). user_id null = the default row for everyone; a user row overrides it.
create table public.ai_prices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  model text not null,
  input_per_mtok numeric(10, 4) not null,
  output_per_mtok numeric(10, 4) not null,
  cache_read_per_mtok numeric(10, 4) not null,
  cache_write_per_mtok numeric(10, 4) not null,
  eur_rate numeric(8, 4) not null default 1,
  updated_at timestamptz not null default now(),
  constraint ai_prices_user_model unique nulls not distinct (user_id, model)
);

alter table public.ai_prices enable row level security;
create policy "prices: read defaults and own" on public.ai_prices for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy "prices: insert own" on public.ai_prices for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "prices: update own" on public.ai_prices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "prices: delete own" on public.ai_prices for delete to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ai_prices from anon;
grant select, insert, update, delete on public.ai_prices to authenticated;

-- Seed defaults (Anthropic list prices; editable in Insights → AI usage).
insert into public.ai_prices
  (user_id, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, eur_rate)
values
  (null, 'claude-haiku-5-5', 0.10, 0.50, 0.01, 0.125, 0.86),
  (null, 'claude-sonnet-5-5', 2.00, 10.00, 0.20, 2.50, 0.86);

-- One row per AI call attempt (successful or not). Written only by Edge
-- Functions (service role); users read their own rows through ai_usage_mine.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task text not null,
  tier text not null check (tier in ('small', 'large')),
  model text not null,
  attempt smallint not null default 1,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_eur numeric(12, 6) not null default 0,
  ok boolean not null,
  error_code text,
  created_at timestamptz not null default now()
);

create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at);

alter table public.ai_usage enable row level security;
create policy "usage: read own" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- The user-scoped view the app reads (RLS of the caller applies).
create view public.ai_usage_mine with (security_invoker = true) as
  select id, task, tier, model, attempt, input_tokens, output_tokens, cache_read_tokens,
         cache_write_tokens, cost_eur, ok, error_code, created_at
  from public.ai_usage;
revoke all on public.ai_usage_mine from anon;
grant select on public.ai_usage_mine to authenticated;

-- Month-to-date spend in euros, by the calendar month in Europe/Dublin.
-- Used by the gateway (service role) for the monthly cap.
create or replace function public.ai_month_to_date_eur(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_eur), 0)
  from public.ai_usage
  where user_id = p_user_id
    and created_at >= (date_trunc('month', now() at time zone 'Europe/Dublin') at time zone 'Europe/Dublin');
$$;

revoke all on function public.ai_month_to_date_eur(uuid) from public, anon, authenticated;
grant execute on function public.ai_month_to_date_eur(uuid) to service_role;
