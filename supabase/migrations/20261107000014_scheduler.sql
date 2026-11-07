-- 0014 Scheduler tick (Task 4.13): every minute, pg_cron asks scheduler-tick to
-- plan recurring reminders, run each person's local-time jobs (guarded by
-- job_runs) and send due nudges with quiet hours and the daily cap.

create or replace function public.dispatch_scheduler_tick()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return false;
  end if;
  -- Nothing to do when nobody has a notification device.
  if not exists (select 1 from public.devices
                  where receives_notifications and push_subscription is not null and deleted_at is null) then
    return false;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/scheduler-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  return true;
end;
$$;

revoke all on function public.dispatch_scheduler_tick() from public, anon, authenticated;

-- Due nudges are looked up per person by time.
create index if not exists nudges_user_due_idx on public.nudges (user_id, send_at) where status = 'pending';

select cron.schedule('scheduler-tick', '* * * * *', 'select public.dispatch_scheduler_tick()');
