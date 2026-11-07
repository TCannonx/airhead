-- Local and CI only (never pushed to hosted projects): let the end-to-end
-- tests' throwaway addresses sign up past the invite-only hook (migration 0029).
insert into public.signup_allowlist (entry, note)
values ('@example.test', 'end-to-end tests')
on conflict do nothing;
