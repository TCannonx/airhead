-- 0051 Page summaries (Task 14.5).
--
-- A page's summary (at most 150 words) and up to 8 dated facts are refreshed
-- nightly by scheduler-tick for pages whose items changed: the existing summary
-- plus the new or changed items in, a new summary out (prompt page.v1). The
-- owner can ask for a rebuild from every item (rebuild_requested_at, set from
-- the page; the owner-edit trigger in 0049 lets it through). Person pages are
-- summarised only once approved.

alter table public.pages
  add column summary_stale boolean not null default false,
  add column summarised_at timestamptz,
  add column rebuild_requested_at timestamptz;

create index pages_summary_due_idx on public.pages (user_id)
  where summary_stale or rebuild_requested_at is not null;

-- A link added or removed marks its page.
create or replace function public.page_items_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pages set summary_stale = true where id = new.page_id and not summary_stale;
  return null;
end;
$$;
revoke all on function public.page_items_stale() from public, anon, authenticated;
create trigger page_items_stale after insert or update of deleted_at on public.page_items
  for each row execute function public.page_items_stale();

-- A change to an item marks every page it is on.
create or replace function public.item_pages_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pages p set summary_stale = true
    from public.page_items pi
   where pi.item_id = new.id and pi.page_id = p.id and pi.deleted_at is null and not p.summary_stale;
  return null;
end;
$$;
revoke all on function public.item_pages_stale() from public, anon, authenticated;
create trigger item_pages_stale
  after update of title, body, status, start_at, due_at, data, deleted_at on public.items
  for each row execute function public.item_pages_stale();

-- Pages to summarise tonight: approved (or code-built), not archived, changed
-- or asked to rebuild; rebuilds first, then those idle longest.
create or replace function public.pages_to_summarise(p_user_id uuid, p_limit integer default 20)
returns setof public.pages
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.pages p
   where p.user_id = p_user_id and p.deleted_at is null and p.status = 'active'
     and (p.summary_stale or p.rebuild_requested_at is not null)
     and p.item_count > 0
   order by (p.rebuild_requested_at is not null) desc, p.summarised_at nulls first
   limit p_limit;
$$;
revoke all on function public.pages_to_summarise(uuid, integer) from public, anon, authenticated;
grant execute on function public.pages_to_summarise(uuid, integer) to service_role;
