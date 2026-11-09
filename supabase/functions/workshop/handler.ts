import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { runFleshOut } from './run.ts';
import { runTurn, type TurnDeps } from './turn.ts';

export interface WorkshopHandlerDeps {
  caller: Caller;
  apiKey(): string | undefined;
  /** What the run needs; every read and write is limited to this user's rows. */
  runDeps(userId: string, apiKey: string): TurnDeps;
}

/**
 * POST /workshop { mode: 'flesh_out', item_id } | { mode: 'turn', item_id, answer? }
 * Signed in only. One large-tier call; the draft is saved as a new version
 * and returned so the device can show it before the next sync.
 */
export async function handleWorkshop(req: Request, d: WorkshopHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const userId = await d.caller.userId(bearer(req));
  if (!userId)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  const apiKey = d.apiKey();
  if (!apiKey)
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  const body = (await req.json().catch(() => ({}))) as {
    mode?: string;
    item_id?: string;
    answer?: unknown;
  };
  if (typeof body.item_id !== 'string' || (body.mode !== 'flesh_out' && body.mode !== 'turn'))
    return json({ ok: false, error_code: 'bad_request', message: 'Unknown request.' }, 400);
  const deps = d.runDeps(userId, apiKey);
  const outcome =
    body.mode === 'turn'
      ? await runTurn(
          body.item_id,
          typeof body.answer === 'string' ? body.answer : null,
          userId,
          deps,
        )
      : await runFleshOut(body.item_id, userId, deps);
  return json(outcome, outcome.ok || outcome.error_code !== 'not_found' ? 200 : 404);
}
