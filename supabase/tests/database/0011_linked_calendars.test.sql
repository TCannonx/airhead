-- Tests for migration 0011: the linked-calendar dispatcher.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.feeds (user_id, kind, url, enabled, deleted_at) values
  ('00000000-0000-0000-0000-00000000000a', 'linked_in', 'https://example.test/a.ics', true, null),
  ('00000000-0000-0000-0000-00000000000a', 'linked_in', 'https://example.test/b.ics', false, null),
  ('00000000-0000-0000-0000-00000000000a', 'linked_in', 'https://example.test/c.ics', true, now());
insert into public.feeds (user_id, kind, token_hash) values
  ('00000000-0000-0000-0000-00000000000a', 'us_out', repeat('ab', 32));

-- Without the Vault secrets nothing is sent.
delete from vault.secrets where name in ('project_url', 'service_role_key');
select is(public.dispatch_linked_calendars(), 0, 'no calls without the Vault secrets');

select vault.create_secret('http://127.0.0.1:54321', 'project_url');
select vault.create_secret('test-service-key', 'service_role_key');
select is(public.dispatch_linked_calendars(), 1, 'one call: the enabled, live linked calendar only');

select ok(exists (select 1 from cron.job where jobname = 'fetch-linked-calendars' and schedule = '*/30 * * * *'),
  'runs every 30 minutes');
select ok(not has_function_privilege('authenticated', 'public.dispatch_linked_calendars()', 'execute'),
  'signed-in users cannot run it');

select * from finish();
rollback;
