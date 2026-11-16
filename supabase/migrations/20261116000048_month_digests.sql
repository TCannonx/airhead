-- 0048 Month summaries (Task 14.2).
--
-- month_digests: one short summary per person per calendar month, built on
-- the 1st (or the first night after) from that month's weekly digests
-- (reviews.digest, written by the weekly review). Synced, read-only on the
-- device; service writes. When a weekly digest in that month changes, the
-- month is marked stale and rebuilt from its weeks, never patched.

create table public.month_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The first day of the month.
  month date not null check (extract(day from month) = 1),
  digest text not null default '',
  -- The weeks (reviews.week_start) it came from.
  week_starts date[] not null default '{}',
  stale boolean not null default false,
  built_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint month_digests_one_a_month unique (user_id, month)
);
create trigger set_server_updated_at before insert or update on public.month_digests
  for each row execute function public.set_server_updated_at();
create index month_digests_sync_idx on public.month_digests (user_id, server_updated_at);
alter table public.month_digests enable row level security;
create policy "own rows: select" on public.month_digests for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.month_digests from anon;
revoke insert, update, delete on public.month_digests from authenticated;
grant select on public.month_digests to authenticated;
alter publication supabase_realtime add table public.month_digests;

-- A week belongs to the month its Monday is in.
create or replace function public.review_month_digest_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.digest is distinct from old.digest or new.deleted_at is distinct from old.deleted_at then
    update public.month_digests m set stale = true
     where m.user_id = new.user_id and not m.stale
       and m.month = date_trunc('month', new.week_start)::date;
  end if;
  return null;
end;
$$;
revoke all on function public.review_month_digest_stale() from public, anon, authenticated;

create trigger review_month_digest_stale
  after update of digest, deleted_at on public.reviews
  for each row execute function public.review_month_digest_stale();
