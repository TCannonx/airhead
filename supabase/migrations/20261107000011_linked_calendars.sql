-- 0011 Linked calendars (Task 4.9): every 30 minutes, ask fetch-linked-calendars
-- to refresh every enabled linked calendar. One call per feed, so a slow or
-- broken calendar can't hold up the others.

create or replace function public.dispatch_linked_calendars()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_feed uuid;
  v_calls integer := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return 0;
  end if;

  for v_feed in
    select f.id from public.feeds f
     where f.kind = 'linked_in' and f.enabled and f.deleted_at is null and f.url is not null
  loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/fetch-linked-calendars',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('mode', 'sync', 'feed_id', v_feed),
      timeout_milliseconds := 60000
    );
    v_calls := v_calls + 1;
  end loop;
  return v_calls;
end;
$$;

revoke all on function public.dispatch_linked_calendars() from public, anon, authenticated;

select cron.schedule('fetch-linked-calendars', '*/30 * * * *', 'select public.dispatch_linked_calendars()');
