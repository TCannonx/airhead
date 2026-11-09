import { execFileSync } from 'node:child_process';

// Direct SQL against the LOCAL stack's database (CI's e2e-sync job exports
// SUPABASE_DB_URL from `supabase status`). Used to stand in for the clock
// (backdating a capture), to start the scheduler's dispatch by hand instead of
// waiting for pg_cron, and to check what the server holds.
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Runs SQL and returns the unaligned, tuples-only output, trimmed. */
export function sql(query: string): string {
  return execFileSync(
    'psql',
    [DB_URL, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', query],
    {
      encoding: 'utf8',
    },
  ).trim();
}

/** A SQL string literal. */
export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The auth user id for an e-mail address (the account must exist). */
export function userIdFor(email: string): string {
  const id = sql(`select id from auth.users where email = ${lit(email)}`);
  if (!id) throw new Error(`no user ${email}`);
  return id;
}

/** The last few pg_net replies, for a failing test's message. */
export function recentNetReplies(): string {
  try {
    return sql(
      `select coalesce(status_code::text, 'none') || ' ' || coalesce(error_msg, '') || ' ' || left(coalesce(content, ''), 300)
         from net._http_response order by id desc limit 5`,
    );
  } catch (e) {
    return `(could not read net._http_response: ${String(e)})`;
  }
}

/**
 * Polls a query until it returns `expected`. On time-out the error names the
 * last value and pg_net's last replies (what sort-batch said to the database).
 */
export async function waitForSql(query: string, expected: string, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    last = sql(query);
    if (last === expected) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `waited ${timeoutMs} ms for "${expected}", last got "${last}" from: ${query}\n` +
      `pg_net replies:\n${recentNetReplies()}`,
  );
}

/**
 * Makes the user's waiting captures count as settled (older than the
 * 2-minute wait in users_due_now) and runs the scheduler's dispatcher, the
 * same SQL pg_cron runs every 5 minutes. Returns how many sort-batch calls it made.
 */
export function dispatchSortingFor(userId: string): number {
  sql(
    `update public.captures set captured_at = now() - interval '10 minutes'
       where user_id = ${lit(userId)} and status = 'unsorted' and deleted_at is null`,
  );
  const due = sql(`select count(*) from public.users_due_now() where user_id = ${lit(userId)}`);
  if (due !== '1') throw new Error(`user is not due for sorting (users_due_now gave ${due})`);
  return Number(sql('select public.dispatch_sort_batches()'));
}
