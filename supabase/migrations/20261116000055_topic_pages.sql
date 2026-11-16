-- 0055 Topic pages that collate reading (Task 16.5).
--
-- A topic page (0049) is collated by AI once it has 3 or more reading items:
-- summary (at most 200 words), a one-line note per link (page_items.note), and
-- pages.collation { overlaps[], open_questions[], next_step }. Each new link
-- updates the page from its existing summary; removing a link rebuilds it from
-- every item (rebuild_requested_at), as does Collate on the device.

alter table public.pages add column collation jsonb not null default '{}'::jsonb;

-- A link added marks its page; a link removed from a topic page asks for a full rebuild.
create or replace function public.page_items_stale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.pages p
     set summary_stale = true,
         rebuild_requested_at = case
           when tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null
                and p.kind = 'topic' then now()
           else p.rebuild_requested_at end
   where p.id = new.page_id;
  return null;
end;
$$;
revoke all on function public.page_items_stale() from public, anon, authenticated;

-- How many reading items a page has (a topic page is collated from 3).
create or replace function public.page_reading_count(p_page_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.page_items pi join public.items i on i.id = pi.item_id
   where pi.page_id = p_page_id and pi.deleted_at is null
     and i.deleted_at is null and i.type = 'reading';
$$;
revoke all on function public.page_reading_count(uuid) from public, anon, authenticated;
grant execute on function public.page_reading_count(uuid) to service_role;

-- The owner may not write the collation (the 0049 trigger keeps the rest).
create or replace function public.pages_owner_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' or (select auth.role()) = 'authenticated' then
    new.kind := old.kind;
    new.key := old.key;
    new.summary := old.summary;
    new.facts := old.facts;
    new.collation := old.collation;
    new.item_count := old.item_count;
    new.last_item_at := old.last_item_at;
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;
