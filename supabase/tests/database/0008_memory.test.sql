-- Tests for memory facts and learned rules (migration 20261107000008).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'authenticated', 'authenticated');

select has_table('public', t, t || ' exists') from unnest(array['memory_facts', 'learned_rules']) t;
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t),
  t || ' is published to Realtime') from unnest(array['memory_facts', 'learned_rules']) t;

-- Facts -----------------------------------------------------------------------
select is(public.add_memory_facts('00000000-0000-0000-0000-00000000000a', $j$[
  {"text": "Training is Tue/Thu 7pm", "category": "everyday", "source_capture_id": null},
  {"text": "Jim is a close friend", "category": "person", "source_capture_id": null},
  {"text": "Has a gluten allergy", "category": "personal", "source_capture_id": null},
  {"text": "training is tue/thu 7pm", "category": "everyday", "source_capture_id": null},
  {"text": "  ", "category": "everyday", "source_capture_id": null}
]$j$::jsonb), 3, 'adds facts, skipping duplicates and blanks');
select results_eq($$ select status from public.memory_facts order by text $$,
  array['pending_approval', 'pending_approval', 'active'],
  'everyday facts are active; people and personal facts wait for approval');

-- Archive: unused for 180 days
insert into public.memory_facts (user_id, text, status, last_used_at) values
  ('00000000-0000-0000-0000-00000000000a', 'Old habit', 'active', now() - interval '200 days'),
  ('00000000-0000-0000-0000-00000000000a', 'Recent habit', 'active', now() - interval '10 days');
select is(public.archive_stale_facts(), 1, 'one stale fact archived');
select is((select status from public.memory_facts where text = 'Old habit'), 'archived', 'old fact archived');
select is((select status from public.memory_facts where text = 'Recent habit'), 'active', 'recent fact kept');
select ok(exists (select 1 from cron.job where jobname = 'archive-stale-facts'), 'archive job scheduled');

-- Learned rules -------------------------------------------------------------
insert into public.lists (id, user_id, name) values
  ('11100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Shopping');

create or replace function pg_temp.sorted(p_text text, p_type text, p_list uuid) returns uuid language plpgsql as $$
declare v_c uuid;
begin
  insert into public.captures (user_id, text, status) values ('00000000-0000-0000-0000-00000000000a', p_text, 'sorted') returning id into v_c;
  insert into public.items (user_id, capture_id, type, title, list_id) values ('00000000-0000-0000-0000-00000000000a', v_c, p_type, p_text, p_list);
  return v_c;
end $$;

select pg_temp.sorted('buy milk', 'list_entry', '11100000-0000-4000-8000-000000000001');
select pg_temp.sorted('buy bread', 'list_entry', '11100000-0000-4000-8000-000000000001');
select pg_temp.sorted('Buy eggs', 'list_entry', '11100000-0000-4000-8000-000000000001');
select is(public.learn_rules('00000000-0000-0000-0000-00000000000a'), 0, 'three times is not enough');
select pg_temp.sorted('buy, rice', 'list_entry', '11100000-0000-4000-8000-000000000001');
select is(public.learn_rules('00000000-0000-0000-0000-00000000000a'), 1, 'the fourth uncorrected time creates a rule');
select is((select result from public.learned_rules where pattern = 'buy'),
  '{"type": "list_entry", "list_id": "11100000-0000-4000-8000-000000000001"}'::jsonb, 'rule result: Shopping list entry');
select is(public.learn_rules('00000000-0000-0000-0000-00000000000a'), 0, 'not created twice');

-- "call" goes to tasks 4 times but once to an event: ambiguous, no rule
select pg_temp.sorted('call ' || g, 'task', null) from generate_series(1, 4) g;
select pg_temp.sorted('call mum sunday', 'event', null);
-- "email" 4 times, but one of them was corrected: not enough
select pg_temp.sorted('email ' || g, 'task', null) from generate_series(1, 3) g;
insert into public.corrections (user_id, capture_id) values
  ('00000000-0000-0000-0000-00000000000a', pg_temp.sorted('email boss', 'task', null));
select is(public.learn_rules('00000000-0000-0000-0000-00000000000a'), 0, 'mixed or corrected patterns create no rule');

-- RLS ------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is_empty($$ select 1 from public.memory_facts $$, 'B cannot read A''s facts');
select is_empty($$ select 1 from public.learned_rules $$, 'B cannot read A''s rules');
select throws_ok($$ select public.learn_rules('00000000-0000-0000-0000-00000000000b') $$, '42501', null, 'apps cannot run learn_rules');
select throws_ok($$ select public.add_memory_facts('00000000-0000-0000-0000-00000000000b', '[]') $$, '42501', null, 'apps cannot add facts through the batch function');

reset role;
select * from finish();
rollback;
