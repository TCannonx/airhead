-- 0050 People and projects on pages (Task 14.4).
--
-- Sorting (prompt sort-batch.v8) now returns mentions on each item, at most 5
-- per capture, kept in items.data.mentions. The page drain (0049) links each
-- item to a person or project page by normalised name, creating it if needed.
-- A new person page starts pending_approval and is approved (or archived) by
-- the owner under Settings -> Memory, as personal facts are. An item whose
-- mentions change is unlinked from pages it no longer mentions.

-- "Niamh  O'Brien" and "niamh o'brien" are the same page.
create or replace function public.page_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'));
$$;

create or replace function public.drain_page_queue(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q record;
  v_item public.items%rowtype;
  v_keys text[];
  v_pages uuid[] := '{}';
  v_page uuid;
  v_topic record;
  v_loc text;
  v_other record;
  v_mention jsonb;
  v_name text;
  v_norm text;
  v_done integer := 0;
begin
  for v_q in select * from public.page_queue order by queued_at limit p_limit loop
    v_keys := '{}';
    select * into v_item from public.items where id = v_q.item_id;
    if found and v_item.deleted_at is null and v_item.status in ('open', 'done') then
      if v_item.series_id is not null then
        v_page := public.link_page(v_item.user_id, 'series', 'series:' || v_item.series_id,
          coalesce((select s.name from public.series s where s.id = v_item.series_id), v_item.title),
          v_item.id);
        v_keys := v_keys || ('series:' || v_item.series_id);
        v_pages := v_pages || v_page;
      elsif v_item.type = 'event' and v_item.rrule is not null then
        v_page := public.link_page(v_item.user_id, 'series', 'rrule:' || v_item.id, v_item.title, v_item.id);
        v_keys := v_keys || ('rrule:' || v_item.id);
        v_pages := v_pages || v_page;
      end if;

      for v_topic in select t.id, t.name from public.topics t
                      where t.id = any (v_item.topic_ids) and t.deleted_at is null loop
        v_page := public.link_page(v_item.user_id, 'topic', 'topic:' || v_topic.id, v_topic.name, v_item.id);
        v_keys := v_keys || ('topic:' || v_topic.id);
        v_pages := v_pages || v_page;
      end loop;

      v_loc := lower(btrim(coalesce(v_item.data ->> 'location', '')));
      if v_item.type = 'event' and length(v_loc) >= 2 and (
           select count(*) from public.items i
            where i.user_id = v_item.user_id and i.type = 'event' and i.deleted_at is null
              and lower(btrim(coalesce(i.data ->> 'location', ''))) = v_loc) >= 3 then
        -- Every event at that place belongs to its page (the third one creates it).
        for v_other in select i.id from public.items i
                        where i.user_id = v_item.user_id and i.type = 'event' and i.deleted_at is null
                          and lower(btrim(coalesce(i.data ->> 'location', ''))) = v_loc loop
          v_page := public.link_page(v_item.user_id, 'place', 'place:' || v_loc,
            btrim(v_item.data ->> 'location'), v_other.id);
        end loop;
        v_keys := v_keys || ('place:' || v_loc);
        v_pages := v_pages || v_page;
      end if;

      -- People and projects the item mentions (Task 14.4). A new person page waits
      -- for the owner's approval, as personal facts do.
      for v_mention in select * from jsonb_array_elements(
                         case when jsonb_typeof(v_item.data -> 'mentions') = 'array'
                              then v_item.data -> 'mentions' else '[]'::jsonb end) loop
        continue when v_mention ->> 'kind' not in ('person', 'project');
        v_name := left(regexp_replace(btrim(coalesce(v_mention ->> 'name', '')), '\s+', ' ', 'g'), 60);
        continue when length(v_name) < 2;
        v_norm := public.page_name_key(v_name);
        insert into public.pages (user_id, kind, key, name, status)
        values (v_item.user_id, v_mention ->> 'kind', (v_mention ->> 'kind') || ':' || v_norm, v_name,
                case when v_mention ->> 'kind' = 'person' then 'pending_approval' else 'active' end)
        on conflict (user_id, key) do nothing;
        v_page := public.link_page(v_item.user_id, v_mention ->> 'kind',
          (v_mention ->> 'kind') || ':' || v_norm, v_name, v_item.id);
        v_keys := v_keys || ((v_mention ->> 'kind') || ':' || v_norm);
        v_pages := v_pages || v_page;
      end loop;
    end if;

    -- Unlink the item from code-built pages it no longer belongs to.
    with gone as (
      update public.page_items pi set deleted_at = now(), updated_at = now()
        from public.pages p
       where pi.page_id = p.id and pi.item_id = v_q.item_id and pi.deleted_at is null
         and p.kind in ('series', 'topic', 'place', 'person', 'project')
         and not (p.key = any (v_keys))
      returning pi.page_id)
    select v_pages || coalesce(array_agg(page_id), '{}') into v_pages from gone;

    delete from public.page_queue where item_id = v_q.item_id and queued_at = v_q.queued_at;
    v_done := v_done + 1;
  end loop;

  -- Counts and the latest item for every page touched.
  update public.pages p
     set item_count = c.n, last_item_at = c.last_at, updated_at = now()
    from (select pi.page_id, count(*)::integer as n,
                 max(coalesce(i.start_at, i.due_at, i.created_at)) as last_at
            from public.page_items pi join public.items i on i.id = pi.item_id
           where pi.page_id = any (v_pages) and pi.deleted_at is null and i.deleted_at is null
           group by pi.page_id) c
   where p.id = c.page_id;
  update public.pages p set item_count = 0, updated_at = now()
   where p.id = any (v_pages)
     and not exists (select 1 from public.page_items pi where pi.page_id = p.id and pi.deleted_at is null);
  return v_done;
end;
$$;
revoke all on function public.drain_page_queue(integer) from public, anon, authenticated;
