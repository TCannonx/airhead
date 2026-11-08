-- 0030 AI actions (Task 10.2): what AI sorting did, or proposes to do, beyond
-- filing items (leave balance, leave bookings, work settings, reminders, moving
-- items). Written by apply_sort_batch (service role). Devices read them and
-- change only the status (undo, apply, dismiss); the sync push is an upsert, so
-- the owner may also insert rows (only their own, like suggestions).
create table public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  capture_id uuid,
  kind text not null check (kind in ('set_leave_remaining', 'set_leave_used', 'book_leave',
    'update_work_setting', 'set_reminder', 'reschedule_item')),
  status text not null check (status in ('applied', 'proposed', 'dismissed', 'undone', 'skipped')),
  reason text,
  summary text not null,
  quote text not null default '',
  confidence real,
  payload jsonb not null default '{}'::jsonb,
  target_table text check (target_table in ('settings', 'leave_bookings', 'items')),
  target_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger set_server_updated_at before insert or update on public.ai_actions
  for each row execute function public.set_server_updated_at();
create index ai_actions_sync_idx on public.ai_actions (user_id, server_updated_at);
create index ai_actions_capture_idx on public.ai_actions (capture_id);
alter table public.ai_actions enable row level security;
create policy "own rows: select" on public.ai_actions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.ai_actions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.ai_actions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.ai_actions from anon;
revoke delete on public.ai_actions from authenticated;
grant select, insert, update on public.ai_actions to authenticated;

alter publication supabase_realtime add table public.ai_actions;
