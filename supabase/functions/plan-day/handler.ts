import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import type { PlanRunResult } from './run.ts';

export interface PlanHandlerDeps {
  caller: Caller;
  /** runPlanDay (evening) for this user's local today, or the given local date. */
  plan(userId: string, localDate: string | null): Promise<PlanRunResult>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /plan-day (service key only; scheduler-tick calls it at the evening time)
 *   { user_id, local_date? }: the evening planner for that person.
 */
export async function handlePlan(req: Request, d: PlanHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }
  if (!(await d.caller.isService(bearer(req)))) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Scheduler only.' }, 401);
  }
  const body = (await req.json().catch(() => ({}))) as { user_id?: unknown; local_date?: unknown };
  if (typeof body.user_id !== 'string' || !body.user_id) {
    return json({ ok: false, error_code: 'bad_request', message: 'user_id is needed.' }, 400);
  }
  const localDate =
    typeof body.local_date === 'string' && DATE.test(body.local_date) ? body.local_date : null;
  const res = await d.plan(body.user_id, localDate);
  return json({ ok: res.status !== 'failed', error_code: null, ...res });
}
