-- 0033 Sort new captures at the next 5-minute check (owner request 2026-11-08).
-- Before: a person was due only with 5 captures waiting or the oldest an hour
-- old, so a single note sat unsorted for up to an hour. Now: due once the
-- oldest has settled for 2 minutes (a burst of captures shares one call), or
-- straight away with a full batch (20). Nothing waiting: no call, no cost.
-- The person's own settings (batch_threshold_count / _minutes) still win.

create or replace function public.users_due_now()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select d.user_id from public.users_due_for_sorting(20, 2) d;
$$;
revoke all on function public.users_due_now() from public, anon, authenticated;

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

  for v_user in select d.user_id from public.users_due_now() d loop
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
revoke all on function public.dispatch_sort_batches() from public, anon, authenticated;
