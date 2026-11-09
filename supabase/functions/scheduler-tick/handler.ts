import { bearer, type Caller } from '../_shared/caller.ts';
import { json } from '../_shared/http.ts';
import type { Pusher } from '../_shared/push.ts';

export interface TickHandlerDeps {
  caller: Caller;
  /** null when the VAPID secrets aren't set. */
  pusher(): Promise<Pusher | null>;
  /** runTick now, sending with this pusher; returns its report. */
  tick(pusher: Pusher): Promise<object>;
}

/**
 * POST /scheduler-tick (service key only; pg_cron calls it every minute).
 * Plans recurring reminders, runs local-time jobs once a day, sends due nudges.
 */
export async function handleTick(req: Request, d: TickHandlerDeps): Promise<Response> {
  if (!(await d.caller.isService(bearer(req)))) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Scheduler only.' }, 401);
  }
  const pusher = await d.pusher().catch(() => null);
  if (!pusher) {
    return json({ ok: false, error_code: 'not_configured', message: 'Push is not set up.' }, 200);
  }
  const report = await d.tick(pusher);
  return json({ ok: true, error_code: null, message: 'ok', ...report });
}
