-- Background sorting: every 5 minutes, call sort-batch for each user who is due.
-- Due = at least N unsorted captures (default 5), or the oldest has waited at
-- least M minutes (default 60). Per-user overrides in settings.data:
-- batch_threshold_count, batch_threshold_minutes.
--
-- The project URL and service key are read from Supabase Vault (secrets named
-- 'project_url' and 'service_role_key', created once per project by the user).
-- Without them the dispatcher does nothing.

create extension if not exists pg_net with schema extensions;

create or replace function public.users_due_for_sorting(
  p_default_count integer default 5,
  p_default_minutes integer default 60
)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id
  from public.captures c
  left join public.settings s on s.user_id = c.user_id and s.deleted_at is null
  where c.status = 'unsorted'
    and c.deleted_at is null
    and coalesce(nullif(trim(c.text), ''), nullif(trim(c.url), '')) is not null
  group by c.user_id, s.data
  having count(*) >= coalesce((s.data ->> 'batch_threshold_count')::integer, p_default_count)
      or min(c.captured_at) <= now() - make_interval(
           mins => coalesce((s.data ->> 'batch_threshold_minutes')::integer, p_default_minutes));
$$;

create or replace function public.dispatch_sort_batches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_user uuid;
  v_calls integer := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return 0;
  end if;

  for v_user in select d.user_id from public.users_due_for_sorting() d loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/sort-batch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('user_id', v_user),
      timeout_milliseconds := 120000
    );
    v_calls := v_calls + 1;
  end loop;
  return v_calls;
end;
$$;

revoke all on function public.users_due_for_sorting(integer, integer) from public, anon, authenticated;
revoke all on function public.dispatch_sort_batches() from public, anon, authenticated;

select cron.schedule('dispatch-sort-batches', '*/5 * * * *', 'select public.dispatch_sort_batches()');
