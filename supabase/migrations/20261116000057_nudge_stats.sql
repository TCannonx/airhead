-- 0057 Outcome statistics (Task 17.1, Phase 17 "Learning and the weekly review").
--
-- nudge_stats: per person, per planner nudge kind, overall (page_id null) and
-- per page the nudge's item is on (series, place, person), the outcomes of the
-- last 8 weeks (acted, snoozed, dismissed, ignored) and the median snooze shift
-- in minutes (snoozed_to - send_at; positive = later). Rebuilt nightly in SQL by
-- refresh_nudge_stats (scheduler-tick, 03:40 local). No AI. Owner reads.

create table public.nudge_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  page_id uuid references public.pages (id) on delete cascade,
  acted integer not null default 0,
  snoozed integer not null default 0,
  dismissed integer not null default 0,
  ignored integer not null default 0,
  median_snooze_minutes integer,
  built_at timestamptz not null default now()
);
create unique index nudge_stats_one on public.nudge_stats (user_id, kind, coalesce(page_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.nudge_stats enable row level security;
create policy "own rows: select" on public.nudge_stats for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.nudge_stats from anon;
revoke insert, update, delete on public.nudge_stats from authenticated;
grant select on public.nudge_stats to authenticated;

create or replace function public.refresh_nudge_stats(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.nudge_stats where user_id = p_user_id;
  with o as (
    select n.kind, n.item_id, n.outcome,
           case when n.outcome = 'snoozed' and n.snoozed_to is not null
                then extract(epoch from (n.snoozed_to - n.send_at)) / 60 end as shift
      from public.nudges n
     where n.user_id = p_user_id and n.outcome is not null
       and n.kind in ('prepare', 'leave', 'do', 'follow_up', 'reading')
       and coalesce(n.outcome_at, n.send_at) >= now() - interval '8 weeks'
  ), tagged as (
    select o.*, null::uuid as page_id from o
    union all
    select o.*, p.id from o
      join public.page_items pi on pi.item_id = o.item_id and pi.deleted_at is null
      join public.pages p on p.id = pi.page_id and p.deleted_at is null
                         and p.kind in ('series', 'place', 'person')
  )
  insert into public.nudge_stats (user_id, kind, page_id, acted, snoozed, dismissed, ignored,
                                  median_snooze_minutes)
  select p_user_id, kind, page_id,
         count(*) filter (where outcome = 'acted'),
         count(*) filter (where outcome = 'snoozed'),
         count(*) filter (where outcome = 'dismissed'),
         count(*) filter (where outcome = 'ignored'),
         round(percentile_cont(0.5) within group (order by shift))::integer
    from tagged
   group by kind, page_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.refresh_nudge_stats(uuid) from public, anon, authenticated;
