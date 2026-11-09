import { bearer, type Caller } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import type { SortBatchOutcome } from './run.ts';

export interface SortBatchHandlerDeps {
  caller: Caller;
  apiKey(): string | undefined;
  /** runSortBatch for this user (background = the scheduler's run). */
  sort(userId: string, background: boolean, apiKey: string): Promise<SortBatchOutcome>;
}

/**
 * POST /sort-batch
 * - from the app: Authorization: Bearer <user access token>   (on-demand: app open, "Sort now")
 * - from the scheduler: Authorization: Bearer <service key>, body { user_id }   (background)
 * A user's own call never reads a body: it always sorts their own captures.
 */
export async function handleSortBatch(req: Request, d: SortBatchHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }

  const token = bearer(req);
  let userId: string | null = null;
  let background = false;
  if (await d.caller.isService(token)) {
    const body = (await req.json().catch(() => ({}))) as { user_id?: string };
    userId = body.user_id ?? null;
    background = true;
  } else if (token) {
    userId = await d.caller.userId(token);
  }
  if (!userId) {
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  }

  const apiKey = d.apiKey();
  if (!apiKey) {
    return json(
      { ok: false, error_code: 'not_configured', message: 'AI sorting is not set up yet.' },
      503,
    );
  }

  try {
    const outcome = await d.sort(userId, background, apiKey);
    return json(outcome, outcome.ok ? 200 : outcome.error_code === 'cap_reached' ? 402 : 502);
  } catch (error) {
    console.error('sort-batch failed', error);
    return json(
      { ok: false, error_code: 'server_error', message: 'Sorting failed. It will be tried again.' },
      500,
    );
  }
}
