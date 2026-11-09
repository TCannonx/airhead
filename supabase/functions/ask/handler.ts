import type { Caller } from '../_shared/caller.ts';
import { bearer } from '../_shared/caller.ts';
import { cors, json } from '../_shared/http.ts';
import { runAsk, type AskDeps } from './run.ts';

export interface AskHandlerDeps {
  caller: Caller;
  apiKey(): string | undefined;
  /** What the run needs for this user; search runs as them (their token, RLS). */
  runDeps(userId: string, token: string, apiKey: string): AskDeps;
}

/**
 * POST /ask { question }
 * Signed in only. Search runs as the user (RLS); one AI call answers from the
 * top 8 passages, with citations.
 */
export async function handleAsk(req: Request, d: AskHandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')
    return json({ ok: false, error_code: 'method_not_allowed', message: 'Use POST.' }, 405);
  const token = bearer(req);
  const userId = await d.caller.userId(token);
  if (!userId)
    return json({ ok: false, error_code: 'unauthorized', message: 'Sign in again.' }, 401);
  const apiKey = d.apiKey();
  if (!apiKey)
    return json({ ok: false, error_code: 'not_configured', message: 'AI is not set up yet.' }, 503);
  const body = (await req.json().catch(() => ({}))) as { question?: unknown };
  const outcome = await runAsk(
    typeof body.question === 'string' ? body.question : '',
    userId,
    d.runDeps(userId, token, apiKey),
  ).catch(() => ({
    ok: false as const,
    error_code: 'api_error',
    message: 'Airhead couldn’t answer that just now. Try again.',
  }));
  return json(outcome, outcome.ok || outcome.error_code !== 'bad_request' ? 200 : 400);
}
