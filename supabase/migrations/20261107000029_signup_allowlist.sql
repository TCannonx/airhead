-- 0029 Invite-only sign-up: an allow-list of email addresses (or whole
-- domains written '@example.com') and a Supabase Auth "before user created"
-- hook that refuses everyone else. Devices never read the list.
--
-- The hook has to be switched on per project (Authentication → Hooks →
-- Before User Created → public.hook_before_user_created); locally it is on in
-- config.toml. Add people with:
--   insert into public.signup_allowlist (entry) values ('someone@example.com');

create table public.signup_allowlist (
  entry text primary key
    check (entry = lower(entry) and entry ~ '^[^@\s]*@[^@\s]+$'),
  note text,
  created_at timestamptz not null default now()
);
alter table public.signup_allowlist enable row level security;
revoke all on table public.signup_allowlist from anon, authenticated, public;

grant usage on schema public to supabase_auth_admin;
grant select on table public.signup_allowlist to supabase_auth_admin;
create policy "Auth reads the allow-list" on public.signup_allowlist
  for select to supabase_auth_admin using (true);

-- Not security definer (Supabase's advice for hooks): it runs as supabase_auth_admin.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  email text := lower(trim(event -> 'user' ->> 'email'));
begin
  if email is not null and email like '%@%' and exists (
    select 1 from public.signup_allowlist a
    where a.entry = email or a.entry = '@' || split_part(email, '@', 2)
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'invite_only: This app is invite-only. Ask the owner to add your email.'
  ));
end;
$$;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;
