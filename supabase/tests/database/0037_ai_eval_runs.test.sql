-- Tests for migration 0037: dev-only evaluation runs.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select ok(exists (select 1 from cron.job where jobname = 'ai-eval' and schedule = '7,37 * * * *'),
  'checked every 30 minutes');
select is(public.dispatch_ai_eval(), 0, 'no Vault secrets (or not dev): nothing is called');

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated');
insert into public.ai_eval_runs (prompt_hash, passed, total, report) values ('h', 1, 2, '{}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from public.ai_eval_runs $$, '42501', null, 'apps cannot read evaluation runs');
select throws_ok($$ select public.dispatch_ai_eval() $$, '42501', null, 'apps cannot start an evaluation');
reset role;

select * from finish();
rollback;
