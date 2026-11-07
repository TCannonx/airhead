-- 0026 Tidy-up candidates (Task 8.2): what the weekly Tidy-up looks at, found
-- in code for free. Each row says why, and whether it is low risk ('auto':
-- removed without asking, recoverable for 30 days) or needs a decision
-- ('ask'). Meeting notes, notes and ideas are always 'ask'. Items the person
-- chose to keep (data.keep) or already archived are left alone.

create or replace function public.tidy_candidates(p_user_id uuid)
returns table (
  kind text,          -- 'item' or 'capture'
  id uuid,
  item_type text,
  title text,
  reason text,        -- done_old, read_old, past_event, duplicate, near_duplicate, stale_unsorted
  mode text,          -- auto or ask
  age_days integer,
  duplicate_of uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select i.* from public.items i
     where i.user_id = p_user_id and i.deleted_at is null
       and coalesce((i.data ->> 'keep')::boolean, false) = false
       and coalesce((i.data ->> 'archived')::boolean, false) = false
  ),
  dupes as (
    select l.id, l.type, l.title,
           first_value(l.id) over w as first_id,
           row_number() over w as n
      from live l
     where l.type <> 'list_entry' and length(trim(l.title)) > 0
    window w as (partition by l.type, lower(regexp_replace(trim(l.title), '\s+', ' ', 'g'))
                 order by l.created_at, l.id)
  ),
  recent_chunks as (
    select c.item_id, c.embedding
      from public.chunks c
      join live l on l.id = c.item_id
     where c.user_id = p_user_id and c.chunk_index = 0 and c.embedding is not null
     order by l.updated_at desc
     limit 300
  ),
  near as (
    select distinct on (greatest(a.item_id, b.item_id))
           greatest(a.item_id, b.item_id) as id, least(a.item_id, b.item_id) as other
      from recent_chunks a
      cross join lateral (
        select c.item_id, c.embedding operator(extensions.<#>) a.embedding as d
          from public.chunks c
         where c.user_id = p_user_id and c.chunk_index = 0 and c.item_id <> a.item_id
           and c.embedding is not null
         order by c.embedding operator(extensions.<#>) a.embedding
         limit 2) b
     where -b.d >= 0.95
  ),
  found as (
    select 'item' as kind, l.id, l.type, l.title, 'done_old' as reason,
           extract(day from now() - l.completed_at)::int as age_days, null::uuid as duplicate_of
      from live l
     where l.type = 'task' and l.status = 'done' and l.completed_at < now() - interval '90 days'
    union all
    select 'item', l.id, l.type, l.title, 'read_old',
           extract(day from now() - coalesce(l.completed_at, l.updated_at))::int, null
      from live l
     where l.type = 'reading' and l.status = 'done'
       and coalesce(l.completed_at, l.updated_at) < now() - interval '90 days'
    union all
    select 'item', l.id, l.type, l.title, 'past_event',
           extract(day from now() - coalesce(l.end_at, l.start_at))::int, null
      from live l
     where l.type = 'event' and l.rrule is null and l.start_at is not null
       and coalesce(l.end_at, l.start_at) < now() - interval '30 days'
       and coalesce(trim(l.body), '') = ''
       and not exists (select 1 from public.items m
                        where m.user_id = p_user_id and m.deleted_at is null
                          and m.type = 'meeting' and m.data ->> 'event_id' = l.id::text)
    union all
    select 'item', d.id, d.type, d.title, 'duplicate',
           extract(day from now() - l.created_at)::int, d.first_id
      from dupes d join live l on l.id = d.id
     where d.n > 1
    union all
    select 'item', l.id, l.type, l.title, 'near_duplicate',
           extract(day from now() - l.created_at)::int, n.other
      from near n join live l on l.id = n.id
    union all
    select 'capture', c.id, null, left(coalesce(c.text, c.url, ''), 120), 'stale_unsorted',
           extract(day from now() - c.captured_at)::int, null
      from public.captures c
     where c.user_id = p_user_id and c.deleted_at is null and c.status = 'unsorted'
       and c.captured_at < now() - interval '30 days'
  )
  select distinct on (f.kind, f.id)
         f.kind, f.id, f.type, left(f.title, 120), f.reason,
         case
           when f.type in ('meeting', 'note', 'idea') then 'ask'
           when f.reason in ('done_old', 'read_old', 'past_event', 'duplicate') then 'auto'
           else 'ask'
         end,
         f.age_days, f.duplicate_of
    from found f
   order by f.kind, f.id,
            case f.reason when 'duplicate' then 0 when 'near_duplicate' then 1 else 2 end
   limit 200;
$$;

revoke all on function public.tidy_candidates(uuid) from public, anon, authenticated;
grant execute on function public.tidy_candidates(uuid) to service_role;
