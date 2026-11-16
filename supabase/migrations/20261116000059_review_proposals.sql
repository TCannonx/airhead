-- 0059 Weekly review proposals (Task 17.3): two more AI action kinds the
-- weekly review may propose under "Needs your OK" (never applied by the server):
-- split_task (a large or stuck task gets checklist steps in its body) and
-- drop_item (a stale task is set to dropped). Moves use reschedule_item.
-- A superset of 0034's kinds.
alter table public.ai_actions drop constraint if exists ai_actions_kind_check;
alter table public.ai_actions add constraint ai_actions_kind_check
  check (kind in ('set_leave_remaining', 'set_leave_used', 'book_leave',
    'update_work_setting', 'set_reminder', 'reschedule_item', 'add_prep_rule', 'tidy_item',
    'split_task', 'drop_item'));
