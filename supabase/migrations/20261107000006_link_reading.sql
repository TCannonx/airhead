-- Link reading: when a link capture first reaches the server, ask read-link to
-- read the page (asynchronously, through pg_net). Uses the same Vault secrets
-- as the sorting scheduler; without them nothing happens.

create or replace function public.request_link_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if new.kind <> 'link' or new.url is null or new.deleted_at is not null then
    return new;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return new;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/read-link',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('capture_id', new.id),
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;

revoke all on function public.request_link_read() from public, anon, authenticated;

create trigger request_link_read
  after insert on public.captures
  for each row execute function public.request_link_read();

-- Partial index for the sort batch's "links waiting for a summary" query.
create index captures_summary_pending_idx on public.captures (user_id)
  where (payload ->> 'summary_pending') = 'true' and deleted_at is null;
