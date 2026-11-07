-- Tests for migration 0003: AI usage log, price table, month-to-date spend.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

-- Seeded by the service (bypasses RLS as table owner)
insert into public.ai_usage (user_id, task, tier, model, input_tokens, output_tokens, cost_eur, ok, created_at)
values
  ('00000000-0000-0000-0000-00000000000a', 'sort_batch', 'small', 'claude-haiku-5-5', 1000, 200, 0.10, true, now()),
  ('00000000-0000-0000-0000-00000000000a', 'sort_batch', 'small', 'claude-haiku-5-5', 1000, 200, 0.05, false, now()),
  ('00000000-0000-0000-0000-00000000000a', 'sort_batch', 'small', 'claude-haiku-5-5', 1, 1, 9.99, true, now() - interval '62 days'),
  ('00000000-0000-0000-0000-00000000000b', 'sort_batch', 'small', 'claude-haiku-5-5', 1, 1, 1.00, true, now());

select is(public.ai_month_to_date_eur('00000000-0000-0000-0000-00000000000a'), 0.15::numeric,
  'month-to-date counts this month only, failed attempts included');
select is(public.ai_month_to_date_eur('00000000-0000-0000-0000-00000000000b'), 1.00::numeric,
  'month-to-date is per user');

select ok(exists (select 1 from public.ai_prices where user_id is null and model = 'claude-haiku-5-5'),
  'default small-tier price is seeded');
select ok(exists (select 1 from public.ai_prices where user_id is null and model = 'claude-sonnet-5-5'),
  'default large-tier price is seeded');

-- As user A --------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select results_eq($$ select count(*)::int from public.ai_usage_mine $$, array[3],
  'A sees only A''s usage rows through the view');
select throws_ok($$ insert into public.ai_usage (user_id, task, tier, model, ok)
  values ('00000000-0000-0000-0000-00000000000a', 'x', 'small', 'm', true) $$,
  '42501', null, 'users cannot write usage rows (only the gateway can)');
select throws_ok($$ select public.ai_month_to_date_eur('00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'users cannot call the spend function directly');

select results_eq($$ select count(*)::int from public.ai_prices $$, array[2], 'A sees the two default prices');
select lives_ok($$ insert into public.ai_prices
  (user_id, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, eur_rate)
  values ('00000000-0000-0000-0000-00000000000a', 'claude-haiku-5-5', 0.2, 1, 0.02, 0.25, 0.9) $$,
  'A can add a price override');
-- RLS hides the defaults from updates: this changes nothing (no error).
update public.ai_prices set input_per_mtok = 0 where user_id is null;
select results_eq($$ select input_per_mtok from public.ai_prices where user_id is null and model = 'claude-haiku-5-5' $$,
  array[0.10::numeric(10,4)], 'A cannot change the defaults');

-- As user B --------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select results_eq($$ select count(*)::int from public.ai_usage_mine $$, array[1], 'B sees only B''s usage');
select results_eq($$ select count(*)::int from public.ai_prices $$, array[2], 'B does not see A''s override');

reset role;
select * from finish();
rollback;
