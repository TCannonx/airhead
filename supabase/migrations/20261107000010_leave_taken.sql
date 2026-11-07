-- 0010 Nightly: requested or approved leave whose last day has passed becomes Taken (Task 4.6).
-- "Passed" is judged in each person's own time zone (settings.data.time_zone,
-- default Europe/Dublin). Planned leave is left alone: it was never asked for.

create or replace function public.mark_leave_taken()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.leave_bookings b
     set status = 'taken', updated_at = now()
    from (
      select u.id as user_id,
             coalesce(s.data ->> 'time_zone', 'Europe/Dublin') as tz
        from auth.users u
        left join public.settings s on s.id = u.id
    ) z
   where b.user_id = z.user_id
     and b.deleted_at is null
     and b.status in ('requested', 'approved')
     and b.end_date < (now() at time zone z.tz)::date;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.mark_leave_taken() from public, anon, authenticated;

-- 01:10 UTC is after midnight in Ireland all year round.
select cron.schedule('mark-leave-taken', '10 1 * * *', 'select public.mark_leave_taken()');
