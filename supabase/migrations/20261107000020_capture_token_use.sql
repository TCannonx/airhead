-- 0020 Capture tokens in use (Task 7.1). The table exists since 0001 (only a
-- sha-256 hash of each token is stored); this adds when a token was last used,
-- a log of recent uses for the rate limit, and the lookup ingest-capture runs
-- with the service role.

alter table public.capture_tokens add column last_used_at timestamptz;

create table public.capture_token_uses (
  token_id uuid not null references public.capture_tokens (id) on delete cascade,
  used_at timestamptz not null default now()
);
create index capture_token_uses_idx on public.capture_token_uses (token_id, used_at);
alter table public.capture_token_uses enable row level security;
revoke all on public.capture_token_uses from anon, authenticated;

-- Looks up a live token by its hash and records a use. Returns no row for an
-- unknown, revoked or deleted token; allowed = false when the token has been
-- used 60 times in the last hour (the use is then not recorded).
create or replace function public.use_capture_token(p_hash text)
returns table (user_id uuid, token_id uuid, allowed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.capture_tokens;
  recent integer;
begin
  select * into t from public.capture_tokens c
   where c.token_hash = p_hash and c.revoked_at is null and c.deleted_at is null;
  if not found then
    return;
  end if;
  delete from public.capture_token_uses u
   where u.token_id = t.id and u.used_at < now() - interval '1 hour';
  select count(*) into recent from public.capture_token_uses u where u.token_id = t.id;
  if recent >= 60 then
    return query select t.user_id, t.id, false;
    return;
  end if;
  insert into public.capture_token_uses (token_id) values (t.id);
  update public.capture_tokens set last_used_at = now() where id = t.id;
  return query select t.user_id, t.id, true;
end;
$$;

revoke all on function public.use_capture_token(text) from public, anon, authenticated;
grant execute on function public.use_capture_token(text) to service_role;
