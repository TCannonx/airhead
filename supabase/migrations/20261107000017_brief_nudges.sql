-- 0017 Morning brief nudges (Task 5.4): the round-up notification is a nudge of
-- its own kind, so it can be switched off and counted like the others. Widens
-- the allowed kinds; nothing is removed.
alter table public.nudges drop constraint nudges_kind_check;
alter table public.nudges add constraint nudges_kind_check check (kind in (
  'event_reminder', 'task_due', 'prep', 'checklist', 'evening_review', 'leave_runout',
  'slip', 'check_time', 'summary', 'test', 'morning_brief'));
