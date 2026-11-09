-- 0037 Real-model evaluation on dev (2026-11-09): every 30 minutes the dev
-- project asks the ai-eval function to check the owner's example requests
-- against the real sorting model. The function calls the model only when the
-- prompt or the cases changed since its last saved run (or once a day), so a
-- quiet half-hour costs nothing. Reports are kept here for review.
-- On any other project (live) the dispatcher does nothing.

create table public.ai_eval_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  prompt_hash text not null,
  passed integer not null,
  total integer not null,
  cost_eur numeric(10, 5) not null default 0,
  report jsonb not null
);
create index ai_eval_runs_recent_idx on public.ai_eval_runs (created_at desc);
alter table public.ai_eval_runs enable row level security;
revoke all on public.ai_eval_runs from public, anon, authenticated;

create or replace function public.dispatch_ai_eval()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  -- Dev only.
  if v_url is null or v_key is null or position('tfxpbxmkvlwxybaysjxy' in v_url) = 0 then
    return 0;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/ai-eval',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  return 1;
end;
$$;
revoke all on function public.dispatch_ai_eval() from public, anon, authenticated;

select cron.schedule('ai-eval', '7,37 * * * *', 'select public.dispatch_ai_eval()');
